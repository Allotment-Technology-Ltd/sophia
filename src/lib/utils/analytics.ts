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
  | { name: 'history_item_loaded' };

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
