import { query } from '$lib/server/db';
import { logServerAnalytics } from '$lib/server/analytics';
import type { GroundingMode } from './types';

export interface StoaTelemetryEvent {
  uid: string;
  sessionId: string;
  route: string;
  groundingMode: GroundingMode;
  escalated: boolean;
  errorTaxonomy?: string | null;
}

let stoaMetricsTablesEnsured = false;

async function ensureTables(): Promise<void> {
  if (stoaMetricsTablesEnsured) return;
  await query(`
    DEFINE TABLE IF NOT EXISTS stoa_observability_event SCHEMALESS;
    DEFINE INDEX IF NOT EXISTS stoa_obs_created ON stoa_observability_event FIELDS created_at;
  `);
  stoaMetricsTablesEnsured = true;
}

export async function recordStoaTelemetry(event: StoaTelemetryEvent): Promise<void> {
  await logServerAnalytics({
    event: 'stoa_dialogue_observed',
    uid: event.uid,
    route: event.route,
    grounding_mode: event.groundingMode,
    escalated: event.escalated,
    error_taxonomy: event.errorTaxonomy ?? null
  });
  try {
    await ensureTables();
    await query(
      `CREATE stoa_observability_event SET
         uid = $uid,
         session_id = $sessionId,
         route = $route,
         grounding_mode = $groundingMode,
         escalated = $escalated,
         error_taxonomy = $errorTaxonomy,
         created_at = time::now()`,
      {
        uid: event.uid,
        sessionId: event.sessionId,
        route: event.route,
        groundingMode: event.groundingMode,
        escalated: event.escalated,
        errorTaxonomy: event.errorTaxonomy ?? null
      }
    );
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[STOA] Telemetry write failed:', error instanceof Error ? error.message : String(error));
    }
  }
}

export async function loadStoaObservabilitySummary(): Promise<{
  total: number;
  graphDense: number;
  lexicalFallback: number;
  degradedNone: number;
  escalated: number;
  errors: Array<{ taxonomy: string; count: number }>;
}> {
  await ensureTables();
  const [totalRow] = await query<Array<{ count: number }>>(
    `SELECT count() AS count FROM stoa_observability_event GROUP ALL`
  );
  const [graphDenseRow] = await query<Array<{ count: number }>>(
    `SELECT count() AS count FROM stoa_observability_event WHERE grounding_mode = "graph_dense" GROUP ALL`
  );
  const [lexicalFallbackRow] = await query<Array<{ count: number }>>(
    `SELECT count() AS count FROM stoa_observability_event WHERE grounding_mode = "lexical_fallback" GROUP ALL`
  );
  const [degradedNoneRow] = await query<Array<{ count: number }>>(
    `SELECT count() AS count FROM stoa_observability_event WHERE grounding_mode = "degraded_none" GROUP ALL`
  );
  const [escalatedRow] = await query<Array<{ count: number }>>(
    `SELECT count() AS count FROM stoa_observability_event WHERE escalated = true GROUP ALL`
  );
  const errors = await query<Array<{ taxonomy: string; count: number }>>(
    `SELECT error_taxonomy AS taxonomy, count() AS count
     FROM stoa_observability_event
     WHERE error_taxonomy != NONE AND error_taxonomy != null
     GROUP BY error_taxonomy`
  );
  return {
    total: totalRow?.count ?? 0,
    graphDense: graphDenseRow?.count ?? 0,
    lexicalFallback: lexicalFallbackRow?.count ?? 0,
    degradedNone: degradedNoneRow?.count ?? 0,
    escalated: escalatedRow?.count ?? 0,
    errors: errors ?? []
  };
}

