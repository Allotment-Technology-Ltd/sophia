<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { getIdToken } from '$lib/authClient';
	import { MAX_DURABLE_INGEST_JOB_CONCURRENCY } from '$lib/ingestionJobConcurrency';

	type JobSummary = {
		total?: number;
		pending?: number;
		running?: number;
		done?: number;
		error?: number;
		cancelled?: number;
		skipped?: number;
	};

	type JobRow = {
		id: string;
		status: string;
		concurrency: number;
		validateLlm?: boolean;
		summary: JobSummary;
		pipelineVersion?: string | null;
		embeddingFingerprint?: string | null;
		notes?: string | null;
		createdAt?: string;
		updatedAt?: string;
	};

	let jobs = $state<JobRow[]>([]);
	let loadError = $state('');
	let neonDisabled = $state(false);
	let loading = $state(true);
	let submitting = $state(false);
	let submitMessage = $state('');

	let urlsInput = $state('');
	let concurrency = $state(2);
	let notes = $state('');
	let validateLlm = $state(false);
	/** Append URLs to the most recently touched running job instead of starting a second job (eases global worker cap). */
	let mergeIntoRunningJob = $state(false);

	const JOB_WORKER_SETTINGS_KEY = 'sophia.admin.ingestJobWorkerDefaults.v1';

	/** Optional per-item worker tuning (stored on job row, merged into each child `batch_overrides`). */
	let workerTuningOpen = $state(false);
	let jobExtractionConcurrency = $state('');
	let jobExtractionMaxTokens = $state('');
	let jobPassageInsertConcurrency = $state('');
	let jobClaimInsertConcurrency = $state('');
	let jobRemediationMaxClaims = $state('');
	let jobRelationsOverlap = $state('');
	let jobIngestProvider = $state<'auto' | 'anthropic' | 'vertex'>('auto');
	let jobFailOnGroupingCollapse = $state(true);
	let jobIngestLogPins = $state(false);
	let jobRemediationEnabled = $state(true);
	let jobRemediationRevalidate = $state(false);
	let jobWatchdogPhaseIdleJson = $state('');
	let jobWatchdogBaselineMult = $state('');

	/** SEP catalog helper: topic presets + un-ingested filter (Neon). */
	let sepPresetId = $state('');
	let sepCustomKeywords = $state('');
	let sepBatchCount = $state(10);
	let sepExcludeIngested = $state(true);
	let sepPresets = $state<{ id: string; label: string }[]>([]);
	let sepSuggestLoading = $state(false);
	let sepSuggestMessage = $state('');
	let sepLastStats = $state('');

	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let jobWorkerFieldsHydrated = $state(false);

	type DlqRow = {
		itemId: string;
		jobId: string;
		url: string;
		lastError: string | null;
		failureClass: string | null;
		lastFailureKind: string | null;
		dlqEnqueuedAt: string | null;
		attempts: number;
		dlqReplayCount: number;
		jobNotes: string | null;
		jobStatus: string;
	};

	let dlqItems = $state<DlqRow[]>([]);
	let dlqLoading = $state(false);
	let dlqMessage = $state('');
	let dlqReplayBusy = $state(false);
	let dlqSelected = $state<Record<string, boolean>>({});

	async function authHeaders(json = false): Promise<Record<string, string>> {
		const token = await getIdToken();
		if (!token) throw new Error('Authentication required.');
		const h: Record<string, string> = { Authorization: `Bearer ${token}` };
		if (json) h['Content-Type'] = 'application/json';
		return h;
	}

	function parseOptionalInt(input: string, min: number, max: number): number | undefined {
		const t = input.trim();
		if (!t) return undefined;
		const n = Number(t);
		if (!Number.isFinite(n)) return undefined;
		const i = Math.trunc(n);
		if (i < min || i > max) return undefined;
		return i;
	}

	function buildWorkerDefaultsPayload(): { ok: true; payload?: Record<string, unknown> } | { ok: false; error: string } {
		const o: Record<string, unknown> = {};
		const extC = parseOptionalInt(jobExtractionConcurrency, 1, 16);
		if (extC != null) o.extractionConcurrency = extC;
		const extTok = parseOptionalInt(jobExtractionMaxTokens, 1000, 20_000);
		if (extTok != null) o.extractionMaxTokensPerSection = extTok;
		const passC = parseOptionalInt(jobPassageInsertConcurrency, 1, 12);
		if (passC != null) o.passageInsertConcurrency = passC;
		const claimC = parseOptionalInt(jobClaimInsertConcurrency, 1, 24);
		if (claimC != null) o.claimInsertConcurrency = claimC;
		const remMax = parseOptionalInt(jobRemediationMaxClaims, 1, 200);
		if (remMax != null) o.remediationMaxClaims = remMax;
		const overlap = parseOptionalInt(jobRelationsOverlap, 1, 99);
		if (overlap != null) o.relationsBatchOverlapClaims = overlap;
		o.ingestProvider = jobIngestProvider;
		o.failOnGroupingPositionCollapse = jobFailOnGroupingCollapse;
		o.ingestLogPins = jobIngestLogPins;
		if (validateLlm) {
			o.ingestRemediationEnabled = jobRemediationEnabled;
			o.ingestRemediationRevalidate = jobRemediationRevalidate;
		}
		const idleRaw = jobWatchdogPhaseIdleJson.trim();
		if (idleRaw) {
			try {
				const parsed = JSON.parse(idleRaw);
				if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
					o.watchdogPhaseIdleJson = JSON.stringify(parsed);
				}
			} catch {
				return { ok: false, error: 'Watchdog phase idle JSON is not valid JSON.' };
			}
		}
		const multRaw = jobWatchdogBaselineMult.trim();
		if (multRaw) {
			const m = Number(multRaw);
			if (!Number.isFinite(m) || m < 0.5 || m > 10) {
				return { ok: false, error: 'Watchdog baseline multiplier must be between 0.5 and 10.' };
			}
			o.watchdogPhaseBaselineMult = m;
		}
		return Object.keys(o).length > 0 ? { ok: true, payload: o } : { ok: true };
	}

	function persistJobWorkerFields(): void {
		if (typeof window === 'undefined') return;
		try {
			localStorage.setItem(
				JOB_WORKER_SETTINGS_KEY,
				JSON.stringify({
					jobExtractionConcurrency,
					jobExtractionMaxTokens,
					jobPassageInsertConcurrency,
					jobClaimInsertConcurrency,
					jobRemediationMaxClaims,
					jobRelationsOverlap,
					jobIngestProvider,
					jobFailOnGroupingCollapse,
					jobIngestLogPins,
					jobRemediationEnabled,
					jobRemediationRevalidate,
					jobWatchdogPhaseIdleJson,
					jobWatchdogBaselineMult
				})
			);
		} catch {
			/* ignore */
		}
	}

	function parseUrls(raw: string): string[] {
		const lines = raw
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter(Boolean);
		const out: string[] = [];
		for (const line of lines) {
			try {
				new URL(line);
				out.push(line);
			} catch {
				/* skip */
			}
		}
		return [...new Set(out)];
	}

	async function loadJobs(): Promise<void> {
		loadError = '';
		neonDisabled = false;
		loading = true;
		try {
			const res = await fetch('/api/admin/ingest/jobs?limit=50', { headers: await authHeaders() });
			const body = await res.json().catch(() => ({}));
			if (res.status === 503) {
				neonDisabled = true;
				jobs = [];
				loadError =
					typeof body?.error === 'string' ? body.error : 'Neon ingest persistence is not enabled.';
				return;
			}
			if (!res.ok) {
				throw new Error(typeof body?.error === 'string' ? body.error : 'Failed to list jobs.');
			}
			jobs = Array.isArray(body?.jobs) ? (body.jobs as JobRow[]) : [];
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Failed to load jobs.';
			jobs = [];
		} finally {
			loading = false;
		}
	}

	async function loadSepPresets(): Promise<void> {
		try {
			const res = await fetch('/api/admin/ingest/sep-suggest?presetsOnly=1', {
				headers: await authHeaders()
			});
			const body = await res.json().catch(() => ({}));
			if (res.ok && Array.isArray(body?.presets)) {
				sepPresets = body.presets as { id: string; label: string }[];
			}
		} catch {
			sepPresets = [];
		}
	}

	async function fillUrlsFromSepCatalog(): Promise<void> {
		sepSuggestMessage = '';
		sepLastStats = '';
		if (!sepPresetId.trim() && !sepCustomKeywords.trim()) {
			sepSuggestMessage = 'Choose a topic preset and/or enter custom keywords (entry slug fragments).';
			return;
		}
		if (sepExcludeIngested && neonDisabled) {
			sepSuggestMessage =
				'Turn off “Exclude already ingested” while Neon is unavailable, or enable DATABASE_URL for this environment.';
			return;
		}
		sepSuggestLoading = true;
		try {
			const params = new URLSearchParams();
			if (sepPresetId.trim()) params.set('preset', sepPresetId.trim());
			if (sepCustomKeywords.trim()) params.set('keywords', sepCustomKeywords.trim());
			const n = Math.max(1, Math.min(200, Math.trunc(sepBatchCount) || 10));
			params.set('limit', String(n));
			params.set('excludeIngested', sepExcludeIngested && !neonDisabled ? '1' : '0');
			const res = await fetch(`/api/admin/ingest/sep-suggest?${params.toString()}`, {
				headers: await authHeaders()
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(typeof body?.error === 'string' ? body.error : 'Suggestion request failed.');
			}
			const urls = Array.isArray(body?.urls) ? (body.urls as string[]) : [];
			const stats = body?.stats as
				| {
						catalogSize?: number;
						matchedBeforeExclude?: number;
						excludedIngested?: number;
						returned?: number;
				  }
				| undefined;
			urlsInput = urls.join('\n');
			sepLastStats = stats
				? `Catalog ${stats.catalogSize ?? '—'} · matched ${stats.matchedBeforeExclude ?? '—'} · skipped ingested ${stats.excludedIngested ?? 0} · filled ${stats.returned ?? urls.length}`
				: '';
			sepSuggestMessage =
				urls.length === 0
					? 'No URLs matched. Try different keywords or disable “Exclude already ingested”.'
					: `Placed ${urls.length} URL(s) in the list below.`;
		} catch (e) {
			sepSuggestMessage = e instanceof Error ? e.message : 'Failed to suggest URLs.';
		} finally {
			sepSuggestLoading = false;
		}
	}

	async function startJob(): Promise<void> {
		submitMessage = '';
		const urls = parseUrls(urlsInput);
		if (urls.length === 0) {
			submitMessage = 'Add at least one valid URL (one per line).';
			return;
		}
		const workerBuild = buildWorkerDefaultsPayload();
		if (!workerBuild.ok) {
			submitMessage = workerBuild.error;
			return;
		}
		submitting = true;
		try {
			const res = await fetch('/api/admin/ingest/jobs', {
				method: 'POST',
				headers: await authHeaders(true),
				body: JSON.stringify({
					urls,
					concurrency: Math.max(
						1,
						Math.min(MAX_DURABLE_INGEST_JOB_CONCURRENCY, Math.trunc(concurrency) || 2)
					),
					notes: notes.trim() || null,
					validate: validateLlm,
					merge_into_latest_running_job: mergeIntoRunningJob,
					...(workerBuild.payload && Object.keys(workerBuild.payload).length > 0
						? { worker_defaults: workerBuild.payload }
						: {})
				})
			});
			const body = await res.json().catch(() => ({}));
			if (res.status === 503) {
				submitMessage =
					typeof body?.error === 'string' ? body.error : 'Neon ingest persistence is not enabled.';
				return;
			}
			if (!res.ok) {
				throw new Error(typeof body?.error === 'string' ? body.error : 'Failed to create job.');
			}
			const jobId = typeof body?.jobId === 'string' ? body.jobId : '';
			if (!jobId) throw new Error('Missing job id in response.');
			const merged = body?.merged === true;
			urlsInput = '';
			notes = '';
			persistJobWorkerFields();
			await loadJobs();
			const q = merged ? '?appended=1' : '';
			window.location.href = `/admin/ingest/jobs/${encodeURIComponent(jobId)}${q}`;
		} catch (e) {
			submitMessage = e instanceof Error ? e.message : 'Failed to start job.';
		} finally {
			submitting = false;
		}
	}

	async function loadDlq(): Promise<void> {
		if (neonDisabled) return;
		dlqLoading = true;
		dlqMessage = '';
		try {
			const res = await fetch('/api/admin/ingest/jobs/dlq?limit=100', { headers: await authHeaders() });
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(typeof body?.error === 'string' ? body.error : 'DLQ load failed');
			}
			dlqItems = Array.isArray(body?.items) ? (body.items as DlqRow[]) : [];
		} catch (e) {
			dlqMessage = e instanceof Error ? e.message : 'DLQ load failed';
			dlqItems = [];
		} finally {
			dlqLoading = false;
		}
	}

	function toggleDlq(id: string): void {
		dlqSelected = { ...dlqSelected, [id]: !dlqSelected[id] };
	}

	async function replayDlqSelected(): Promise<void> {
		const ids = dlqItems.filter((x) => dlqSelected[x.itemId]).map((x) => x.itemId);
		if (ids.length === 0) {
			dlqMessage = 'Select at least one row.';
			return;
		}
		dlqReplayBusy = true;
		dlqMessage = '';
		try {
			const res = await fetch('/api/admin/ingest/jobs/dlq', {
				method: 'POST',
				headers: await authHeaders(true),
				body: JSON.stringify({ itemIds: ids })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(typeof body?.error === 'string' ? body.error : 'Replay failed');
			}
			dlqMessage = `Replayed ${typeof body?.replayed === 'number' ? body.replayed : 0} item(s).`;
			dlqSelected = {};
			await loadDlq();
			await loadJobs();
		} catch (e) {
			dlqMessage = e instanceof Error ? e.message : 'Replay failed';
		} finally {
			dlqReplayBusy = false;
		}
	}

	function exportDlqCsv(): void {
		if (dlqItems.length === 0) return;
		const esc = (s: string | null) => `"${String(s ?? '').replace(/"/g, '""')}"`;
		const headers = [
			'itemId',
			'jobId',
			'url',
			'failureClass',
			'lastFailureKind',
			'attempts',
			'dlqReplayCount',
			'dlqEnqueuedAt',
			'lastError',
			'jobStatus',
			'jobNotes'
		];
		const lines = [headers.join(',')];
		for (const r of dlqItems) {
			lines.push(
				[
					r.itemId,
					r.jobId,
					esc(r.url),
					r.failureClass ?? '',
					r.lastFailureKind ?? '',
					String(r.attempts),
					String(r.dlqReplayCount),
					r.dlqEnqueuedAt ?? '',
					esc(r.lastError),
					r.jobStatus,
					esc(r.jobNotes)
				].join(',')
			);
		}
		const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = `ingest-dlq-${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		URL.revokeObjectURL(a.href);
	}

	function formatSummary(s: JobSummary | undefined): string {
		if (!s) return '—';
		const parts = [
			`total ${s.total ?? '?'}`,
			`pending ${s.pending ?? '?'}`,
			`running ${s.running ?? '?'}`,
			`done ${s.done ?? '?'}`,
			`err ${s.error ?? '?'}`
		];
		return parts.join(' · ');
	}

	onMount(() => {
		try {
			const raw = localStorage.getItem(JOB_WORKER_SETTINGS_KEY);
			if (raw) {
				const p = JSON.parse(raw) as Record<string, unknown>;
				if (typeof p.jobExtractionConcurrency === 'string') jobExtractionConcurrency = p.jobExtractionConcurrency;
				if (typeof p.jobExtractionMaxTokens === 'string') jobExtractionMaxTokens = p.jobExtractionMaxTokens;
				if (typeof p.jobPassageInsertConcurrency === 'string')
					jobPassageInsertConcurrency = p.jobPassageInsertConcurrency;
				if (typeof p.jobClaimInsertConcurrency === 'string') jobClaimInsertConcurrency = p.jobClaimInsertConcurrency;
				if (typeof p.jobRemediationMaxClaims === 'string') jobRemediationMaxClaims = p.jobRemediationMaxClaims;
				if (typeof p.jobRelationsOverlap === 'string') jobRelationsOverlap = p.jobRelationsOverlap;
				if (
					p.jobIngestProvider === 'auto' ||
					p.jobIngestProvider === 'anthropic' ||
					p.jobIngestProvider === 'vertex'
				) {
					jobIngestProvider = p.jobIngestProvider;
				}
				if (typeof p.jobFailOnGroupingCollapse === 'boolean')
					jobFailOnGroupingCollapse = p.jobFailOnGroupingCollapse;
				if (typeof p.jobIngestLogPins === 'boolean') jobIngestLogPins = p.jobIngestLogPins;
				if (typeof p.jobRemediationEnabled === 'boolean') jobRemediationEnabled = p.jobRemediationEnabled;
				if (typeof p.jobRemediationRevalidate === 'boolean')
					jobRemediationRevalidate = p.jobRemediationRevalidate;
				if (typeof p.jobWatchdogPhaseIdleJson === 'string')
					jobWatchdogPhaseIdleJson = p.jobWatchdogPhaseIdleJson;
				if (typeof p.jobWatchdogBaselineMult === 'string') jobWatchdogBaselineMult = p.jobWatchdogBaselineMult;
			}
		} catch {
			/* ignore */
		}
		jobWorkerFieldsHydrated = true;
		void loadJobs();
		void loadSepPresets();
		void loadDlq();
		pollTimer = setInterval(() => {
			void loadJobs();
			void loadDlq();
		}, 8000);
	});

	onDestroy(() => {
		if (pollTimer) clearInterval(pollTimer);
	});

	$effect(() => {
		if (!jobWorkerFieldsHydrated || typeof window === 'undefined') return;
		void (
			jobExtractionConcurrency +
			jobExtractionMaxTokens +
			jobPassageInsertConcurrency +
			jobClaimInsertConcurrency +
			jobRemediationMaxClaims +
			jobRelationsOverlap +
			jobIngestProvider +
			jobFailOnGroupingCollapse +
			jobIngestLogPins +
			jobRemediationEnabled +
			jobRemediationRevalidate +
			jobWatchdogPhaseIdleJson +
			jobWatchdogBaselineMult
		);
		persistJobWorkerFields();
	});
</script>

<svelte:head>
	<title>Durable ingestion jobs — Admin</title>
</svelte:head>

<main class="jobs-page sophia-stack-comfortable">
	<header class="jobs-hero">
		<p class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-dim">Admin · Ingest</p>
		<h1 class="mt-2 font-serif text-2xl text-sophia-dark-text sm:text-3xl">Durable ingestion jobs</h1>
		<p class="mt-2 max-w-3xl text-sm leading-6 text-sophia-dark-muted">
			Neon-backed multi-URL jobs: each URL runs a full pipeline including Surreal store. While this list stays
			open, each refresh advances every running job (same server tick as the background poller). The job detail
			page ticks that job on every poll. If no admin tab is open, use Cloud Run Job + Scheduler or
			<code class="rounded bg-black/20 px-1 py-0.5 font-mono text-xs">pnpm ingestion:job-poller</code> — see
			<span class="font-mono text-xs">docs/operations/ingestion-credits-and-workers.md</span>.
		</p>
	</header>

	{#if neonDisabled}
		<p class="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100" role="status">
			{loadError}
		</p>
	{:else if loadError}
		<p class="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100" role="alert">
			{loadError}
		</p>
	{/if}

	<section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5" aria-labelledby="new-job-heading">
		<h2 id="new-job-heading" class="font-serif text-lg text-sophia-dark-text">Start job</h2>
		<p class="mt-2 text-sm text-sophia-dark-muted">
			One URL per line (many URLs queue; workers drain the list). Concurrency is capped at {MAX_DURABLE_INGEST_JOB_CONCURRENCY}
			to match the default global ingest worker limit (<code class="rounded bg-black/20 px-1 py-0.5 font-mono text-[11px]"
				>ADMIN_INGEST_MAX_CONCURRENT</code
			>).
		</p>

		<div
			class="mt-5 rounded-lg border border-[var(--color-border)] bg-black/10 p-4 sophia-stack-default"
			aria-labelledby="sep-helper-heading"
		>
			<h3 id="sep-helper-heading" class="font-serif text-base text-sophia-dark-text">
				SEP catalog helper
			</h3>
			<p class="text-sm leading-6 text-sophia-dark-muted">
				Build a batch from <span class="font-mono text-xs">data/sep-entry-urls.json</span> by topic preset (slug
				substrings) and optional extra keywords. “Exclude already ingested” merges Neon
				<span class="font-mono text-xs">ingest_runs</span> / job items (<span class="font-mono text-xs">done</span>)
				with Surreal <span class="font-mono text-xs">ingestion_log</span> rows where
				<span class="font-mono text-xs">status = complete</span>.
			</p>
			<div class="flex flex-wrap items-end gap-4">
				<label class="block min-w-[200px] flex-1">
					<span class="font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-dim">Topic preset</span>
					<select
						class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 text-sm text-sophia-dark-text focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)]"
						bind:value={sepPresetId}
					>
						<option value="">— Optional —</option>
						{#each sepPresets as p (p.id)}
							<option value={p.id}>{p.label}</option>
						{/each}
					</select>
				</label>
				<label class="block min-w-[200px] flex-[2]">
					<span class="font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-dim"
						>Custom keywords (slug fragments)</span
					>
					<input
						type="text"
						class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)]"
						bind:value={sepCustomKeywords}
						placeholder="e.g. bayesian, confirmation"
						autocomplete="off"
					/>
				</label>
				<label class="block w-28">
					<span class="font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-dim">Count</span>
					<input
						type="number"
						min="1"
						max="200"
						class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)]"
						bind:value={sepBatchCount}
					/>
				</label>
			</div>
			<label class="flex cursor-pointer items-center gap-3">
				<input
					type="checkbox"
					bind:checked={sepExcludeIngested}
					class="h-5 w-5 rounded border-[var(--color-border)]"
				/>
				<span class="text-sm text-sophia-dark-text">Exclude URLs already ingested (Neon + Surreal)</span>
			</label>
			{#if sepLastStats}
				<p class="font-mono text-xs text-sophia-dark-muted">{sepLastStats}</p>
			{/if}
			{#if sepSuggestMessage}
				<p class="text-sm text-amber-100" role="status">{sepSuggestMessage}</p>
			{/if}
			<button
				type="button"
				class="inline-flex min-h-[44px] max-w-md items-center justify-center rounded-lg border border-[color-mix(in_srgb,var(--color-blue)_35%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-blue)_12%,var(--color-surface))] px-5 py-3 font-mono text-sm font-medium text-sophia-dark-text transition hover:border-[var(--color-blue)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)] disabled:cursor-not-allowed disabled:opacity-50"
				disabled={sepSuggestLoading}
				onclick={() => void fillUrlsFromSepCatalog()}
			>
				{sepSuggestLoading ? 'Building list…' : 'Fill URL list from catalog'}
			</button>
			{#if neonDisabled}
				<p class="text-sm text-sophia-dark-muted">
					Neon is off in this environment: turn off “Exclude already ingested” to fill from the catalog, or paste
					URLs manually. Starting a job still requires Neon.
				</p>
			{/if}
		</div>

		<div class="mt-4 flex flex-col gap-4">
			<label class="block">
				<span class="font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-dim">URLs</span>
				<textarea
					class="mt-2 min-h-[140px] w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm text-sophia-dark-text focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)]"
					bind:value={urlsInput}
					placeholder="https://plato.stanford.edu/entries/stoicism/"
					rows="6"
					autocomplete="off"
				></textarea>
			</label>
			<div class="flex flex-wrap items-end gap-4">
				<label class="block">
					<span class="font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-dim">Concurrency</span>
					<input
						type="number"
						min="1"
						max={MAX_DURABLE_INGEST_JOB_CONCURRENCY}
						class="mt-2 w-24 rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)]"
						bind:value={concurrency}
					/>
				</label>
				<label class="block min-w-[200px] flex-1">
					<span class="font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-dim">Notes (optional)</span>
					<input
						type="text"
						class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)]"
						bind:value={notes}
						autocomplete="off"
					/>
				</label>
			</div>

			<details class="mt-4 rounded-lg border border-[var(--color-border)] bg-black/10 p-4" bind:open={workerTuningOpen}>
				<summary class="cursor-pointer font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted">
					Worker defaults (per URL run)
				</summary>
				<p class="mt-2 text-sm text-sophia-dark-muted">
					Applied to every child ingest for this job (stored on the job row). Blank fields use worker / server env.
					Defaults are remembered in this browser. For full model routing and batch token caps, use
					<a href="/admin/ingest" class="text-[var(--color-sage)] underline-offset-2 hover:underline">single-run ingest</a>.
				</p>
				<div class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					<label class="block">
						<span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Extraction parallelism</span>
						<input
							type="number"
							min="1"
							max="16"
							class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm"
							bind:value={jobExtractionConcurrency}
							placeholder="INGEST_EXTRACTION_CONCURRENCY"
						/>
					</label>
					<label class="block">
						<span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Max tokens / section</span>
						<input
							type="number"
							min="1000"
							max="20000"
							class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm"
							bind:value={jobExtractionMaxTokens}
							placeholder="INGEST_EXTRACTION_MAX_TOKENS_PER_SECTION"
						/>
					</label>
					<label class="block">
						<span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Surreal passage inserts</span>
						<input
							type="number"
							min="1"
							max="12"
							class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm"
							bind:value={jobPassageInsertConcurrency}
							placeholder="INGEST_PASSAGE_INSERT_CONCURRENCY"
						/>
					</label>
					<label class="block">
						<span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Surreal claim inserts</span>
						<input
							type="number"
							min="1"
							max="24"
							class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm"
							bind:value={jobClaimInsertConcurrency}
							placeholder="INGEST_CLAIM_INSERT_CONCURRENCY"
						/>
					</label>
					<label class="block">
						<span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Remediation max claims</span>
						<input
							type="number"
							min="1"
							max="200"
							class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm"
							bind:value={jobRemediationMaxClaims}
							placeholder="INGEST_REMEDIATION_MAX_CLAIMS"
						/>
					</label>
					<label class="block">
						<span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Relations overlap</span>
						<input
							type="number"
							min="1"
							max="99"
							class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm"
							bind:value={jobRelationsOverlap}
							placeholder="RELATIONS_BATCH_OVERLAP_CLAIMS"
						/>
					</label>
					<label class="block sm:col-span-2">
						<span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Ingest provider</span>
						<select
							class="mt-2 w-full max-w-xs rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm"
							bind:value={jobIngestProvider}
						>
							<option value="auto">auto</option>
							<option value="vertex">vertex</option>
							<option value="anthropic">anthropic</option>
						</select>
					</label>
				</div>
				<label class="mt-3 flex cursor-pointer items-center gap-3">
					<input type="checkbox" bind:checked={jobFailOnGroupingCollapse} class="h-5 w-5 rounded border-[var(--color-border)]" />
					<span class="text-sm text-sophia-dark-text">Fail on grouping position collapse (strict)</span>
				</label>
				<label class="mt-2 flex cursor-pointer items-center gap-3">
					<input type="checkbox" bind:checked={jobIngestLogPins} class="h-5 w-5 rounded border-[var(--color-border)]" />
					<span class="text-sm text-sophia-dark-text">Log routing pin diagnostics (INGEST_LOG_PINS)</span>
				</label>
				{#if validateLlm}
					<div class="mt-3 space-y-2 rounded border border-[var(--color-border)]/60 bg-black/15 p-3">
						<p class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Remediation (when validation on)</p>
						<label class="flex cursor-pointer items-center gap-3">
							<input type="checkbox" bind:checked={jobRemediationEnabled} class="h-5 w-5 rounded border-[var(--color-border)]" />
							<span class="text-sm text-sophia-dark-text">Enable remediation pass</span>
						</label>
						<label class="flex cursor-pointer items-center gap-3">
							<input type="checkbox" bind:checked={jobRemediationRevalidate} class="h-5 w-5 rounded border-[var(--color-border)]" />
							<span class="text-sm text-sophia-dark-text">Re-validate after remediation</span>
						</label>
					</div>
				{/if}
				<label class="mt-4 block">
					<span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Watchdog phase idle (JSON, ms)</span>
					<textarea
						class="mt-2 min-h-[72px] w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-xs"
						bind:value={jobWatchdogPhaseIdleJson}
						placeholder={JSON.stringify({ extracting: 480000, storing: 600000 })}
						rows="3"
					></textarea>
				</label>
				<label class="mt-2 block max-w-xs">
					<span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Watchdog baseline mult.</span>
					<input
						type="number"
						min="0.5"
						max="10"
						step="0.1"
						class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm"
						bind:value={jobWatchdogBaselineMult}
						placeholder="e.g. 2.5"
					/>
				</label>
			</details>

			<label class="flex cursor-pointer items-center gap-3">
				<input type="checkbox" bind:checked={validateLlm} class="h-5 w-5 rounded border-[var(--color-border)]" />
				<span class="text-sm text-sophia-dark-text">Run LLM validation stage</span>
			</label>
			<label class="flex cursor-pointer items-center gap-3">
				<input
					type="checkbox"
					bind:checked={mergeIntoRunningJob}
					class="h-5 w-5 rounded border-[var(--color-border)]"
				/>
				<span class="text-sm text-sophia-dark-text">
					If a job is already running, append these URLs to it (pending queue). Avoids a second job competing for
					<span class="font-mono text-xs">ADMIN_INGEST_MAX_CONCURRENT</span> worker slots.
				</span>
			</label>
			{#if submitMessage}
				<p class="text-sm text-amber-100" role="status">{submitMessage}</p>
			{/if}
			<div class="mt-2 flex flex-wrap gap-3">
				<button
					type="button"
					class="rounded-lg border border-[color-mix(in_srgb,var(--color-sage)_40%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-sage)_12%,var(--color-surface))] px-5 py-3 font-mono text-sm font-medium uppercase tracking-[0.08em] text-sophia-dark-text transition hover:border-[var(--color-sage)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)] disabled:cursor-not-allowed disabled:opacity-50"
					disabled={submitting || neonDisabled}
					onclick={() => void startJob()}
				>
					{submitting ? 'Starting…' : 'Start job'}
				</button>
				<button
					type="button"
					class="rounded-lg border border-[var(--color-border)] bg-transparent px-5 py-3 font-mono text-sm uppercase tracking-[0.08em] text-sophia-dark-muted transition hover:border-[var(--color-sage)] hover:text-sophia-dark-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)]"
					onclick={() => void loadJobs()}
				>
					Refresh list
				</button>
				<a
					href="/admin/ingest/batch"
					class="inline-flex min-h-[44px] items-center rounded-lg border border-[var(--color-border)] px-5 py-3 font-mono text-sm uppercase tracking-[0.08em] text-sophia-dark-muted no-underline transition hover:border-[var(--color-sage)] hover:text-sophia-dark-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)]"
				>
					STOA batch
				</a>
			</div>
		</div>
	</section>

	<section
		id="dead-letter"
		class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
		aria-labelledby="dlq-heading"
	>
		<h2 id="dlq-heading" class="font-serif text-lg text-sophia-dark-text">Dead letter queue</h2>
		<p class="mt-2 text-sm text-sophia-dark-muted">
			URLs that hit <span class="font-mono text-xs">INGEST_JOB_ITEM_MAX_ATTEMPTS</span> without a successful run.
			Replay sends rows back to <span class="font-mono text-xs">pending</span> and bumps
			<span class="font-mono text-xs">dlq_replay_count</span>. Optional
			<span class="font-mono text-xs">INGEST_DLQ_AUTO_REPLAY_DELAY_MS</span> auto-replays retryable exhausted items
			from the poller.
		</p>
		{#if dlqMessage}
			<p class="mt-3 text-sm text-amber-100" role="status">{dlqMessage}</p>
		{/if}
		<div class="mt-4 flex flex-wrap gap-3">
			<button
				type="button"
				class="inline-flex min-h-[44px] items-center rounded-lg border border-[color-mix(in_srgb,var(--color-sage)_40%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-sage)_12%,var(--color-surface))] px-5 py-3 font-mono text-sm font-medium text-sophia-dark-text transition hover:border-[var(--color-sage)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)] disabled:cursor-not-allowed disabled:opacity-50"
				disabled={dlqReplayBusy || neonDisabled}
				onclick={() => void replayDlqSelected()}
			>
				{dlqReplayBusy ? 'Replaying…' : 'Replay selected'}
			</button>
			<button
				type="button"
				class="inline-flex min-h-[44px] items-center rounded-lg border border-[var(--color-border)] bg-transparent px-5 py-3 font-mono text-sm text-sophia-dark-muted transition hover:border-[var(--color-sage)] hover:text-sophia-dark-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)]"
				disabled={dlqItems.length === 0}
				onclick={exportDlqCsv}
			>
				Export CSV
			</button>
			<button
				type="button"
				class="inline-flex min-h-[44px] items-center rounded-lg border border-[var(--color-border)] bg-transparent px-5 py-3 font-mono text-sm text-sophia-dark-muted transition hover:border-[var(--color-sage)] hover:text-sophia-dark-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)]"
				disabled={dlqLoading}
				onclick={() => void loadDlq()}
			>
				{dlqLoading ? 'Loading…' : 'Refresh DLQ'}
			</button>
		</div>
		{#if dlqLoading && dlqItems.length === 0}
			<p class="mt-4 font-mono text-sm text-sophia-dark-muted">Loading…</p>
		{:else if dlqItems.length === 0}
			<p class="mt-4 text-sm text-sophia-dark-muted">No dead-letter rows (or none stamped yet).</p>
		{:else}
			<div class="mt-4 overflow-x-auto">
				<table class="w-full min-w-[800px] border-collapse text-left text-sm">
					<thead>
						<tr class="border-b border-[var(--color-border)] font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-dim">
							<th class="py-3 pr-2"></th>
							<th class="py-3 pr-3">Job</th>
							<th class="py-3 pr-3">URL</th>
							<th class="py-3 pr-3">Class</th>
							<th class="py-3 pr-3">Attempts</th>
							<th class="py-3 pr-3">Replays</th>
							<th class="py-3 pr-3">DLQ at</th>
							<th class="py-3">Error</th>
						</tr>
					</thead>
					<tbody>
						{#each dlqItems as r (r.itemId)}
							<tr class="border-b border-[var(--color-border)]/60 align-top">
								<td class="py-3 pr-2">
									<input
										type="checkbox"
										class="h-5 w-5 rounded border-[var(--color-border)]"
										checked={Boolean(dlqSelected[r.itemId])}
										onchange={() => toggleDlq(r.itemId)}
									/>
								</td>
								<td class="py-3 pr-3 font-mono text-xs">
									<a
										href="/admin/ingest/jobs/{encodeURIComponent(r.jobId)}"
										class="text-sophia-dark-sage underline-offset-2 hover:underline"
									>
										{r.jobId.slice(0, 24)}…
									</a>
								</td>
								<td class="max-w-[220px] py-3 pr-3 font-mono text-xs break-all">{r.url}</td>
								<td class="py-3 pr-3 font-mono text-xs">{r.failureClass ?? '—'}</td>
								<td class="py-3 pr-3 font-mono text-xs">{r.attempts}</td>
								<td class="py-3 pr-3 font-mono text-xs">{r.dlqReplayCount}</td>
								<td class="py-3 pr-3 font-mono text-xs text-sophia-dark-muted">
									{r.dlqEnqueuedAt ? new Date(r.dlqEnqueuedAt).toLocaleString() : '—'}
								</td>
								<td class="py-3 font-mono text-xs text-red-200/90">{r.lastError ?? '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	<section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5" aria-labelledby="recent-heading">
		<h2 id="recent-heading" class="font-serif text-lg text-sophia-dark-text">Recent jobs</h2>
		{#if loading && jobs.length === 0}
			<p class="mt-4 font-mono text-sm text-sophia-dark-muted">Loading…</p>
		{:else if jobs.length === 0}
			<p class="mt-4 text-sm text-sophia-dark-muted">No jobs yet.</p>
		{:else}
			<div class="mt-4 overflow-x-auto">
				<table class="w-full min-w-[640px] border-collapse text-left text-sm">
					<thead>
						<tr class="border-b border-[var(--color-border)] font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-dim">
							<th class="py-3 pr-4">Job</th>
							<th class="py-3 pr-4">Status</th>
							<th class="py-3 pr-4">Summary</th>
							<th class="py-3">Updated</th>
						</tr>
					</thead>
					<tbody>
						{#each jobs as j (j.id)}
							<tr class="border-b border-[var(--color-border)]/60">
								<td class="py-3 pr-4 font-mono text-xs">
									<a
										href="/admin/ingest/jobs/{encodeURIComponent(j.id)}"
										class="text-sophia-dark-sage underline-offset-2 hover:underline"
									>
										{j.id}
									</a>
								</td>
								<td class="py-3 pr-4">{j.status}</td>
								<td class="py-3 pr-4 font-mono text-xs text-sophia-dark-muted">{formatSummary(j.summary)}</td>
								<td class="py-3 font-mono text-xs text-sophia-dark-muted">
									{j.updatedAt ? new Date(j.updatedAt).toLocaleString() : '—'}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</main>

<style>
	.jobs-page {
		min-height: calc(100vh - var(--nav-height));
		padding: 20px;
		max-width: 1240px;
		margin: 0 auto;
		color: var(--color-text);
	}
	.jobs-hero {
		border: 1px solid var(--color-border);
		background: linear-gradient(130deg, rgba(127, 163, 131, 0.16), rgba(44, 96, 142, 0.12));
		border-radius: 12px;
		padding: 20px;
		margin-bottom: 24px;
	}
</style>
