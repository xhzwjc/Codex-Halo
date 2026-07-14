import { memo, useCallback, useEffect, useRef, useState } from "react";
import { setWidgetExpanded, startDragging } from "../lib/bridge";
import { copy, normalizeLanguage } from "../lib/i18n";
import type { ProviderSnapshot, WidgetPreferences } from "../types";
import { QuotaCard, QuotaOrb } from "./QuotaCard";

interface FloatingWidgetProps {
  snapshot: ProviderSnapshot;
  preferences: WidgetPreferences;
  refreshing: boolean;
  notice?: string | null;
  onRefresh: () => void;
  onToggleAlwaysOnTop: () => void;
}

export const FloatingWidget = memo(function FloatingWidget({
  snapshot,
  preferences,
  refreshing,
  notice = null,
  onRefresh,
  onToggleAlwaysOnTop,
}: FloatingWidgetProps) {
  const [compact, setCompact] = useState(true);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const collapseTimer = useRef<number | null>(null);
  const hoverSequence = useRef(0);
  const expanded = useRef(false);
  const t = copy[normalizeLanguage(preferences.language)];

  useEffect(() => () => {
    if (collapseTimer.current !== null) window.clearTimeout(collapseTimer.current);
  }, []);

  const handleHover = useCallback((hovered: boolean) => {
    if (collapseTimer.current !== null) {
      window.clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
    if (hovered) {
      if (expanded.current) return;
      expanded.current = true;
      const sequence = ++hoverSequence.current;
      setTransitionError(null);
      void setWidgetExpanded(true)
        .then(() => { if (hoverSequence.current === sequence) setCompact(false); })
        .catch(() => {
          if (hoverSequence.current === sequence) setCompact(false);
          setTransitionError(t.windowActionFailed);
        });
      return;
    }
    const sequence = ++hoverSequence.current;
    collapseTimer.current = window.setTimeout(() => {
      if (hoverSequence.current !== sequence) return;
      expanded.current = false;
      setCompact(true);
      void setWidgetExpanded(false).catch(() => setTransitionError(t.windowActionFailed));
    }, 180);
  }, [t.windowActionFailed]);

  if (compact) {
    return <QuotaOrb snapshot={snapshot} language={preferences.language} onDrag={() => startDragging()} onHover={handleHover} />;
  }

  return (
    <QuotaCard
      snapshot={snapshot}
      preferences={preferences}
      providerCount={1}
      onDrag={() => startDragging()}
      onHover={handleHover}
      onRefresh={onRefresh}
      onLock={onToggleAlwaysOnTop}
      isRefreshing={refreshing}
      notice={notice ?? transitionError}
    />
  );
});
