/**
 * Create or refresh Restormel Keys **ingestion** routes (Dashboard API) with multi-step fallbacks.
 *
 * Sophia resolves with workload `ingestion` and stage `ingestion_<substage>` (see
 * `src/lib/server/aaif/ingestion-plan.ts`, `restormelIngestionRoutes.ts`). Admin ingest UI matches
 * routes by `route.stage` equal to `ingestion_extraction`, etc.
 *
 * Requires:
 *   RESTORMEL_GATEWAY_KEY, RESTORMEL_PROJECT_ID
 *   RESTORMEL_ENVIRONMENT_ID (default: production)
 *   RESTORMEL_KEYS_BASE / RESTORMEL_BASE_URL (optional)
 *
 * Optional model overrides (defaults are sensible for Vertex + Anthropic):
 *   RESTORMEL_BOOTSTRAP_PRIMARY_PROVIDER / RESTORMEL_BOOTSTRAP_PRIMARY_MODEL
 *   RESTORMEL_BOOTSTRAP_FALLBACK_PROVIDER / RESTORMEL_BOOTSTRAP_FALLBACK_MODEL
 *   RESTORMEL_BOOTSTRAP_FALLBACK2_PROVIDER / RESTORMEL_BOOTSTRAP_FALLBACK2_MODEL
 *
 * Usage:
 *   pnpm restormel:ingestion-bootstrap plan
 *   pnpm restormel:ingestion-bootstrap apply
 *   pnpm restormel:ingestion-bootstrap apply --shared
 *   pnpm restormel:ingestion-bootstrap verify
 */

import type { RestormelRouteRecord, RestormelStepRecord } from '../../src/lib/server/restormel.js';
import {
  RESTORMEL_ENVIRONMENT_ID,
  restormelListRoutes,
  restormelPublishRoute,
  restormelResolve,
  restormelSaveRoute,
  restormelSaveRouteSteps
} from '../../src/lib/server/restormel.js';

type StageDef = {
  /** Substage key without prefix (matches DiscoverableIngestionStage). */
  substage: string;
  /** Restormel route `stage` field and admin `RESTORMEL_STAGES[].key`. */
  routeStage: string;
  label: string;
};

const DEDICATED_STAGES: StageDef[] = [
  { substage: 'extraction', routeStage: 'ingestion_extraction', label: 'Extraction' },
  { substage: 'relations', routeStage: 'ingestion_relations', label: 'Relations' },
  { substage: 'grouping', routeStage: 'ingestion_grouping', label: 'Grouping' },
  { substage: 'validation', routeStage: 'ingestion_validation', label: 'Validation' },
  { substage: 'json_repair', routeStage: 'ingestion_json_repair', label: 'JSON repair' }
];

const SHARED_ROUTE_NAME = 'Sophia — Ingestion (shared fallback)';

function normalizeStage(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function findDedicatedRoute(
  routes: RestormelRouteRecord[],
  routeStage: string
): RestormelRouteRecord | undefined {
  const want = normalizeStage(routeStage);
  return routes.find(
    (r) => normalizeStage(r.workload) === 'ingestion' && normalizeStage(r.stage) === want
  );
}

function findSharedRoute(routes: RestormelRouteRecord[]): RestormelRouteRecord | undefined {
  return routes.find((r) => normalizeStage(r.workload) === 'ingestion' && !normalizeStage(r.stage));
}

function buildDefaultSteps(): RestormelStepRecord[] {
  const primaryProvider = process.env.RESTORMEL_BOOTSTRAP_PRIMARY_PROVIDER?.trim() || 'vertex';
  const primaryModel =
    process.env.RESTORMEL_BOOTSTRAP_PRIMARY_MODEL?.trim() || 'gemini-2.5-flash';
  const fb1Provider = process.env.RESTORMEL_BOOTSTRAP_FALLBACK_PROVIDER?.trim() || 'anthropic';
  const fb1Model =
    process.env.RESTORMEL_BOOTSTRAP_FALLBACK_MODEL?.trim() || 'claude-3-5-haiku-20241022';
  const fb2Provider = process.env.RESTORMEL_BOOTSTRAP_FALLBACK2_PROVIDER?.trim() || 'vertex';
  const fb2Model =
    process.env.RESTORMEL_BOOTSTRAP_FALLBACK2_MODEL?.trim() || 'gemini-2.5-pro';

  const switchCriteria = {
    onFailureKinds: [
      'timeout',
      'rate_limit',
      'provider_unhealthy',
      'quota_exceeded',
      'unknown_error'
    ],
    requiresHealthyProvider: true
  };

  return [
    {
      id: 'step_primary',
      orderIndex: 0,
      enabled: true,
      providerPreference: primaryProvider,
      modelId: primaryModel,
      switchCriteria,
      retryPolicy: {
        maxRetries: 1,
        backoffMs: 1000,
        retryOnFailureKinds: ['timeout']
      }
    },
    {
      id: 'step_fallback_1',
      orderIndex: 1,
      enabled: true,
      providerPreference: fb1Provider,
      modelId: fb1Model,
      switchCriteria,
      retryPolicy: {
        maxRetries: 1,
        backoffMs: 1500,
        retryOnFailureKinds: ['timeout']
      }
    },
    {
      id: 'step_fallback_2',
      orderIndex: 2,
      enabled: true,
      providerPreference: fb2Provider,
      modelId: fb2Model
    }
  ];
}

function printHelp(): void {
  console.log(`bootstrap-ingestion-routes

Commands:
  plan              List current ingestion routes vs expected stages (no writes)
  apply             Create missing routes, write fallback steps, publish each route
  apply --shared    Also ensure a shared ingestion route (empty stage) with the same steps
  verify            POST /resolve for each ingestion_* stage (smoke test)

Environment: RESTORMEL_GATEWAY_KEY, RESTORMEL_PROJECT_ID, RESTORMEL_ENVIRONMENT_ID
Optional: RESTORMEL_BOOTSTRAP_* model/provider overrides (see script header).
`);
}

async function ensureRouteRecord(options: {
  routes: RestormelRouteRecord[];
  routeStage: string;
  name: string;
}): Promise<{ route: RestormelRouteRecord; created: boolean }> {
  const existing = findDedicatedRoute(options.routes, options.routeStage);
  if (existing?.id) {
    return { route: existing, created: false };
  }

  const { data } = await restormelSaveRoute({
    name: options.name,
    environmentId: RESTORMEL_ENVIRONMENT_ID,
    workload: 'ingestion',
    stage: options.routeStage,
    enabled: true
  });

  if (!data?.id) {
    throw new Error(`restormelSaveRoute returned no id for ${options.routeStage}`);
  }

  return { route: data, created: true };
}

async function ensureSharedRouteRecord(options: {
  routes: RestormelRouteRecord[];
}): Promise<{ route: RestormelRouteRecord; created: boolean }> {
  const existing = findSharedRoute(options.routes);
  if (existing?.id) {
    return { route: existing, created: false };
  }

  const { data } = await restormelSaveRoute({
    name: SHARED_ROUTE_NAME,
    environmentId: RESTORMEL_ENVIRONMENT_ID,
    workload: 'ingestion',
    enabled: true
  });

  if (!data?.id) {
    throw new Error('restormelSaveRoute returned no id for shared ingestion route');
  }

  return { route: data, created: true };
}

async function applyStepsAndPublish(routeId: string): Promise<void> {
  const steps = buildDefaultSteps();

  await restormelSaveRouteSteps(routeId, steps);
  try {
    await restormelPublishRoute(routeId, {});
    console.log(`  Published route ${routeId}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `  Publish failed for ${routeId} (${msg}). If your Keys build has no publish endpoint, publish in the UI.`
    );
  }
}

async function cmdPlan(includeShared: boolean): Promise<void> {
  const { data } = await restormelListRoutes({
    environmentId: RESTORMEL_ENVIRONMENT_ID,
    workload: 'ingestion'
  });
  const routes = Array.isArray(data) ? data : [];
  console.log(
    `Environment: ${RESTORMEL_ENVIRONMENT_ID} — ${routes.length} ingestion route(s) listed.\n`
  );

  for (const s of DEDICATED_STAGES) {
    const hit = findDedicatedRoute(routes, s.routeStage);
    console.log(
      `${s.routeStage}: ${hit?.id ? hit.id : 'MISSING'}${hit?.name ? ` — ${hit.name}` : ''}`
    );
  }

  if (includeShared) {
    const shared = findSharedRoute(routes);
    console.log(
      `(shared): ${shared?.id ? shared.id : 'MISSING'}${shared?.name ? ` — ${shared.name}` : ''}`
    );
  }

  console.log('\nDefault step chain (apply uses this unless RESTORMEL_BOOTSTRAP_* is set):');
  console.log(JSON.stringify(buildDefaultSteps(), null, 2));
}

async function cmdApply(includeShared: boolean): Promise<void> {
  let { data } = await restormelListRoutes({
    environmentId: RESTORMEL_ENVIRONMENT_ID,
    workload: 'ingestion'
  });
  let routes = Array.isArray(data) ? data : [];

  for (const s of DEDICATED_STAGES) {
    const name = `Sophia — Ingestion ${s.label}`;
    const { route, created } = await ensureRouteRecord({
      routes,
      routeStage: s.routeStage,
      name
    });
    if (created) {
      console.log(`Created route ${route.id} (${s.routeStage})`);
      routes.push(route);
    } else {
      console.log(`Using existing route ${route.id} (${s.routeStage})`);
    }
    await applyStepsAndPublish(route.id);
  }

  if (includeShared) {
    const { route, created } = await ensureSharedRouteRecord({ routes });
    if (created) {
      console.log(`Created shared route ${route.id}`);
    } else {
      console.log(`Using existing shared route ${route.id}`);
    }
    await applyStepsAndPublish(route.id);
  }

  console.log('\nDone. Optional: run `pnpm restormel:ingestion-bootstrap verify`.');
}

async function cmdVerify(): Promise<void> {
  const task = 'completion' as const;
  let failures = 0;

  for (const s of DEDICATED_STAGES) {
    const usage = { inputTokens: 12_000, inputChars: 48_000 };
    try {
      const res = await restormelResolve({
        environmentId: RESTORMEL_ENVIRONMENT_ID,
        workload: 'ingestion',
        stage: `ingestion_${s.substage}`,
        task,
        attempt: 1,
        estimatedInputTokens: usage.inputTokens,
        estimatedInputChars: usage.inputChars,
        complexity: 'medium',
        constraints: { latency: 'balanced' }
      });
      const d = res.data;
      const chain =
        Array.isArray(d.stepChain) && d.stepChain.length > 0
          ? ` chain=${d.stepChain.length}sel=${d.stepChain.filter((x) => x.selected).length}`
          : '';
      console.log(
        `OK ${s.routeStage}: routeId=${d.routeId} provider=${d.providerType} model=${d.modelId} step=${d.selectedStepId ?? '—'}${chain}`
      );
    } catch (e) {
      failures += 1;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`FAIL ${s.routeStage}: ${msg}`);
    }
  }

  if (failures > 0) {
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const includeShared = argv.includes('--shared');

  if (!cmd || cmd === '-h' || cmd === '--help') {
    printHelp();
    process.exit(cmd ? 0 : 1);
  }

  try {
    if (cmd === 'plan') {
      await cmdPlan(includeShared);
      return;
    }
    if (cmd === 'apply') {
      await cmdApply(includeShared);
      return;
    }
    if (cmd === 'verify') {
      await cmdVerify();
      return;
    }

    console.error(`Unknown command: ${cmd}`);
    printHelp();
    process.exit(1);
  } catch (e) {
    console.error(`[bootstrap-ingestion-routes] ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

void main();
