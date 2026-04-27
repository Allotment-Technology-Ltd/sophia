/**
 * Create or refresh Restormel Keys **ingestion** routes (Dashboard API) with multi-step fallbacks.
 *
 * Sophia resolves with workload `ingestion` and stage `ingestion_<substage>` (see
 * `src/lib/server/aaif/ingestion-plan.ts`, `restormelIngestionRoutes.ts`). Admin ingest UI matches
 * routes by `route.stage` equal to `ingestion_extraction`, etc.
 *
 * Requires:
 *   RESTORMEL_GATEWAY_KEY, RESTORMEL_PROJECT_ID
 *   RESTORMEL_ENVIRONMENT_ID (Keys environment UUID; optional default in code is legacy for dev only)
 *   RESTORMEL_KEYS_BASE (optional; defaults to https://restormel.dev)
 *
 * **Apply** reads **per-step** model/provider from environment (no hardcoded model ids in the repo):
 *   INGESTION_BOOTSTRAP_STEP_<N>_PROVIDER   e.g. `vertex`, `mistral`, `openai` (or `INGESTION_BOOTSTRAP_DEFAULT_PROVIDER`)
 *   INGESTION_BOOTSTRAP_STEP_<N>_MODEL     e.g. your Gemini or Mistral id
 *   INGESTION_BOOTSTRAP_MAX_STEPS         optional; default 5 (applies to every stage)
 *
 * Example (export before `apply`):
 *   INGESTION_BOOTSTRAP_DEFAULT_PROVIDER=vertex
 *   INGESTION_BOOTSTRAP_DEFAULT_MODEL=gemini-2.0-flash-001
 *   # or per step: INGESTION_BOOTSTRAP_STEP_0_PROVIDER=… INGESTION_BOOTSTRAP_STEP_0_MODEL=…
 *
 * Usage:
 *   pnpm restormel:ingestion-bootstrap plan
 *   pnpm restormel:ingestion-bootstrap apply
 *   pnpm restormel:ingestion-bootstrap apply --shared
 *   pnpm restormel:ingestion-bootstrap verify
 */

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

const DEDICATED_STAGES: { substage: string; routeStage: string; label: string }[] = [
	{ substage: 'extraction', routeStage: 'ingestion_extraction', label: 'Extraction' },
	{ substage: 'relations', routeStage: 'ingestion_relations', label: 'Relations' },
	{ substage: 'grouping', routeStage: 'ingestion_grouping', label: 'Grouping' },
	{ substage: 'validation', routeStage: 'ingestion_validation', label: 'Validation' },
	{ substage: 'remediation', routeStage: 'ingestion_remediation', label: 'Remediation' },
	{ substage: 'json_repair', routeStage: 'ingestion_json_repair', label: 'JSON repair' }
];

const SHARED_ROUTE_NAME = 'Sophia — Ingestion (shared fallback)';

const MAX_ROUTE_STEPS = Math.max(
	1,
	Math.min(10, parseInt(process.env.INGESTION_BOOTSTRAP_MAX_STEPS ?? '5', 10) || 5)
);

function defaultProviderForSteps(): string {
	return (process.env.INGESTION_BOOTSTRAP_DEFAULT_PROVIDER ?? 'vertex').trim() || 'vertex';
}

function defaultModelForSteps(): string {
	const m = (process.env.INGESTION_BOOTSTRAP_DEFAULT_MODEL ?? '').trim();
	if (!m) {
		throw new Error(
			'Set INGESTION_BOOTSTRAP_DEFAULT_MODEL to your primary model id (e.g. Gemini on Vertex), or set each INGESTION_BOOTSTRAP_STEP_<N>_MODEL.'
		);
	}
	return m;
}

function stepProviderAtIndex(i: number): string {
	const o = process.env[`INGESTION_BOOTSTRAP_STEP_${i}_PROVIDER`]?.trim();
	if (o) return o;
	return defaultProviderForSteps();
}

function stepModelAtIndex(i: number): string {
	const o = process.env[`INGESTION_BOOTSTRAP_STEP_${i}_MODEL`]?.trim();
	if (o) return o;
	return defaultModelForSteps();
}

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

function buildRestormelStepsFromEnv(): RestormelStepRecord[] {
	const switchCriteria = {
		onFailureKinds: ['timeout', 'rate_limit', 'provider_unhealthy', 'quota_exceeded', 'unknown_error'],
		requiresHealthyProvider: true
	};

	const steps: RestormelStepRecord[] = [];
	for (let i = 0; i < MAX_ROUTE_STEPS; i++) {
		const provider = stepProviderAtIndex(i);
		const modelId = stepModelAtIndex(i);
		const step: RestormelStepRecord = {
			id: `step_${i}`,
			orderIndex: i,
			enabled: true,
			providerPreference: providerPreferenceForRouteStep(provider),
			modelId
		};
		if (i < MAX_ROUTE_STEPS - 1) {
			step.switchCriteria = switchCriteria;
			step.retryPolicy = {
				maxRetries: 1,
				backoffMs: 1000,
				retryOnFailureKinds: ['timeout']
			};
		}
		steps.push(step);
	}
	return steps;
}

function printHelp(): void {
	console.log(`bootstrap-ingestion-routes

Commands:
  plan              List current ingestion routes vs expected stages (no writes)
  apply             Create missing routes, write fallback steps from env, publish each route
  apply --shared    Also ensure a shared ingestion route (empty stage) with the same steps
  verify            POST /resolve for each ingestion_* stage (smoke test)

Environment: RESTORMEL_GATEWAY_KEY, RESTORMEL_PROJECT_ID, RESTORMEL_ENVIRONMENT_ID
  INGESTION_BOOTSTRAP_DEFAULT_MODEL  (required unless every INGESTION_BOOTSTRAP_STEP_<N>_MODEL is set)
  INGESTION_BOOTSTRAP_DEFAULT_PROVIDER (default: vertex)
  INGESTION_BOOTSTRAP_MAX_STEPS (default: 5)
  INGESTION_BOOTSTRAP_STEP_<N>_PROVIDER / _MODEL  optional per-step overrides (N = 0..9)
`);
}

async function applyStepsAndPublish(routeId: string): Promise<void> {
	const desired = buildRestormelStepsFromEnv();

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

function isRestormelConflict(e: unknown): boolean {
	const msg = e instanceof Error ? e.message : String(e);
	return /(^|\b)(409|conflict)(\b|$)/i.test(msg);
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
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

	try {
		console.log('\nSteps that `apply` would write (from env):');
		console.log(JSON.stringify(buildRestormelStepsFromEnv(), null, 2));
	} catch (e) {
		console.log(`\n(Plan cannot build steps: ${e instanceof Error ? e.message : String(e)})`);
	}
}

async function cmdApply(includeShared: boolean): Promise<void> {
	void buildRestormelStepsFromEnv();

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
