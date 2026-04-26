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
 *   RESTORMEL_KEYS_BASE (optional; defaults to https://restormel.dev)
 *
 * **Default published steps** match `canonicalModelChainForStage()` in
 * `src/lib/ingestionCanonicalPipeline.ts` (same primary + fallback ordering as durable Neon jobs when
 * `INGEST_PIN_*` is unset). **Extraction** starts with **Vertex `gemini-3-flash-preview`** — not an OpenAI-compatible
 * fine-tune (FT belongs in `EXTRACTION_*` env / operator pins, not as Restormel step 0).
 * Usage:
 *   pnpm restormel:ingestion-bootstrap plan
 *   pnpm restormel:ingestion-bootstrap apply
 *   pnpm restormel:ingestion-bootstrap apply --shared
 *   pnpm restormel:ingestion-bootstrap verify
 */

import {
  canonicalModelChainForStage,
  type IngestionLlmStageKey
} from '../../src/lib/ingestionCanonicalPipeline.js';
import type { RestormelRouteRecord, RestormelStepRecord } from '../../src/lib/server/restormel.js';
import {
  RestormelDashboardError,
  RESTORMEL_ENVIRONMENT_ID,
  restormelListRoutes,
  restormelPublishRoute,
  restormelReplaceRouteSteps,
  restormelResolve,
  restormelSaveRoute
} from '../../src/lib/server/restormel.js';

/** Aligns `ingestion_*` Restormel route stages with `IngestionLlmStageKey` (shared route uses extraction chain). */
const ROUTE_STAGE_TO_LLM: Record<string, IngestionLlmStageKey> = {
  ingestion_extraction: 'extraction',
  ingestion_relations: 'relations',
  ingestion_grouping: 'grouping',
  ingestion_validation: 'validation',
  ingestion_remediation: 'remediation',
  ingestion_json_repair: 'json_repair'
};

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
  { substage: 'remediation', routeStage: 'ingestion_remediation', label: 'Remediation' },
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

/** Maps contract provider slugs to Dashboard route-step `providerPreference` values. */
function providerPreferenceForRouteStep(provider: string): string {
  const p = provider.trim().toLowerCase();
  if (p === 'google') return 'vertex';
  return p;
}

const MAX_ROUTE_STEPS = 10;

/**
 * Publishes the same ordered model tiers as `canonicalModelChainForStage` (durable job defaults).
 * Extraction step 0 is always Vertex Gemini flash in canonical profile — not a fine-tuned OpenAI deployment.
 */
function buildCanonicalRestormelSteps(routeStage: string): RestormelStepRecord[] {
  const llm = ROUTE_STAGE_TO_LLM[routeStage] ?? 'extraction';
  const chain = canonicalModelChainForStage(llm).slice(0, MAX_ROUTE_STEPS);

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

  return chain.map((tier, idx) => {
    const step: RestormelStepRecord = {
      id: `step_${idx}`,
      orderIndex: idx,
      enabled: true,
      providerPreference: providerPreferenceForRouteStep(tier.provider),
      modelId: tier.modelId
    };
    if (idx < chain.length - 1) {
      step.switchCriteria = switchCriteria;
      step.retryPolicy = {
        maxRetries: 1,
        backoffMs: 1000,
        retryOnFailureKinds: ['timeout']
      };
    }
    return step;
  });
}

function printHelp(): void {
  console.log(`bootstrap-ingestion-routes

Commands:
  plan              List current ingestion routes vs expected stages (no writes)
  apply             Create missing routes, write fallback steps, publish each route
  apply --shared    Also ensure a shared ingestion route (empty stage) with the same steps
  verify            POST /resolve for each ingestion_* stage (smoke test)

Environment: RESTORMEL_GATEWAY_KEY, RESTORMEL_PROJECT_ID, RESTORMEL_ENVIRONMENT_ID
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

function isRestormelConflict(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /(^|\b)(409|conflict)(\b|$)/i.test(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function applyStepsAndPublish(routeId: string, routeStage: string): Promise<void> {
  const desired = buildCanonicalRestormelSteps(routeStage);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        await sleep(200 * attempt);
      }
      await restormelReplaceRouteSteps(routeId, desired);
      break;
    } catch (e) {
      if (e instanceof RestormelDashboardError) {
        console.error(
          `[bootstrap] save steps failed route=${routeId} status=${e.status} code=${e.code} detail=${e.detail}`
        );
      }
      if (attempt < 2 && isRestormelConflict(e)) {
        continue;
      }
      throw e;
    }
  }

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

  console.log('\nCanonical step chains per stage (apply publishes these):');
  for (const s of DEDICATED_STAGES) {
    console.log(`\n--- ${s.routeStage} ---`);
    console.log(JSON.stringify(buildCanonicalRestormelSteps(s.routeStage), null, 2));
  }
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
    await applyStepsAndPublish(route.id, s.routeStage);
  }

  if (includeShared) {
    const { route, created } = await ensureSharedRouteRecord({ routes });
    if (created) {
      console.log(`Created shared route ${route.id}`);
    } else {
      console.log(`Using existing shared route ${route.id}`);
    }
    await applyStepsAndPublish(route.id, 'ingestion_extraction');
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
