import { describe, expect, it } from "vitest";
import { fetchSnapshots, getAppState, getPreferences, getUsageStats, isTauri } from "./bridge";

describe("desktop bridge boundary", () => {
  it("never returns sample quota outside Tauri", async () => {
    expect(isTauri()).toBe(false);
    await expect(fetchSnapshots()).rejects.toThrow("desktop bridge is unavailable");
    await expect(getAppState()).rejects.toThrow("desktop bridge is unavailable");
    await expect(getUsageStats()).rejects.toThrow("desktop bridge is unavailable");
  });

  it("uses harmless preference defaults outside Tauri", async () => {
    await expect(getPreferences()).resolves.toMatchObject({
      locked: false,
      alwaysOnTop: true,
      language: "zh-CN",
    });
  });
});
