export type ProviderId = "codex" | "claude";
export type SnapshotStatus = "ok" | "stale" | "loading" | "unavailable" | "signed_out";
export type Language = "zh-CN" | "en";
export type QuotaTier = "unknown" | "healthy" | "caution" | "critical";
export type DesktopView = "widget" | "panel";

export interface UsageWindow {
  remainingPercent: number;
  resetsAt: string | null;
  windowSeconds: number;
}

export interface ProviderSnapshot {
  provider: ProviderId;
  displayName: string;
  plan: string | null;
  shortWindow: UsageWindow | null;
  weeklyWindow: UsageWindow | null;
  resetCredits: number | null;
  resetCreditExpiresAt?: string[];
  updatedAt: string;
  status: SnapshotStatus;
  message: string | null;
}

export interface WidgetPreferences {
  locked: boolean;
  alwaysOnTop: boolean;
  pinnedProvider: ProviderId | null;
  autoRotateSeconds: number;
  language: Language;
}

export interface SnapshotState {
  snapshots: ProviderSnapshot[];
  refreshing: boolean;
  revision: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  nextRefreshAt: string | null;
}

export interface DesktopState extends SnapshotState {
  preferences: WidgetPreferences;
  widgetVisible: boolean;
  autostartEnabled: boolean;
}

export type SnapshotEventPayload = ProviderSnapshot[] | Partial<SnapshotState> & {
  snapshots: ProviderSnapshot[];
};
