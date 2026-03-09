/**
 * SOPHIA — Analytics helpers
 *
 * Thin, typed wrapper around GA4's gtag. Fires no-op if GA4 is not loaded
 * (e.g. ad blocker, missing measurement ID, SSR). All events are anonymous —
 * no PII is included in any event payload.
 */

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

type AnalyticsEvent =
  | { name: 'query_submitted'; params: { query_length: number; has_lens: boolean } }
  | { name: 'analysis_complete'; params: { duration_ms: number; claims_retrieved: number; detected_domain: string } }
  | { name: 'verification_triggered' }
  | { name: 'cache_hit' }
  | { name: 'panel_opened'; params: { panel: string } }
  | { name: 'follow_up_selected' }
  | { name: 'history_item_loaded' }
  | { name: 'map_mode_changed'; params: { mode: 'structure' | 'flow' | 'trust' } }
  | { name: 'map_node_selected'; params: { node_type: 'source' | 'claim' } }
  | { name: 'map_share_link_copied'; params: { safe_mode: boolean } }
  | { name: 'map_degraded_state'; params: { reason: string } };

type EventName = AnalyticsEvent['name'];
type EventParams<T extends EventName> = Extract<AnalyticsEvent, { name: T }> extends {
  params: infer P;
}
  ? P
  : undefined;

export function trackEvent<T extends EventName>(
  ...args: EventParams<T> extends undefined ? [name: T] : [name: T, params: EventParams<T>]
): void {
  if (typeof window === 'undefined' || !window.gtag) return;
  const [name, params] = args;
  window.gtag('event', name, params ?? {});
}
