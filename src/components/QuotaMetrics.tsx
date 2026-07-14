import {
  ArrowClockwise,
  ClockCounterClockwise,
  CloudSlash,
  SignIn,
  SpinnerGap,
  WarningCircle,
} from "@phosphor-icons/react";
import { memo, useMemo, useState } from "react";
import {
  formatDateTime,
  formatResetTime,
  formatUpdatedTime,
  isStaleExpired,
  normalizePercent,
  overallQuotaTier,
} from "../lib/format";
import { copy, normalizeLanguage } from "../lib/i18n";
import type { Language, ProviderSnapshot, SnapshotStatus } from "../types";

interface QuotaMetricsProps {
  snapshot: ProviderSnapshot;
  language: Language;
  refreshing?: boolean;
  compact?: boolean;
  onRefresh?: () => void;
}

function backendMessage(message: string | null, language: Language): string | null {
  if (!message) return null;
  if (language === "en") return message;
  const normalized = message.toLowerCase();
  if (normalized.includes("login") && normalized.includes("temporarily unavailable")) return "Codex 登录文件暂时无法读取，应用将自动重试。";
  if (normalized.includes("format")) return "额度或登录响应格式发生变化，已停止展示不可靠数据。";
  if (normalized.includes("sign in") || normalized.includes("login")) return "Codex 登录状态不可用，请重新登录。";
  if (normalized.includes("rate limit")) return "请求过于频繁，应用将稍后重试。";
  if (normalized.includes("network")) return "当前网络不可用，应用将自动重试。";
  if (normalized.includes("missing the 5h")) return "额度响应暂未包含 5 小时窗口。";
  if (normalized.includes("already running")) return "额度正在刷新，请稍候。";
  return message;
}

function StateIcon({ status, expired }: { status: SnapshotStatus; expired: boolean }) {
  if (status === "loading") return <SpinnerGap className="is-spinning" />;
  if (status === "signed_out") return <SignIn />;
  if (status === "stale" || expired) return <ClockCounterClockwise />;
  if (status === "unavailable") return <CloudSlash />;
  return <WarningCircle />;
}

function MetricTile({
  label,
  percent,
  reset,
  unavailableLabel,
}: {
  label: string;
  percent: number | null;
  reset: string;
  unavailableLabel: string;
}) {
  return (
    <article className={`metric-tile${percent === null ? " metric-tile--empty" : ""}`}>
      <p>{label}</p>
      <strong>{percent === null ? "—" : percent}<small>{percent === null ? "" : "%"}</small></strong>
      <div
        className="metric-track"
        role={percent === null ? undefined : "progressbar"}
        aria-label={label}
        aria-valuemin={percent === null ? undefined : 0}
        aria-valuemax={percent === null ? undefined : 100}
        aria-valuenow={percent ?? undefined}
      >
        {percent === null ? null : <span style={{ width: `${percent}%` }} />}
      </div>
      <small className="metric-reset">{percent === null ? unavailableLabel : reset}</small>
    </article>
  );
}

export const QuotaMetrics = memo(function QuotaMetrics({
  snapshot,
  language,
  refreshing = false,
  compact = false,
  onRefresh,
}: QuotaMetricsProps) {
  const activeLanguage = normalizeLanguage(language);
  const t = copy[activeLanguage];
  const [showCredits, setShowCredits] = useState(false);
  const short = normalizePercent(snapshot.shortWindow?.remainingPercent);
  const weekly = normalizePercent(snapshot.weeklyWindow?.remainingPercent);
  const expired = isStaleExpired(snapshot);
  const hasValues = short !== null || weekly !== null;
  const canShowValues = snapshot.status !== "signed_out" && !expired && hasValues;
  const tier = overallQuotaTier(snapshot);
  const message = backendMessage(snapshot.message, activeLanguage);
  const creditExpirations = useMemo(
    () => (snapshot.resetCreditExpiresAt ?? []).map((value, index) => t.creditItem(index, formatDateTime(value, activeLanguage))),
    [activeLanguage, snapshot.resetCreditExpiresAt, t],
  );

  if (!canShowValues) {
    const isLoading = snapshot.status === "loading";
    const title = isLoading
      ? t.loadingQuota
      : snapshot.status === "signed_out"
        ? t.signedInRequired
        : expired
          ? t.staleExpired
          : t.temporarilyUnavailable;
    const hint = isLoading
      ? t.loadingHint
      : snapshot.status === "signed_out"
        ? message ?? t.signedOutHint
        : expired
          ? t.staleHint
          : message ?? t.errorUnavailable;
    return (
      <section className={`quota-empty quota-empty--${snapshot.status}`} aria-live="polite" aria-busy={isLoading || refreshing}>
        <div className="quota-empty__icon" aria-hidden="true"><StateIcon status={snapshot.status} expired={expired} /></div>
        <strong>{title}</strong>
        <p>{hint}</p>
        {!isLoading && onRefresh ? (
          <button type="button" className="secondary-button" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? <SpinnerGap className="is-spinning" /> : <ArrowClockwise />}
            <span>{refreshing ? t.refreshing : t.refresh}</span>
          </button>
        ) : null}
      </section>
    );
  }

  const partial = short === null || weekly === null || snapshot.status === "unavailable";
  return (
    <section className={`quota-metrics quota-metrics--${tier}${compact ? " quota-metrics--compact" : ""}`} aria-live="polite" aria-busy={refreshing}>
      {snapshot.status === "stale" || partial ? (
        <div className={`data-banner${snapshot.status === "stale" ? " data-banner--stale" : ""}`} role="status">
          <ClockCounterClockwise aria-hidden="true" />
          <span>{snapshot.status === "stale" ? t.dataStale : t.partialData}</span>
          <small>{t.lastUpdated(formatUpdatedTime(snapshot.updatedAt, new Date(), activeLanguage))}</small>
        </div>
      ) : null}
      <div className="metric-grid">
        <MetricTile
          label={t.fiveHour}
          percent={short}
          reset={formatResetTime(snapshot.shortWindow?.resetsAt ?? null, new Date(), activeLanguage)}
          unavailableLabel={t.temporarilyUnavailable}
        />
        <MetricTile
          label={t.weeklyRemaining}
          percent={weekly}
          reset={formatResetTime(snapshot.weeklyWindow?.resetsAt ?? null, new Date(), activeLanguage)}
          unavailableLabel={t.temporarilyUnavailable}
        />
      </div>
      <div className="credit-summary">
        <div>
          <span>{t.resetCreditsTitle}</span>
          <strong>
            {snapshot.resetCredits === null
              ? t.resetCreditUnknown
              : snapshot.resetCredits === 0
                ? t.noResetCredits
                : t.resetCredits(snapshot.resetCredits)}
          </strong>
        </div>
        {snapshot.resetCredits !== null && snapshot.resetCredits > 0 ? (
          <button type="button" className="text-button" onClick={() => setShowCredits((value) => !value)} aria-expanded={showCredits}>{t.view}</button>
        ) : null}
      </div>
      {showCredits ? (
        <div className="credit-popover" role="status">
          {creditExpirations.length > 0
            ? creditExpirations.map((item) => <p key={item}>{item}</p>)
            : <p>{t.noCreditExpiration}</p>}
        </div>
      ) : null}
    </section>
  );
});
