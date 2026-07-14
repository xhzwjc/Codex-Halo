import { describe, expect, it } from "vitest";
import type { ProviderSnapshot } from "../types";
import { clampPercent, formatResetDate, formatResetTime, formatUpdatedTime, isStaleExpired, normalizePercent, overallQuotaTier, quotaTier, resetCreditExpiryState } from "./format";

const snapshot: ProviderSnapshot = {
  provider: "codex",
  displayName: "CODEX",
  plan: "PRO",
  shortWindow: { remainingPercent: 80, resetsAt: null, windowSeconds: 18_000 },
  weeklyWindow: { remainingPercent: 8, resetsAt: null, windowSeconds: 604_800 },
  resetCredits: 0,
  updatedAt: "2026-07-07T00:00:00Z",
  status: "ok",
  message: null,
};

describe("quota formatting", () => {
  it("clamps untrusted percentages", () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(51.6)).toBe(52);
    expect(clampPercent(140)).toBe(100);
    expect(normalizePercent(Number.NaN)).toBeNull();
    expect(normalizePercent(undefined)).toBeNull();
  });

  it("uses the tighter of the 5-hour and weekly windows", () => {
    expect(overallQuotaTier(snapshot)).toBe("critical");
    expect(overallQuotaTier({ ...snapshot, weeklyWindow: null })).toBe("healthy");
    expect(overallQuotaTier({ ...snapshot, shortWindow: null, weeklyWindow: null })).toBe("unknown");
  });

  it("expires stale values after thirty minutes and rejects invalid timestamps", () => {
    const now = new Date("2026-07-07T00:31:00Z");
    expect(isStaleExpired({ ...snapshot, status: "stale" }, now)).toBe(true);
    expect(isStaleExpired({ ...snapshot, status: "stale", updatedAt: "invalid" }, now)).toBe(true);
    expect(isStaleExpired({ ...snapshot, status: "ok" }, now)).toBe(false);
  });

  it("formats update age without inventing a timestamp", () => {
    const now = new Date("2026-07-07T01:10:00Z");
    expect(formatUpdatedTime("2026-07-07T01:09:30Z", now)).toBe("刚刚");
    expect(formatUpdatedTime("2026-07-07T01:00:00Z", now, "en")).toBe("10m ago");
    expect(formatUpdatedTime(null, now)).toBe("日期未知");
  });

  it("uses inclusive 50% and 10% quota boundaries", () => {
    expect(quotaTier(50)).toBe("healthy");
    expect(quotaTier(49)).toBe("caution");
    expect(quotaTier(10)).toBe("caution");
    expect(quotaTier(9)).toBe("critical");
    expect(quotaTier(null)).toBe("unknown");
  });

  it("formats reset time in Chinese by default and supports English", () => {
    const now = new Date("2026-07-07T00:00:00Z");
    expect(formatResetTime("2026-07-07T01:30:00Z", now)).toBe("1 小时 30 分钟后重置");
    expect(formatResetTime("2026-07-07T01:30:00Z", now, "zh-CN")).toBe("1 小时 30 分钟后重置");
    expect(formatResetTime("2026-07-07T01:30:00Z", now, "en")).toBe("resets in 1h 30m");
    expect(formatResetTime("2026-07-06T01:00:00Z", now)).toBe("正在更新额度");
    expect(formatResetTime("2026-07-06T01:00:00Z", now, "zh-CN")).toBe("正在更新额度");
    expect(formatResetTime("2026-07-06T01:00:00Z", now, "en")).toBe("Updating quota");
    expect(formatResetTime("invalid", now)).toBe("重置时间未知");
    expect(formatResetTime("invalid", now, "zh-CN")).toBe("重置时间未知");
    expect(formatResetTime("invalid", now, "en")).toBe("Reset time unknown");
  });

  it("formats the weekly reset as a compact date", () => {
    expect(formatResetDate("2026-07-10T00:00:00+08:00")).toBe("7/10");
    expect(formatResetDate("2026-07-10T00:00:00+08:00", "en")).toBe("7/10");
    expect(formatResetDate(null)).toBe("日期未知");
    expect(formatResetDate(null, "zh-CN")).toBe("日期未知");
    expect(formatResetDate(null, "en")).toBe("Date unknown");
  });

  it("classifies reset-credit expiration at the 3, 2, and 1 day boundaries", () => {
    const now = new Date("2026-07-14T12:00:00Z");
    expect(resetCreditExpiryState("2026-07-18T12:00:00Z", now)).toMatchObject({ urgency: "normal", daysRemaining: 4 });
    expect(resetCreditExpiryState("2026-07-17T12:00:00Z", now)).toMatchObject({ urgency: "soon", daysRemaining: 3 });
    expect(resetCreditExpiryState("2026-07-16T12:00:00Z", now)).toMatchObject({ urgency: "warning", daysRemaining: 2 });
    expect(resetCreditExpiryState("2026-07-15T12:00:00Z", now)).toMatchObject({ urgency: "critical", daysRemaining: 1 });
    expect(resetCreditExpiryState("2026-07-14T11:59:59Z", now)).toMatchObject({ urgency: "expired", daysRemaining: 0 });
    expect(resetCreditExpiryState("invalid", now)).toMatchObject({ urgency: "unknown", daysRemaining: null });
  });
});
