import { Timestamp } from 'firebase-admin/firestore';
import { PostHog } from 'posthog-node';
import { adminDb } from '$lib/server/firebase-admin';

export interface ServerAnalyticsEvent {
  event: string;
  uid?: string | null;
  key_id?: string | null;
  request_id?: string | null;
  route?: string;
  success?: boolean;
  status?: number;
  latency_ms?: number;
  [key: string]: unknown;
}

const posthogHost = (process.env.POSTHOG_HOST || 'https://eu.i.posthog.com').replace(/\/+$/, '');
const posthogProjectApiKey = process.env.POSTHOG_PROJECT_API_KEY?.trim() || '';
const posthogProjectId = process.env.POSTHOG_PROJECT_ID?.trim() || '';
const enableFirestoreFallback = process.env.ENABLE_FIRESTORE_ANALYTICS_FALLBACK === 'true';
let posthogClient: PostHog | null = null;

function getPostHogClient(): PostHog | null {
  if (!posthogProjectApiKey) return null;
  if (posthogClient) return posthogClient;

  posthogClient = new PostHog(posthogProjectApiKey, {
    host: posthogHost,
    flushAt: 1,
    flushInterval: 0
  });

  return posthogClient;
}

function eventDistinctId(event: ServerAnalyticsEvent): string {
  const value = event.uid ?? event.key_id ?? event.request_id ?? 'anonymous';
  return String(value);
}

async function sendToPostHog(event: ServerAnalyticsEvent): Promise<void> {
  const client = getPostHogClient();
  if (!client) return;

  const { event: eventName, ...rest } = event;
  await client.captureImmediate({
    event: eventName,
    distinctId: eventDistinctId(event),
    properties: {
      ...rest,
      source: 'sophia-api',
      service: process.env.K_SERVICE || 'sophia-local',
      environment: process.env.NODE_ENV || 'development',
      posthog_project_id: posthogProjectId || undefined
    },
    timestamp: new Date()
  });
}

async function sendToFirestore(event: ServerAnalyticsEvent): Promise<void> {
  await adminDb.collection('analytics').add({
    ...event,
    created_at: Timestamp.now()
  });
}

export async function logServerAnalytics(event: ServerAnalyticsEvent): Promise<void> {
  if (!posthogProjectApiKey && !enableFirestoreFallback) return;

  try {
    await Promise.all([
      sendToPostHog(event),
      ...(enableFirestoreFallback ? [sendToFirestore(event)] : [])
    ]);
  } catch (error) {
    console.warn('[ANALYTICS] Failed to write event:', error instanceof Error ? error.message : String(error));
  }
}
