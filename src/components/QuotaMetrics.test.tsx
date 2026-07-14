// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderSnapshot } from "../types";
import { QuotaMetrics } from "./QuotaMetrics";

const success: ProviderSnapshot = {
  provider: "codex",
  displayName: "CODEX",
  plan: "PRO",
  shortWindow: { remainingPercent: 74, resetsAt: "2026-07-15T00:00:00Z", windowSeconds: 18_000 },
  weeklyWindow: { remainingPercent: 8, resetsAt: "2026-07-20T00:00:00Z", windowSeconds: 604_800 },
  resetCredits: 0,
  resetCreditExpiresAt: [],
  updatedAt: new Date().toISOString(),
  status: "ok",
  message: null,
};

afterEach(cleanup);

describe("QuotaMetrics", () => {
  it("shows both real windows and distinguishes zero reset credits", () => {
    render(<QuotaMetrics snapshot={success} language="zh-CN" />);
    expect(screen.getByText("5 小时额度")).toBeInTheDocument();
    expect(screen.getByText("周额度")).toBeInTheDocument();
    expect(screen.getByText("74")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("暂无重置额度")).toBeInTheDocument();
  });

  it("does not leak old values into a signed-out state", () => {
    render(<QuotaMetrics snapshot={{ ...success, status: "signed_out", message: "Please sign in" }} language="en" />);
    expect(screen.getByText("Sign in to Codex")).toBeInTheDocument();
    expect(screen.queryByText("74")).not.toBeInTheDocument();
  });

  it("hides expired stale values and offers a real retry action", () => {
    const refresh = vi.fn();
    render(
      <QuotaMetrics
        snapshot={{ ...success, status: "stale", updatedAt: "2020-01-01T00:00:00Z", message: "Network unavailable" }}
        language="en"
        onRefresh={refresh}
      />,
    );
    expect(screen.getByText("Quota data expired")).toBeInTheDocument();
    expect(screen.queryByText("74")).not.toBeInTheDocument();
    screen.getByRole("button", { name: "Refresh" }).click();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("shows partial weekly data without fabricating the missing 5-hour value", () => {
    render(<QuotaMetrics snapshot={{ ...success, status: "unavailable", shortWindow: null }} language="en" />);
    expect(screen.getByText("Some quota data is unavailable")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("does not misreport a transient auth read failure as signed out", () => {
    render(
      <QuotaMetrics
        snapshot={{
          ...success,
          status: "unavailable",
          shortWindow: null,
          weeklyWindow: null,
          message: "Codex login data is temporarily unavailable.",
        }}
        language="zh-CN"
      />,
    );
    expect(screen.getByText("Codex 登录文件暂时无法读取，应用将自动重试。")).toBeInTheDocument();
    expect(screen.queryByText("请先登录 Codex")).not.toBeInTheDocument();
  });
});
