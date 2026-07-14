import type { ProviderId, ProviderSnapshot, SnapshotStatus } from "../types";

export function mergeSnapshots(current: ProviderSnapshot[], incoming: ProviderSnapshot[]): ProviderSnapshot[] {
  return incoming.map((next) => {
    if (next.status === "ok") return next;
    if (next.status === "signed_out") return next;
    if (next.shortWindow || next.weeklyWindow) return next;
    const previous = current.find((item) => item.provider === next.provider && (item.shortWindow || item.weeklyWindow));
    return previous
      ? { ...previous, status: "stale", message: next.message, updatedAt: previous.updatedAt }
      : next;
  });
}

export function emptySnapshot(
  status: SnapshotStatus,
  message: string | null,
  provider: ProviderId = "codex",
): ProviderSnapshot {
  return {
    provider,
    displayName: provider === "codex" ? "CODEX" : provider.toUpperCase(),
    plan: null,
    shortWindow: null,
    weeklyWindow: null,
    resetCredits: null,
    resetCreditExpiresAt: [],
    updatedAt: new Date().toISOString(),
    status,
    message,
  };
}
