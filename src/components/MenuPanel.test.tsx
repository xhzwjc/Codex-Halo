// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderSnapshot, WidgetPreferences } from "../types";
import { MenuPanel } from "./MenuPanel";

const snapshot: ProviderSnapshot = {
  provider: "codex",
  displayName: "CODEX",
  plan: "PRO",
  shortWindow: { remainingPercent: 74, resetsAt: null, windowSeconds: 18_000 },
  weeklyWindow: { remainingPercent: 42, resetsAt: null, windowSeconds: 604_800 },
  resetCredits: null,
  updatedAt: new Date().toISOString(),
  status: "ok",
  message: null,
};
const preferences: WidgetPreferences = {
  locked: false,
  alwaysOnTop: true,
  pinnedProvider: null,
  autoRotateSeconds: 12,
  language: "zh-CN",
};

afterEach(cleanup);

describe("MenuPanel", () => {
  it("exposes every requested desktop action", () => {
    const actions = {
      onRefresh: vi.fn(),
      onToggleWidget: vi.fn(),
      onToggleAlwaysOnTop: vi.fn(),
      onToggleAutostart: vi.fn(),
      onToggleLanguage: vi.fn(),
      onToggleClickThrough: vi.fn(),
      onQuit: vi.fn(),
    };
    render(
      <MenuPanel
        snapshot={snapshot}
        preferences={preferences}
        widgetVisible
        autostartEnabled={false}
        refreshing={false}
        {...actions}
      />,
    );

    expect(screen.getByText("额度偏低")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刷新额度数据" }));
    fireEvent.click(screen.getByRole("switch", { name: /隐藏悬浮窗/ }));
    fireEvent.click(screen.getByRole("switch", { name: /保持置顶/ }));
    fireEvent.click(screen.getByRole("switch", { name: /开机启动/ }));
    fireEvent.click(screen.getByRole("switch", { name: /鼠标穿透/ }));
    fireEvent.click(screen.getByRole("button", { name: /语言/ }));
    fireEvent.click(screen.getByRole("button", { name: /退出 Codex Halo/ }));

    expect(actions.onRefresh).toHaveBeenCalledOnce();
    expect(actions.onToggleWidget).toHaveBeenCalledOnce();
    expect(actions.onToggleAlwaysOnTop).toHaveBeenCalledOnce();
    expect(actions.onToggleAutostart).toHaveBeenCalledOnce();
    expect(actions.onToggleClickThrough).toHaveBeenCalledOnce();
    expect(actions.onToggleLanguage).toHaveBeenCalledOnce();
    expect(actions.onQuit).toHaveBeenCalledOnce();
  });

  it("disables refresh and an in-flight setting", () => {
    render(
      <MenuPanel
        snapshot={snapshot}
        preferences={preferences}
        widgetVisible
        autostartEnabled={false}
        refreshing
        pendingAction="autostart"
        onRefresh={() => {}}
        onToggleWidget={() => {}}
        onToggleAlwaysOnTop={() => {}}
        onToggleAutostart={() => {}}
        onToggleLanguage={() => {}}
        onToggleClickThrough={() => {}}
        onQuit={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "刷新额度数据" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: /开机启动/ })).toBeDisabled();
  });
});
