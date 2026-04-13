<script lang="ts">
	import { onMount } from 'svelte';
	import { getIdToken } from '$lib/authClient';

	type PresetRow = {
		id: string;
		label: string;
		goal: number;
		ingestedCount: number;
		trainingAcceptableCount: number;
		trainingNotAcceptableCount: number;
		byOrigin: Record<string, number>;
	};

	type Phase1Slice = {
		uniqueUrls: number;
		withAnyCompletedIngest: number;
		phase2ReadyCount: number;
		missingFromCorpus: number;
		notValidatePath: number;
		incompletePipeline: number;
		skippedSurrealStore: number;
		sampleNotReady: string[];
	};

	type Phase1Readiness = {
		goldenFingerprint: string;
		trainingCohortDays: number;
		trainingCohortValidateOnly: boolean;
		trainingUrlCap: number;
		golden: Phase1Slice;
		training: Phase1Slice;
		union: Phase1Slice;
		allUnionUrlsPhase2Ready: boolean;
		note: string;
	};

	type Payload = {
		generatedAt?: string;
		neonIngestPersistence?: boolean;
		surrealIngestionLogMerged?: boolean;
		presetGoal?: number;
		presets?: PresetRow[];
		totals?: {
			uniqueSourcesCompleted: number;
			trainingAcceptableCount: number;
			trainingNotAcceptableCount: number;
			byOrigin: Record<string, number>;
		};
		sepIngestedOutsidePresets?: number;
		phase1Readiness?: Phase1Readiness | null;
		/** Populated when Phase 1 block is missing (not “you skipped jobs” — see copy below). */
		phase1ReadinessError?: string | null;
		note?: string;
		error?: string;
	};

	let data = $state<Payload | null>(null);
	let loadError = $state('');
	let loading = $state(true);

	function originEntries(byOrigin: Record<string, number> | undefined): [string, number][] {
		if (!byOrigin) return [];
		return Object.entries(byOrigin).sort((a, b) => b[1] - a[1]);
	}

	onMount(async () => {
		loading = true;
		loadError = '';
		try {
			const token = await getIdToken();
			const res = await fetch('/api/admin/metrics/dataset-coverage', {
				headers: token ? { Authorization: `Bearer ${token}` } : {}
			});
			const json = (await res.json()) as Payload;
			if (!res.ok) {
				loadError = json.error ?? `HTTP ${res.status}`;
				data = null;
			} else {
				data = json;
			}
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e);
			data = null;
		} finally {
			loading = false;
		}
	});
</script>

<svelte:head>
	<title>Dataset coverage — Admin</title>
</svelte:head>

<main class="page">
	<header class="hero">
		<p class="eyebrow">Admin</p>
		<h1 class="title">Dataset &amp; topic preset coverage</h1>
		<p class="lede">
			Successful ingests (deduped by canonical URL) against the six SEP topic presets in
			<code class="mono">data/sep-topic-presets.json</code>, plus Neon governance and
			<strong>verified</strong> LLM lineage from run telemetry (Vertex / Mistral / Google only on recorded
			stages; unknown or legacy Anthropic/OpenAI is excluded from training-acceptable counts). Goal: at least
			<strong>{data?.presetGoal ?? 10}</strong> sources per preset.
		</p>
		<p class="meta">
			{#if data?.generatedAt}
				<span class="mono">Generated {data.generatedAt}</span>
			{/if}
			{#if data?.neonIngestPersistence === false}
				<span class="warn"> · Neon persistence off — metrics empty.</span>
			{/if}
			{#if data?.surrealIngestionLogMerged}
				<span> · Surreal <span class="mono">ingestion_log</span> completes merged for URLs missing in Neon.</span>
			{/if}
		</p>
	</header>

	{#if loading}
		<p class="muted">Loading…</p>
	{:else if loadError}
		<p class="err">{loadError}</p>
	{:else if data}
		<section class="card" aria-labelledby="totals-heading">
			<h2 id="totals-heading" class="h2">All completed sources</h2>
			<div class="grid3">
				<div>
					<p class="stat-label">Unique sources</p>
					<p class="stat-val">{data.totals?.uniqueSourcesCompleted ?? 0}</p>
				</div>
				<div>
					<p class="stat-label">Training-acceptable lineage</p>
					<p class="stat-val ok">{data.totals?.trainingAcceptableCount ?? 0}</p>
				</div>
				<div>
					<p class="stat-label">Not acceptable / excluded</p>
					<p class="stat-val warn">{data.totals?.trainingNotAcceptableCount ?? 0}</p>
				</div>
			</div>
			{#if data.totals?.byOrigin && Object.keys(data.totals.byOrigin).length > 0}
				<h3 class="h3">By catalog origin</h3>
				<ul class="origin-list">
					{#each originEntries(data.totals.byOrigin) as [label, n]}
						<li><span class="origin-label">{label}</span><span class="mono">{n}</span></li>
					{/each}
				</ul>
			{/if}
		</section>

		{#if data.phase1Readiness}
			<section class="card phase1" aria-labelledby="phase1-heading">
				<h2 id="phase1-heading" class="h2">Phase 1 cohorts → Phase 2 readiness</h2>
				<p class="lede small">
					Golden list (fingerprint <span class="mono">{data.phase1Readiness.goldenFingerprint}</span>) and last
					<strong>{data.phase1Readiness.trainingCohortDays}</strong> days of training-acceptable Neon runs with
					<strong>validate=true</strong> (capped at <span class="mono">{data.phase1Readiness.trainingUrlCap}</span> URLs),
					compared to this report’s deduped “completed source” map. “Phase 2 ready” means validate + remediation timing +
					embed + Surreal store on the latest envelope (skipped Surreal store counts as not ready).
				</p>
				<p class="gate" class:gate--ok={data.phase1Readiness.allUnionUrlsPhase2Ready}>
					{#if data.phase1Readiness.allUnionUrlsPhase2Ready}
						<strong>All union URLs are Phase 2 ready.</strong> You can proceed to Phase 2 planning when this matches
						your release criteria.
					{:else}
						<strong>Union cohort is not fully Phase 2 ready.</strong> See counts and sample URLs below.
					{/if}
				</p>
				<div class="table-wrap">
					<table class="tbl">
						<thead>
							<tr>
								<th scope="col">Cohort</th>
								<th scope="col" class="num">URLs</th>
								<th scope="col" class="num">In corpus</th>
								<th scope="col" class="num">Phase 2 ready</th>
								<th scope="col" class="num">Missing</th>
								<th scope="col" class="num">Not validate</th>
								<th scope="col" class="num">Incomplete</th>
								<th scope="col" class="num">Skip store</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<td>Golden</td>
								<td class="num">{data.phase1Readiness.golden.uniqueUrls}</td>
								<td class="num">{data.phase1Readiness.golden.withAnyCompletedIngest}</td>
								<td class="num ok">{data.phase1Readiness.golden.phase2ReadyCount}</td>
								<td class="num">{data.phase1Readiness.golden.missingFromCorpus}</td>
								<td class="num">{data.phase1Readiness.golden.notValidatePath}</td>
								<td class="num">{data.phase1Readiness.golden.incompletePipeline}</td>
								<td class="num">{data.phase1Readiness.golden.skippedSurrealStore}</td>
							</tr>
							<tr>
								<td>Training (validate)</td>
								<td class="num">{data.phase1Readiness.training.uniqueUrls}</td>
								<td class="num">{data.phase1Readiness.training.withAnyCompletedIngest}</td>
								<td class="num ok">{data.phase1Readiness.training.phase2ReadyCount}</td>
								<td class="num">{data.phase1Readiness.training.missingFromCorpus}</td>
								<td class="num">{data.phase1Readiness.training.notValidatePath}</td>
								<td class="num">{data.phase1Readiness.training.incompletePipeline}</td>
								<td class="num">{data.phase1Readiness.training.skippedSurrealStore}</td>
							</tr>
							<tr class="row-em">
								<td><strong>Golden ∪ training</strong></td>
								<td class="num">{data.phase1Readiness.union.uniqueUrls}</td>
								<td class="num">{data.phase1Readiness.union.withAnyCompletedIngest}</td>
								<td class="num ok">{data.phase1Readiness.union.phase2ReadyCount}</td>
								<td class="num">{data.phase1Readiness.union.missingFromCorpus}</td>
								<td class="num">{data.phase1Readiness.union.notValidatePath}</td>
								<td class="num">{data.phase1Readiness.union.incompletePipeline}</td>
								<td class="num">{data.phase1Readiness.union.skippedSurrealStore}</td>
							</tr>
						</tbody>
					</table>
				</div>
				{#if data.phase1Readiness.union.sampleNotReady.length > 0}
					<h3 class="h3">Sample URLs not yet Phase 2 ready (union)</h3>
					<ul class="sample-list mono">
						{#each data.phase1Readiness.union.sampleNotReady as u}
							<li>{u}</li>
						{/each}
					</ul>
				{/if}
				<p class="footnote">{data.phase1Readiness.note}</p>
			</section>
		{:else}
			<section class="card muted-card">
				<h2 class="h2">Phase 1 cohort readiness</h2>
				{#if data.neonIngestPersistence === false}
					<p class="muted">
						Phase 1 readiness needs Neon to load the training-acceptable URL cohort. Enable
						<code class="mono">DATABASE_URL</code> ingest persistence to populate this block.
					</p>
				{:else}
					<p class="muted">
						This section compares the <strong>golden URL list</strong> and a
						<strong>Neon training-acceptable cohort</strong> (validate=true) to your completed-source map. It is
						<strong>not</strong> hidden because you have not run validation jobs yet; if generation succeeded you would
						still see counts (often many URLs “not Phase 2 ready”).
					</p>
				{/if}
				{#if typeof data.phase1ReadinessError === 'string' && data.phase1ReadinessError.trim()}
					<p class="warn-block mono" role="status">{data.phase1ReadinessError}</p>
				{:else if data.neonIngestPersistence !== false}
					<p class="muted">No readiness block returned (unexpected — check server logs).</p>
				{/if}
			</section>
		{/if}

		<section class="card" aria-labelledby="preset-heading">
			<h2 id="preset-heading" class="h2">Per topic preset (SEP slug keywords)</h2>
			<div class="table-wrap">
				<table class="tbl">
					<thead>
						<tr>
							<th scope="col">Preset</th>
							<th scope="col" class="num">Ingested</th>
							<th scope="col" class="num">Goal</th>
							<th scope="col" class="num">Training OK</th>
							<th scope="col" class="num">Not OK</th>
							<th scope="col">Origins (preset scope)</th>
						</tr>
					</thead>
					<tbody>
						{#each data.presets ?? [] as row}
							<tr class:short={row.ingestedCount < (data.presetGoal ?? 10)}>
								<td>
									<span class="preset-id mono">{row.id}</span>
									<div class="preset-label">{row.label}</div>
								</td>
								<td class="num">{row.ingestedCount}</td>
								<td class="num muted">{row.goal}</td>
								<td class="num ok">{row.trainingAcceptableCount}</td>
								<td class="num warn">{row.trainingNotAcceptableCount}</td>
								<td class="origins">
									{#if originEntries(row.byOrigin).length === 0}
										<span class="muted">—</span>
									{:else}
										{#each originEntries(row.byOrigin) as [o, c]}
											<span class="pill"><span class="pill-k">{o}</span><span class="mono">{c}</span></span>
										{/each}
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="footnote">
				Rows highlighted when ingested count is below the per-preset goal. SEP entries can match multiple presets;
				they are counted in each matching preset.
			</p>
			{#if (data.sepIngestedOutsidePresets ?? 0) > 0}
				<p class="footnote">
					SEP sources completed that did not match any preset keywords: <strong>{data.sepIngestedOutsidePresets}</strong>
				</p>
			{/if}
		</section>

		{#if data.note}
			<section class="note-box">
				<h2 class="h2">Definitions</h2>
				<p class="note-text">{data.note}</p>
			</section>
		{/if}
	{/if}

	<p class="back">
		<a href="/admin">← Operator hub</a>
	</p>
</main>

<style>
	.page {
		min-height: calc(100vh - var(--nav-height));
		padding: 20px;
		max-width: 1100px;
		margin: 0 auto;
		color: var(--color-text);
	}
	.hero {
		border: 1px solid var(--color-border);
		border-radius: 12px;
		padding: 20px;
		margin-bottom: 24px;
		background: linear-gradient(130deg, rgba(127, 163, 131, 0.16), rgba(44, 96, 142, 0.1));
	}
	.eyebrow {
		font-family: ui-monospace, monospace;
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--color-text-muted);
		margin: 0;
	}
	.title {
		font-family: var(--font-serif, Georgia, serif);
		font-size: 1.75rem;
		margin: 8px 0 0;
	}
	.lede {
		margin: 12px 0 0;
		font-size: 0.95rem;
		line-height: 1.55;
		max-width: 52rem;
		color: var(--color-text-muted);
	}
	.meta {
		margin: 12px 0 0;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}
	.mono {
		font-family: ui-monospace, monospace;
		font-size: 0.85em;
	}
	.card {
		border: 1px solid var(--color-border);
		border-radius: 12px;
		padding: 18px 20px;
		margin-bottom: 20px;
		background: var(--color-surface, #fff);
	}
	.h2 {
		font-size: 1.1rem;
		margin: 0 0 14px;
	}
	.h3 {
		font-size: 0.95rem;
		margin: 18px 0 8px;
	}
	.grid3 {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 16px;
	}
	.stat-label {
		margin: 0;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-muted);
	}
	.stat-val {
		margin: 4px 0 0;
		font-size: 1.5rem;
		font-weight: 600;
	}
	.stat-val.ok {
		color: var(--color-success, #2d6a4f);
	}
	.stat-val.warn {
		color: var(--color-warning-text, #8a5a00);
	}
	.origin-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 10px 18px;
	}
	.origin-list li {
		display: flex;
		gap: 8px;
		align-items: baseline;
		font-size: 0.9rem;
	}
	.origin-label {
		color: var(--color-text-muted);
	}
	.table-wrap {
		overflow-x: auto;
	}
	.tbl {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.88rem;
	}
	.tbl th,
	.tbl td {
		border-bottom: 1px solid var(--color-border);
		padding: 10px 8px;
		text-align: left;
		vertical-align: top;
	}
	.tbl th.num,
	.tbl td.num {
		text-align: right;
		white-space: nowrap;
	}
	tr.short td:first-child {
		border-left: 3px solid var(--color-warning-text, #c27f00);
		padding-left: 10px;
	}
	.preset-id {
		display: block;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
	.preset-label {
		font-weight: 500;
	}
	.origins {
		min-width: 12rem;
	}
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin: 2px 6px 2px 0;
		padding: 2px 8px;
		border-radius: 999px;
		background: rgba(127, 163, 131, 0.15);
		font-size: 0.78rem;
	}
	.pill-k {
		color: var(--color-text-muted);
	}
	.muted {
		color: var(--color-text-muted);
	}
	.err {
		color: #b42318;
	}
	.warn {
		color: #b45309;
	}
	.footnote {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		margin: 12px 0 0;
		line-height: 1.45;
	}
	.note-box {
		border: 1px dashed var(--color-border);
		border-radius: 10px;
		padding: 14px 16px;
		margin-bottom: 24px;
	}
	.note-text {
		margin: 0;
		font-size: 0.85rem;
		line-height: 1.5;
		color: var(--color-text-muted);
	}
	.back {
		margin-top: 8px;
		font-size: 0.9rem;
	}
	.back a {
		color: var(--color-text-muted);
	}
	.phase1 .lede.small {
		font-size: 0.88rem;
		margin: 0 0 14px;
		line-height: 1.5;
		color: var(--color-text-muted);
		max-width: 52rem;
	}
	.gate {
		margin: 0 0 16px;
		padding: 12px 14px;
		border-radius: 10px;
		border: 1px solid var(--color-border);
		background: rgba(180, 83, 9, 0.12);
		font-size: 0.9rem;
		line-height: 1.45;
	}
	.gate--ok {
		background: rgba(45, 106, 79, 0.15);
		border-color: rgba(45, 106, 79, 0.45);
	}
	.row-em td {
		background: rgba(127, 163, 131, 0.08);
	}
	.sample-list {
		margin: 8px 0 0;
		padding-left: 1.2rem;
		font-size: 0.78rem;
		line-height: 1.5;
		word-break: break-all;
	}
	.warn-block {
		margin-top: 12px;
		padding: 12px 14px;
		border-radius: 10px;
		border: 1px solid rgba(180, 83, 9, 0.45);
		background: rgba(180, 83, 9, 0.1);
		color: #b45309;
		font-size: 0.82rem;
		line-height: 1.45;
		word-break: break-word;
	}
	.muted-card {
		opacity: 0.95;
	}
</style>
