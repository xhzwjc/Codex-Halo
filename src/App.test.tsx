// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopEventHandlers } from "./lib/bridge";
import type { DesktopState, ProviderSnapshot, UsageStats, WidgetPreferences } from "./types";

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  handlers: null as DesktopEventHandlers | null,
  getAppState: vi.fn(),
  getDesktopView: vi.fn(),
  refreshSnapshots: vi.fn(),
  getUsageStats: vi.fn(),
}));

const preferences: WidgetPreferences = {
  locked: false,
  alwaysOnTop: true,
  pinnedProvider: null,
  autoRotateSeconds: 12,
  language: "zh-CN",
};
const snapshot: ProviderSnapshot = {
  provider: "codex",
  displayName: "CODEX",
  plan: "PRO",
  shortWindow: { remainingPercent: 74, resetsAt: null, windowSeconds: 18_000 },
  weeklyWindow: { remainingPercent: 42, resetsAt: null, windowSeconds: 604_800 },
  resetCredits: 0,
  updatedAt: new Date().toISOString(),
  status: "ok",
  message: null,
};
const desktopState: DesktopState = {
  snapshots: [snapshot],
  preferences,
  widgetVisible: true,
  autostartEnabled: false,
  refreshing: false,
  revision: 1,
  lastAttemptAt: snapshot.updatedAt,
  lastSuccessAt: snapshot.updatedAt,
  nextRefreshAt: null,
};
const usageStats: UsageStats = {
  status: "ok",
  generatedAt: "2026-07-15T00:00:00Z",
  firstActivityDate: "2026-07-15",
  lastActivityDate: "2026-07-15",
  inputTokens: 900,
  cachedInputTokens: 0,
  outputTokens: 100,
  reasoningOutputTokens: 0,
  totalTokens: 1000,
  sessionCount: 1,
  activeDays: 1,
  currentStreak: 1,
  longestStreak: 1,
  indexedFiles: 1,
  skippedFiles: 0,
  models: [],
  daily: [],
};

vi.mock("./lib/bridge", () => ({
  defaultPreferences: { locked: false, alwaysOnTop: true, pinnedProvider: null, autoRotateSeconds: 12, language: "zh-CN" },
  getDesktopView: () => mocks.getDesktopView(),
  getAppState: () => {
    mocks.order.push("get");
    return mocks.getAppState();
  },
  listenDesktopEvents: async (handlers: DesktopEventHandlers) => {
    mocks.order.push("listen");
    mocks.handlers = handlers;
    return () => undefined;
  },
  refreshSnapshots: () => mocks.refreshSnapshots(),
  getUsageStats: () => mocks.getUsageStats(),
  quitApp: vi.fn(),
  setAlwaysOnTop: vi.fn(),
  setAutostart: vi.fn(),
  setClickThrough: vi.fn(),
  setLanguage: vi.fn(),
  setWidgetVisible: vi.fn(),
  setWidgetExpanded: vi.fn().mockResolvedValue(undefined),
  startDragging: vi.fn(),
}));

import App from "./App";

afterEach(cleanup);

describe("App native state subscription", () => {
  beforeEach(() => {
    mocks.order.length = 0;
    mocks.handlers = null;
    mocks.getDesktopView.mockReset().mockResolvedValue("panel");
    mocks.getAppState.mockReset().mockResolvedValue(desktopState);
    mocks.refreshSnapshots.mockReset().mockResolvedValue([snapshot]);
    mocks.getUsageStats.mockReset().mockResolvedValue(usageStats);
  });

  it("subscribes before hydration and applies later snapshot revisions", async () => {
    render(<App />);
    expect(await screen.findByText("74")).toBeInTheDocument();
    expect(mocks.order.slice(0, 2)).toEqual(["listen", "get"]);

    act(() => {
      mocks.handlers?.onSnapshots({
        snapshots: [{ ...snapshot, shortWindow: { ...snapshot.shortWindow!, remainingPercent: 61 } }],
        refreshing: false,
        revision: 2,
        lastAttemptAt: snapshot.updatedAt,
        lastSuccessAt: snapshot.updatedAt,
        nextRefreshAt: null,
      });
    });
    expect(screen.getByText("61")).toBeInTheDocument();
    expect(screen.queryByText("74")).not.toBeInTheDocument();
  });

  it("ignores a snapshot event older than the hydrated revision", async () => {
    mocks.getAppState.mockResolvedValue({ ...desktopState, revision: 3 });
    render(<App />);
    expect(await screen.findByText("74")).toBeInTheDocument();
    act(() => {
      mocks.handlers?.onSnapshots({
        snapshots: [{ ...snapshot, shortWindow: { ...snapshot.shortWindow!, remainingPercent: 12 } }],
        refreshing: false,
        revision: 2,
        lastAttemptAt: null,
        lastSuccessAt: null,
        nextRefreshAt: null,
      });
    });
    expect(screen.getByText("74")).toBeInTheDocument();
    expect(screen.queryByText("12")).not.toBeInTheDocument();
  });

  it("does not let late hydration overwrite events observed during startup", async () => {
    let resolveHydration: (value: DesktopState) => void = () => undefined;
    mocks.getAppState.mockReturnValue(new Promise<DesktopState>((resolve) => { resolveHydration = resolve; }));
    render(<App />);
    await waitFor(() => expect(mocks.handlers).not.toBeNull());

    act(() => {
      mocks.handlers?.onSnapshots({
        snapshots: [{ ...snapshot, shortWindow: { ...snapshot.shortWindow!, remainingPercent: 61 } }],
        refreshing: false,
        revision: 2,
        lastAttemptAt: snapshot.updatedAt,
        lastSuccessAt: snapshot.updatedAt,
        nextRefreshAt: null,
      });
      mocks.handlers?.onPreferences({ ...preferences, language: "en" });
      mocks.handlers?.onWidgetVisibility(false);
      mocks.handlers?.onAutostart(true);
    });
    await act(async () => { resolveHydration(desktopState); });

    expect(screen.getByText("61")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Show floating window" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "Launch at login" })).toHaveAttribute("aria-checked", "true");
  });

  it("keeps the loading state when native refresh is active before the first snapshot", async () => {
    mocks.getAppState.mockResolvedValue({ ...desktopState, snapshots: [], refreshing: true });
    render(<App />);

    expect(await screen.findAllByText("正在读取额度")).toHaveLength(2);
    expect(screen.queryByText("暂时无法读取")).not.toBeInTheDocument();
  });

  it("refreshes quota and local usage together from the panel action", async () => {
    render(<App />);
    await screen.findByText("74");

    act(() => {
      screen.getByRole("button", { name: "刷新额度与本地使用统计" }).click();
    });

    await waitFor(() => {
      expect(mocks.refreshSnapshots).toHaveBeenCalledOnce();
      expect(mocks.getUsageStats).toHaveBeenCalledOnce();
    });
  });
});
