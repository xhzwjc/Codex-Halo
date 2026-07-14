# Codex Halo

Native-feeling desktop quota monitor for the local Codex Desktop login state, with a compact floating widget and a synchronized macOS menu bar panel.

## Highlights

- Shows your Codex plan, every usage window currently returned by Codex (including weekly-only or 5-hour + weekly modes), next reset time, and reset-credit availability.
- Displays compact live quota text in the macOS menu bar; Windows falls back to a tray icon, tooltip, and context menu.
- Uses clear quota states for healthy, caution, and critical remaining usage.
- Collapses into a small floating orb when idle, then expands on hover.
- Opens a dedicated quota panel from the menu bar with refresh, widget visibility, always-on-top, click-through, launch-at-login, language, and quit controls.
- Keeps the menu bar, detail panel, and floating window synchronized through one Rust-owned state coordinator.
- Refreshes every five minutes when healthy, every minute around reset boundaries, and uses bounded exponential backoff after failures; manual refreshes are serialized and debounced.
- Shows reset credit count and available reset-credit expiration times when the quota service provides them.
- Handles stale data, signed-out sessions, unavailable quota responses, and loading states without fabricating values.

## Repository Metadata

Suggested repository description:

```text
Windows/macOS menu bar and floating desktop monitor for Codex quota from the local Codex Desktop login state.
```

Suggested topics:

```text
codex, quota, tauri, react, rust, desktop-app, windows, macos, productivity
```

## How It Works

Codex Halo reads the existing Codex Desktop login state on your machine and queries Codex/ChatGPT quota endpoints with that session. The existing authentication reader, endpoint parser, and privacy boundary remain in the Rust desktop process. The UI receives normalized snapshots only; it does not estimate usage from local token counts, redeem reset credits, or modify account settings.

The production web entry never substitutes mock quota. A development-only `?designer` route contains explicit visual fixtures for component work. Real quota reading requires the Tauri desktop app and an existing Codex Desktop login on the same machine.

## Download

For normal users, download the latest unsigned build from GitHub Releases:

- Latest release: https://github.com/xhzwjc/Codex-Halo/releases/latest
- Windows: `codex-halo-windows-unsigned.zip`
- macOS Universal: `codex-halo-macos-universal-unsigned.zip`

Unzip it and run the app. Unsigned builds may trigger Windows SmartScreen or macOS Gatekeeper warnings. Public distribution to non-technical users should use signed Windows builds and notarized macOS builds.

## Feedback

Please use GitHub Issues for bugs, compatibility reports, and feature requests:

https://github.com/xhzwjc/Codex-Halo/issues

## Privacy Boundary

Codex Halo is local-first and intentionally narrow:

- Reads the local Codex Desktop login state only to query Codex quota.
- Sends the existing Codex access token only to ChatGPT quota endpoints.
- Stores only widget preferences in its own app config directory.
- Does not store Codex tokens, account IDs, prompts, chat history, raw quota responses, or local auth paths.
- Does not include telemetry, analytics, crash reporting, or third-party tracking.
- Does not redeem reset credits or modify account settings.

See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md) for the full boundary.

## Accuracy Boundary

Codex quota is read from Codex/ChatGPT quota service responses. If the response format changes, the app shows an unavailable or stale state instead of inventing quota values.

## Development

Requirements:

- Node.js 20+
- Rust stable
- Tauri 2 system dependencies for your platform

```bash
npm install
npm run dev
npm run test
npm run build
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

On Windows, Tauri may download WiX to create an MSI installer. If WiX download fails, the release executable may still be produced at:

```text
src-tauri/target/release/codex-halo.exe
```

## Release

GitHub Actions are configured for:

- CI on push/PR: frontend tests, TypeScript/Vite build, dependency audit, Rust tests, and Tauri builds.
- `v*` tags: unsigned Windows and macOS Universal bundle artifacts and a public GitHub Release.

See [docs/GITHUB-RELEASE-CHECKLIST.md](docs/GITHUB-RELEASE-CHECKLIST.md) before publishing a version for others.

Do not upload local credentials, `.codex`, `.env*`, screenshots with personal data, `node_modules`, `dist`, `src-tauri/target`, or local installers to source control.

## License

MIT
