import {
  ArrowClockwise,
  CursorClick,
  Eye,
  EyeSlash,
  Power,
  PushPin,
  RocketLaunch,
  SpinnerGap,
  Translate,
} from "@phosphor-icons/react";
import { memo, useState, type ReactNode } from "react";
import { overallQuotaTier } from "../lib/format";
import { copy, normalizeLanguage } from "../lib/i18n";
import type { ProviderSnapshot, UsageStats, WidgetPreferences } from "../types";
import { ProviderMark } from "./ProviderMark";
import { QuotaMetrics } from "./QuotaMetrics";
import { UsageStatsPanel } from "./UsageStatsPanel";

interface MenuPanelProps {
  snapshot: ProviderSnapshot;
  preferences: WidgetPreferences;
  widgetVisible: boolean;
  autostartEnabled: boolean;
  refreshing: boolean;
  usageStats?: UsageStats | null;
  usageLoading?: boolean;
  usageFailed?: boolean;
  initialSection?: "quota" | "stats";
  pendingAction?: string | null;
  notice?: ReactNode;
  onRefresh: () => void;
  onLoadUsageStats?: () => void;
  onToggleWidget: () => void;
  onToggleAlwaysOnTop: () => void;
  onToggleAutostart: () => void;
  onToggleLanguage: () => void;
  onToggleClickThrough: () => void;
  onQuit: () => void;
}

function SettingSwitch({
  icon,
  label,
  hint,
  checked,
  pending,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  checked: boolean;
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="setting-row" role="switch" aria-checked={checked} onClick={onClick} disabled={pending}>
      <span className="setting-row__icon" aria-hidden="true">{icon}</span>
      <span className="setting-row__copy"><strong>{label}</strong>{hint ? <small>{hint}</small> : null}</span>
      {pending ? <SpinnerGap className="is-spinning setting-row__pending" /> : <span className="switch-control" aria-hidden="true"><i /></span>}
    </button>
  );
}

export const MenuPanel = memo(function MenuPanel({
  snapshot,
  preferences,
  widgetVisible,
  autostartEnabled,
  refreshing,
  usageStats = null,
  usageLoading = false,
  usageFailed = false,
  initialSection = "quota",
  pendingAction = null,
  notice = null,
  onRefresh,
  onLoadUsageStats = () => undefined,
  onToggleWidget,
  onToggleAlwaysOnTop,
  onToggleAutostart,
  onToggleLanguage,
  onToggleClickThrough,
  onQuit,
}: MenuPanelProps) {
  const [section, setSection] = useState<"quota" | "stats">(initialSection);
  const language = normalizeLanguage(preferences.language);
  const t = copy[language];
  const tier = overallQuotaTier(snapshot);
  const statusLabel = snapshot.status === "loading"
    ? t.loadingQuota
    : snapshot.status === "signed_out"
      ? t.notSignedIn
      : snapshot.status === "unavailable"
        ? t.unavailableStatus
        : snapshot.status === "stale"
          ? t.dataStale
          : tier === "healthy"
            ? t.statusHealthy
            : tier === "caution"
              ? t.statusCaution
              : tier === "critical"
                ? t.statusCritical
                : t.statusUnknown;
  const actionLoading = refreshing || usageLoading;
  const handleSection = (next: "quota" | "stats") => {
    setSection(next);
    if (next === "stats") onLoadUsageStats();
  };

  return (
    <main className="menu-panel">
      <header className="panel-header">
        <div className="panel-brand">
          <ProviderMark />
          <div><strong>{t.appName}</strong><span>{section === "stats" ? t.usageStats : snapshot.plan ?? t.accountFallback}</span></div>
        </div>
        <div className="panel-header__actions">
          {section === "stats" ? (
            <span className="status-pill status-pill--local" title={t.localData}><i aria-hidden="true" />{t.localData}</span>
          ) : (
            <span className={`status-pill status-pill--${snapshot.status} status-pill--${tier}`} title={statusLabel}>
              <i aria-hidden="true" />{statusLabel}
            </span>
          )}
          <button
            type="button"
            className="refresh-button"
            onClick={onRefresh}
            disabled={actionLoading}
            aria-label={t.refreshAll}
          >
            {actionLoading ? <SpinnerGap className="is-spinning" /> : <ArrowClockwise />}
            <span>{actionLoading ? t.refreshing : t.refresh}</span>
          </button>
        </div>
      </header>

      <nav className="panel-section-tabs" aria-label={t.panelSections}>
        <button type="button" className={section === "quota" ? "is-active" : ""} aria-current={section === "quota" ? "page" : undefined} onClick={() => handleSection("quota")}>{t.panelTitle}</button>
        <button type="button" className={section === "stats" ? "is-active" : ""} aria-current={section === "stats" ? "page" : undefined} onClick={() => handleSection("stats")}>{t.usageStats}</button>
      </nav>

      {section === "quota" ? (
        <>
          <QuotaMetrics snapshot={snapshot} language={language} refreshing={refreshing} onRefresh={onRefresh} />
          <section className="panel-settings" aria-label={t.settings}>
            <h2>{t.settings}</h2>
            <div className="settings-group">
              <SettingSwitch
                icon={widgetVisible ? <Eye /> : <EyeSlash />}
                label={widgetVisible ? t.hideWidget : t.openWidget}
                checked={widgetVisible}
                pending={pendingAction === "widget"}
                onClick={onToggleWidget}
              />
              <SettingSwitch
                icon={<PushPin />}
                label={t.alwaysOnTop}
                checked={preferences.alwaysOnTop}
                pending={pendingAction === "alwaysOnTop"}
                onClick={onToggleAlwaysOnTop}
              />
              <SettingSwitch
                icon={<RocketLaunch />}
                label={t.launchAtLogin}
                checked={autostartEnabled}
                pending={pendingAction === "autostart"}
                onClick={onToggleAutostart}
              />
              <SettingSwitch
                icon={<CursorClick />}
                label={t.clickThrough}
                hint={preferences.locked ? t.clickThroughHint : undefined}
                checked={preferences.locked}
                pending={pendingAction === "clickThrough"}
                onClick={onToggleClickThrough}
              />
              <button type="button" className="setting-row" onClick={onToggleLanguage} disabled={pendingAction === "language"}>
                <span className="setting-row__icon" aria-hidden="true"><Translate /></span>
                <span className="setting-row__copy"><strong>{t.language}</strong><small>{language === "en" ? "English" : "简体中文"}</small></span>
                {pendingAction === "language" ? <SpinnerGap className="is-spinning setting-row__pending" /> : <span className="setting-value">{language === "en" ? "中" : "EN"}</span>}
              </button>
            </div>
          </section>

          {notice ? <div className="panel-notice" role="status">{notice}</div> : null}
          <button type="button" className="quit-button" onClick={onQuit}><Power /><span>{t.quit}</span></button>
        </>
      ) : (
        <UsageStatsPanel stats={usageStats} loading={usageLoading} failed={usageFailed} language={language} />
      )}

      {section === "stats" && notice ? <div className="panel-notice" role="status">{notice}</div> : null}
    </main>
  );
});
