#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const versionFiles = [
  "package.json",
  "package-lock.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  "src-tauri/tauri.conf.json",
];
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function printUsage() {
  console.log(`Usage:
  npm run release -- <version>
  npm run release -- <version> --yes
  npm run release -- <version> --dry-run

Example:
  npm run release -- 0.2.2

The command requires a clean main branch. It updates all application versions,
runs frontend and Rust checks, creates the release commit and annotated tag, and
atomically pushes main plus the tag to origin. GitHub Actions then builds and
publishes the macOS DMG and Windows EXE/MSI installers.`);
}

function commandResult(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    ...options,
  });
}

function capture(command, args) {
  const result = commandResult(command, args);
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr.trim() || result.stdout.trim();
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout.trim();
}

function run(command, args) {
  const result = commandResult(command, args, { stdio: "inherit" });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }
}

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function replaceVersion(text, pattern, version, file) {
  let replacements = 0;
  const updated = text.replace(pattern, (_match, prefix, suffix) => {
    replacements += 1;
    return `${prefix}${version}${suffix}`;
  });
  if (replacements !== 1) {
    throw new Error(`Expected exactly one Codex Halo version in ${file}, found ${replacements}`);
  }
  return updated;
}

function readConfiguredVersions() {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const packageLock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const tauriConfig = JSON.parse(readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"));
  const cargoToml = readFileSync(path.join(root, "src-tauri/Cargo.toml"), "utf8");
  const cargoLock = readFileSync(path.join(root, "src-tauri/Cargo.lock"), "utf8");
  const cargoTomlVersion = cargoToml.match(
    /^\[package\]\r?\nname = "codex-halo"\r?\nversion = "([^"]+)"/m,
  )?.[1];
  const cargoLockVersion = cargoLock.match(
    /^\[\[package\]\]\r?\nname = "codex-halo"\r?\nversion = "([^"]+)"/m,
  )?.[1];
  const versions = {
    "package.json": packageJson.version,
    "package-lock.json": packageLock.version,
    "package-lock workspace": packageLock.packages?.[""]?.version,
    "src-tauri/Cargo.toml": cargoTomlVersion,
    "src-tauri/Cargo.lock": cargoLockVersion,
    "src-tauri/tauri.conf.json": tauriConfig.version,
  };
  if (Object.values(versions).some((value) => !value)) {
    throw new Error(`Could not read every configured version: ${JSON.stringify(versions)}`);
  }
  const uniqueVersions = new Set(Object.values(versions));
  if (uniqueVersions.size !== 1) {
    throw new Error(`Configured versions are inconsistent: ${JSON.stringify(versions)}`);
  }
  return { currentVersion: packageJson.version, versions };
}

function updateVersions(version) {
  const packageJsonPath = path.join(root, "package.json");
  const packageJson = readFileSync(packageJsonPath, "utf8");
  writeFileSync(
    packageJsonPath,
    replaceVersion(packageJson, /^(  "version": ")[^"]+("[,]\r?)$/m, version, "package.json"),
  );

  const packageLockPath = path.join(root, "package-lock.json");
  const packageLock = readFileSync(packageLockPath, "utf8");
  const packageLockRoot = replaceVersion(
    packageLock,
    /^(  "version": ")[^"]+("[,]\r?)$/m,
    version,
    "package-lock.json root",
  );
  writeFileSync(
    packageLockPath,
    replaceVersion(
      packageLockRoot,
      /^(    "": \{\r?\n      "name": "codex-halo",\r?\n      "version": ")[^"]+("[,]\r?)$/m,
      version,
      "package-lock.json workspace",
    ),
  );

  const tauriConfigPath = path.join(root, "src-tauri/tauri.conf.json");
  const tauriConfig = readFileSync(tauriConfigPath, "utf8");
  writeFileSync(
    tauriConfigPath,
    replaceVersion(
      tauriConfig,
      /^(  "version": ")[^"]+("[,]\r?)$/m,
      version,
      "src-tauri/tauri.conf.json",
    ),
  );

  const cargoTomlPath = path.join(root, "src-tauri/Cargo.toml");
  const cargoToml = readFileSync(cargoTomlPath, "utf8");
  writeFileSync(
    cargoTomlPath,
    replaceVersion(
      cargoToml,
      /^(\[package\]\r?\nname = "codex-halo"\r?\nversion = ")[^"]+(".*)$/m,
      version,
      "src-tauri/Cargo.toml",
    ),
  );

  const cargoLockPath = path.join(root, "src-tauri/Cargo.lock");
  const cargoLock = readFileSync(cargoLockPath, "utf8");
  writeFileSync(
    cargoLockPath,
    replaceVersion(
      cargoLock,
      /^(\[\[package\]\]\r?\nname = "codex-halo"\r?\nversion = ")[^"]+(".*)$/m,
      version,
      "src-tauri/Cargo.lock",
    ),
  );
}

function ensureReleasePreconditions(version) {
  const branch = capture("git", ["branch", "--show-current"]);
  if (branch !== "main") throw new Error(`Release must run from main, current branch is ${branch || "detached"}`);

  const status = capture("git", ["status", "--porcelain"]);
  if (status) throw new Error("Working tree is not clean. Commit or stash current changes before releasing.");

  capture("git", ["remote", "get-url", "origin"]);
  run("git", ["fetch", "--quiet", "origin", "--tags"]);
  const containsRemoteMain = commandResult("git", ["merge-base", "--is-ancestor", "origin/main", "HEAD"]);
  if (containsRemoteMain.status !== 0) {
    throw new Error("Local main is behind or has diverged from origin/main. Pull/rebase before releasing.");
  }

  const configuredVersions = readConfiguredVersions();
  const versionComparison = compareVersions(version, configuredVersions.currentVersion);
  if (versionComparison < 0) {
    throw new Error(
      `Release version ${version} cannot be lower than current version ${configuredVersions.currentVersion}`,
    );
  }

  const tag = `v${version}`;
  if (commandResult("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`]).status === 0) {
    throw new Error(`Local tag ${tag} already exists`);
  }
  const remoteTag = commandResult("git", [
    "ls-remote",
    "--exit-code",
    "--tags",
    "origin",
    `refs/tags/${tag}`,
  ]);
  if (remoteTag.status === 0) {
    throw new Error(`Remote tag ${tag} already exists`);
  }
  if (remoteTag.error || remoteTag.status !== 2) {
    const detail = remoteTag.error?.message || remoteTag.stderr.trim();
    throw new Error(`Could not verify remote tag ${tag}${detail ? `: ${detail}` : ""}`);
  }

  return {
    branch,
    tag,
    currentVersion: configuredVersions.currentVersion,
    needsVersionUpdate: versionComparison > 0,
  };
}

async function confirmRelease(version, dryRun, assumeYes) {
  if (dryRun || assumeYes) return true;
  if (!process.stdin.isTTY) {
    throw new Error("Interactive confirmation is unavailable. Re-run with --yes after reviewing the version.");
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(`Release Codex Halo v${version} and push it to origin? [y/N] `);
  prompt.close();
  return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
}

async function main() {
  process.chdir(root);
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  const positionalArgs = args.filter((argument) => !argument.startsWith("--"));
  const version = positionalArgs[0];
  const dryRun = args.includes("--dry-run");
  const assumeYes = args.includes("--yes");
  const unknownFlags = args.filter(
    (argument) => argument.startsWith("--") && !["--dry-run", "--yes"].includes(argument),
  );

  if (
    positionalArgs.length !== 1 ||
    !version ||
    !/^\d+\.\d+\.\d+$/.test(version) ||
    unknownFlags.length > 0
  ) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const plan = ensureReleasePreconditions(version);
  console.log(`Release plan: ${plan.currentVersion} -> ${version}, branch ${plan.branch}, tag ${plan.tag}`);
  if (!(await confirmRelease(version, dryRun, assumeYes))) {
    console.log("Release cancelled.");
    return;
  }
  if (dryRun) {
    console.log("Dry run complete. No files, commits, tags, or remote refs were changed.");
    return;
  }

  const originals = plan.needsVersionUpdate
    ? new Map(versionFiles.map((file) => [file, readFileSync(path.join(root, file), "utf8")]))
    : new Map();
  let releaseCommitCreated = false;
  let tagCreated = false;
  try {
    if (plan.needsVersionUpdate) {
      updateVersions(version);
      run("git", ["diff", "--check"]);
    }
    run(npmCommand, ["test"]);
    run(npmCommand, ["run", "build"]);
    run("cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml"]);
    if (plan.needsVersionUpdate) {
      run("git", ["add", ...versionFiles]);
      run("git", ["commit", "-m", `chore(llm): 发布 v${version}`]);
      releaseCommitCreated = true;
    }
    run("git", ["tag", "-a", plan.tag, "-m", `Codex Halo ${plan.tag}`]);
    tagCreated = true;
    run("git", ["push", "--atomic", "origin", plan.branch, plan.tag]);
  } catch (error) {
    if (plan.needsVersionUpdate && !releaseCommitCreated) {
      commandResult("git", ["restore", "--staged", "--", ...versionFiles]);
      for (const [file, content] of originals) writeFileSync(path.join(root, file), content);
      console.error("Release failed before commit; version files were restored.");
    } else if (releaseCommitCreated || tagCreated) {
      console.error("Release failed after local Git history changed. The commit/tag were kept for safe recovery.");
    } else {
      console.error("Release failed before Git history was changed.");
    }
    throw error;
  }

  console.log(`Release ${plan.tag} pushed. Follow the build at https://github.com/xhzwjc/Codex-Halo/actions`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

export { compareVersions, readConfiguredVersions, replaceVersion };
