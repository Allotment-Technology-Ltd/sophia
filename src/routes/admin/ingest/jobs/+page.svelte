<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { getIdToken } from '$lib/authClient';
	import { MAX_DURABLE_INGEST_JOB_CONCURRENCY } from '$lib/ingestionJobConcurrency';
	import {
		ADMIN_INGEST_WORKER_UI_DEFAULTS as JOB_UI,
		ADMIN_INGEST_WORKER_UI_TOOLTIPS as JOB_TT
	} from '$lib/adminIngestWorkerUiDefaults';

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
	let concurrency = $state(MAX_DURABLE_INGEST_JOB_CONCURRENCY);
	let notes = $state('');
	let validateLlm = $state(false);
	/** Append URLs to the most recently touched running job instead of starting a second job (eases global worker cap). */
	let mergeIntoRunningJob = $state(false);

	const JOB_WORKER_SETTINGS_KEY = 'sophia.admin.ingestJobWorkerDefaults.v2';

	/** Optional per-item worker tuning (stored on job row, merged into each child `batch_overrides`). */
	let workerTuningOpen = $state(false);
	let jobExtractionConcurrency = $state(JOB_UI.extractionConcurrency);
	let jobExtractionMaxTokens = $state(JOB_UI.extractionMaxTokensPerSection);
	let jobPassageInsertConcurrency = $state(JOB_UI.passageInsertConcurrency);
	let jobClaimInsertConcurrency = $state(JOB_UI.claimInsertConcurrency);
	let jobRemediationMaxClaims = $state(JOB_UI.remediationMaxClaims);
	let jobRelationsOverlap = $state(JOB_UI.relationsBatchOverlapClaims);
	/** Default `auto`: canonical Gemini-on-Vertex primaries + Mistral fallbacks; persisted per browser. */
	let jobIngestProvider = $state<'auto' | 'anthropic' | 'vertex' | 'mistral'>('auto');
	let jobGoogleThroughputEnabled = $state(true);
	let jobGoogleExtractionFloor = $state(JOB_UI.googleExtractionConcurrencyFloor);
	/** Re-run from extraction when Surreal `ingestion_log` is already complete (INGEST_FORCE_REINGEST). */
	/** Off by default: when on, sets INGEST_FORCE_REINGEST and breaks checkpoint resume (use only for intentional full re-churn). */
	let jobForceReingest = $state(false);
	/** When on, worker passes `--force-stage validating` (skip extract→embed if checkpoints allow). Mutually exclusive with full re-ingest. */
	let jobValidationTailOnly = $state(false);
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

	/** Rolling window for training-acceptable Neon preset (days). */
	let cohortDays = $state(90);
	let presetBusy = $state(false);
	let presetMessage = $state('');

	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let jobWorkerFieldsHydrated = $state(false);
	let advanceQueuesBusy = $state(false);
	let advanceQueuesMessage = $state('');

	function jobRowSortRank(j: JobRow): number {
		const st = (j.status ?? '').toLowerCase();
		if (st === 'running') return 0;
		const p = j.summary?.pending ?? 0;
		const r = j.summary?.running ?? 0;
		const e = j.summary?.error ?? 0;
		if (p > 0 || r > 0) return 1;
		if (e > 0) return 2;
		if (st === 'cancelled') return 4;
		if (st === 'done') return 5;
		return 3;
	}

	const sortedJobs = $derived(
		[...jobs].sort((a, b) => {
			const d = jobRowSortRank(a) - jobRowSortRank(b);
			if (d !== 0) return d;
			const ua = a.updatedAt ?? '';
			const ub = b.updatedAt ?? '';
			return ub.localeCompare(ua);
		})
	);

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

	/** Number inputs use `bind:value` on string-initialized state → runtime value can be `number`; coerce before `.trim()`. */
	function parseOptionalInt(input: string | number | null | undefined, min: number, max: number): number | undefined {
		const t = String(input ?? '').trim();
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
		if (!jobGoogleThroughputEnabled) o.googleGenerativeThroughput = false;
		const gFloor = parseOptionalInt(jobGoogleExtractionFloor, 1, 12);
		if (gFloor != null) o.googleExtractionConcurrencyFloor = gFloor;
		if (jobValidationTailOnly) {
			o.forceStage = 'validating';
			o.forceStageMissingCheckpoint = 'resume';
		}
		if (jobForceReingest && !jobValidationTailOnly) o.forceReingest = true;
		o.failOnGroupingPositionCollapse = jobFailOnGroupingCollapse;
		o.ingestLogPins = jobIngestLogPins;
		if (validateLlm) {
			o.ingestRemediationEnabled = jobRemediationEnabled;
			o.ingestRemediationRevalidate = jobRemediationRevalidate;
		}
		const idleRaw = String(jobWatchdogPhaseIdleJson ?? '').trim();
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
		const multRaw = String(jobWatchdogBaselineMult ?? '').trim();
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
					jobGoogleThroughputEnabled,
					jobGoogleExtractionFloor,
					jobFailOnGroupingCollapse,
					jobIngestLogPins,
					jobRemediationEnabled,
					jobRemediationRevalidate,
					jobWatchdogPhaseIdleJson,
					jobWatchdogBaselineMult,
					jobForceReingest,
					jobValidationTailOnly
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

	async function loadJobs(opts?: { withGlobalTick?: boolean }): Promise<void> {
		loadError = '';
		neonDisabled = false;
		loading = true;
		try {
			const tick = opts?.withGlobalTick === true ? '1' : '0';
			const res = await fetch(`/api/admin/ingest/jobs?limit=50&tick=${tick}`, {
				headers: await authHeaders()
			});
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

	/** Runs {@link tickAllRunningIngestionJobs} on the server (can be slow); use poller in unattended env. */
	async function advanceQueuesThenRefresh(): Promise<void> {
		advanceQueuesMessage = '';
		advanceQueuesBusy = true;
		try {
			const res = await fetch('/api/admin/ingest/jobs?limit=50&tick=1', { headers: await authHeaders() });
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(typeof body?.error === 'string' ? body.error : 'Advance queues failed.');
			}
			jobs = Array.isArray(body?.jobs) ? (body.jobs as JobRow[]) : [];
			const ticked =
				typeof (body as { globalTickJobsProcessed?: unknown }).globalTickJobsProcessed === 'number'
					? (body as { globalTickJobsProcessed: number }).globalTickJobsProcessed
					: null;
			advanceQueuesMessage =
				ticked != null
					? `Advance finished (${ticked} job queue pass(es)); ${jobs.length} job(s) listed.`
					: 'Queues advanced; list refreshed.';
			setTimeout(() => {
				advanceQueuesMessage = '';
			}, 4000);
		} catch (e) {
			advanceQueuesMessage = e instanceof Error ? e.message : 'Advance failed.';
		} finally {
			advanceQueuesBusy = false;
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

	async function fillUrlsFromJobPreset(preset: 'golden' | 'training_acceptable'): Promise<void> {
		presetMessage = '';
		presetBusy = true;
		try {
			const params = new URLSearchParams();
			params.set('preset', preset);
			if (preset === 'training_acceptable') {
				const d = Math.min(730, Math.max(1, Math.trunc(Number(cohortDays)) || 90));
				params.set('days', String(d));
				// Do not pass `validate=1` here: "Run LLM validation" only affects the job payload, not which Neon runs
				// appear in the preset. (validate=true-only lists are tiny; use "Golden + training (validation-tail)" for that.)
			}
			const res = await fetch(`/api/admin/ingest/jobs/url-presets?${params}`, { headers: await authHeaders() });
			const body = await res.json().catch(() => ({}));
			if (res.status === 503) {
				presetMessage =
					typeof body?.error === 'string' ? body.error : 'Neon is required for the training cohort preset.';
				return;
			}
			if (!res.ok) {
				throw new Error(typeof body?.error === 'string' ? body.error : 'Preset request failed.');
			}
			const rawUrls = Array.isArray(body?.urls) ? body.urls : [];
			const lines = rawUrls
				.map((row: { url?: string }) => (typeof row?.url === 'string' ? row.url.trim() : ''))
				.filter(Boolean);
			if (lines.length === 0) {
				presetMessage = 'Preset returned no URLs.';
				return;
			}
			urlsInput = lines.join('\n');
			const fp = typeof body?.cohortFingerprint === 'string' ? body.cohortFingerprint : '';
			const fpNote = fp ? `cohort_fp=${fp}` : '';
			if (preset === 'golden') {
				presetMessage = `Loaded ${lines.length} golden URL(s)${fpNote ? ` · ${fpNote}` : ''}.`;
			} else {
				const win = typeof body?.days === 'number' ? body.days : Math.trunc(Number(cohortDays)) || 90;
				presetMessage = `Loaded ${lines.length} unique URL(s) — ${win}d, all training-acceptable runs (any validate flag)${fpNote ? ` · ${fpNote}` : ''}.`;
			}
		} catch (e) {
			presetMessage = e instanceof Error ? e.message : 'Preset failed.';
		} finally {
			presetBusy = false;
		}
	}

	/** Golden ∪ training (validate=true) for validation-tail jobs — toggles validate + tail, clears full re-ingest. */
	async function fillPhase1ValidationTailPresets(): Promise<void> {
		presetMessage = '';
		presetBusy = true;
		validateLlm = true;
		jobValidationTailOnly = true;
		jobForceReingest = false;
		try {
			const d = Math.min(730, Math.max(1, Math.trunc(Number(cohortDays)) || 90));
			const [gr, tr] = await Promise.all([
				fetch(
					`/api/admin/ingest/jobs/url-presets?preset=golden&omit_validated=1&days=${d}`,
					{ headers: await authHeaders() }
				),
				fetch(
					`/api/admin/ingest/jobs/url-presets?preset=training_acceptable&days=${d}&validate=1&omit_validated=1`,
					{ headers: await authHeaders() }
				)
			]);
			const goldenBody = await gr.json().catch(() => ({}));
			const trainBody = await tr.json().catch(() => ({}));
			if (!gr.ok) {
				throw new Error(typeof goldenBody?.error === 'string' ? goldenBody.error : 'Golden preset failed.');
			}
			if (!tr.ok) {
				throw new Error(
					typeof trainBody?.error === 'string'
						? trainBody.error
						: 'Training cohort preset failed (Neon required).'
				);
			}
			const goldenRows = Array.isArray(goldenBody?.urls) ? (goldenBody.urls as { url?: string }[]) : [];
			const trainRows = Array.isArray(trainBody?.urls) ? (trainBody.urls as { url?: string }[]) : [];
			const byKey = new Map<string, string>();
			for (const row of goldenRows) {
				const u = typeof row?.url === 'string' ? row.url.trim() : '';
				if (!u) continue;
				byKey.set(u.toLowerCase(), u);
			}
			for (const row of trainRows) {
				const u = typeof row?.url === 'string' ? row.url.trim() : '';
				if (!u) continue;
				const k = u.toLowerCase();
				if (!byKey.has(k)) byKey.set(k, u);
			}
			const lines = [...byKey.values()];
			if (lines.length === 0) {
				presetMessage = 'No URLs returned from golden or training presets.';
				return;
			}
			urlsInput = lines.join('\n');
			const gfp =
				typeof goldenBody?.cohortFingerprint === 'string' ? goldenBody.cohortFingerprint : '';
			const tfp =
				typeof trainBody?.cohortFingerprint === 'string' ? trainBody.cohortFingerprint : '';
			presetMessage =
				`Loaded ${lines.length} unique URL(s) — golden (${goldenRows.length}) + training validate cohort (${trainRows.length}, ${d}d), omitting URLs whose latest done run already has validation telemetry. LLM validation + validation tail are on; full re-ingest is off. Fingerprints: golden ${gfp || '—'}, training ${tfp || '—'}.`;
		} catch (e) {
			presetMessage = e instanceof Error ? e.message : 'Preset bundle failed.';
		} finally {
			presetBusy = false;
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
		if (jobValidationTailOnly && !validateLlm) {
			submitMessage = 'Validation tail mode requires “Run LLM validation stage”.';
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
					notes: String(notes ?? '').trim() || null,
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
			const raw =
				localStorage.getItem(JOB_WORKER_SETTINGS_KEY) ??
				localStorage.getItem('sophia.admin.ingestJobWorkerDefaults.v1');
			if (raw) {
				const p = JSON.parse(raw) as Record<string, unknown>;
				const strOrNum = (v: unknown): string =>
					typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
				if (typeof p.jobExtractionConcurrency === 'string' || typeof p.jobExtractionConcurrency === 'number') {
					jobExtractionConcurrency = strOrNum(p.jobExtractionConcurrency);
				}
				if (typeof p.jobExtractionMaxTokens === 'string' || typeof p.jobExtractionMaxTokens === 'number') {
					jobExtractionMaxTokens = strOrNum(p.jobExtractionMaxTokens);
				}
				if (
					typeof p.jobPassageInsertConcurrency === 'string' ||
					typeof p.jobPassageInsertConcurrency === 'number'
				) {
					jobPassageInsertConcurrency = strOrNum(p.jobPassageInsertConcurrency);
				}
				if (typeof p.jobClaimInsertConcurrency === 'string' || typeof p.jobClaimInsertConcurrency === 'number') {
					jobClaimInsertConcurrency = strOrNum(p.jobClaimInsertConcurrency);
				}
				if (typeof p.jobRemediationMaxClaims === 'string' || typeof p.jobRemediationMaxClaims === 'number') {
					jobRemediationMaxClaims = strOrNum(p.jobRemediationMaxClaims);
				}
				if (typeof p.jobRelationsOverlap === 'string' || typeof p.jobRelationsOverlap === 'number') {
					jobRelationsOverlap = strOrNum(p.jobRelationsOverlap);
				}
				if (
					p.jobIngestProvider === 'auto' ||
					p.jobIngestProvider === 'anthropic' ||
					p.jobIngestProvider === 'vertex' ||
					p.jobIngestProvider === 'mistral'
				) {
					jobIngestProvider = p.jobIngestProvider;
				}
				if (typeof p.jobGoogleThroughputEnabled === 'boolean') {
					jobGoogleThroughputEnabled = p.jobGoogleThroughputEnabled;
				}
				if (typeof p.jobGoogleExtractionFloor === 'string' || typeof p.jobGoogleExtractionFloor === 'number') {
					jobGoogleExtractionFloor =
						typeof p.jobGoogleExtractionFloor === 'string'
							? p.jobGoogleExtractionFloor
							: String(p.jobGoogleExtractionFloor);
				}
				if (typeof p.jobForceReingest === 'boolean') {
					jobForceReingest = p.jobForceReingest;
				} else if (!('jobForceReingest' in p)) {
					jobForceReingest = false;
				}
				if (typeof p.jobValidationTailOnly === 'boolean') {
					jobValidationTailOnly = p.jobValidationTailOnly;
				} else if (!('jobValidationTailOnly' in p)) {
					jobValidationTailOnly = false;
				}
				if (typeof p.jobFailOnGroupingCollapse === 'boolean')
					jobFailOnGroupingCollapse = p.jobFailOnGroupingCollapse;
				if (typeof p.jobIngestLogPins === 'boolean') jobIngestLogPins = p.jobIngestLogPins;
				if (typeof p.jobRemediationEnabled === 'boolean') jobRemediationEnabled = p.jobRemediationEnabled;
				if (typeof p.jobRemediationRevalidate === 'boolean')
					jobRemediationRevalidate = p.jobRemediationRevalidate;
				if (typeof p.jobWatchdogPhaseIdleJson === 'string')
					jobWatchdogPhaseIdleJson = p.jobWatchdogPhaseIdleJson;
				if (typeof p.jobWatchdogBaselineMult === 'string' || typeof p.jobWatchdogBaselineMult === 'number') {
					jobWatchdogBaselineMult = strOrNum(p.jobWatchdogBaselineMult);
				}
			}
			const nz = (s: string, d: string) => (String(s ?? '').trim() === '' ? d : String(s));
			jobExtractionConcurrency = nz(jobExtractionConcurrency, JOB_UI.extractionConcurrency);
			jobExtractionMaxTokens = nz(jobExtractionMaxTokens, JOB_UI.extractionMaxTokensPerSection);
			jobPassageInsertConcurrency = nz(jobPassageInsertConcurrency, JOB_UI.passageInsertConcurrency);
			jobClaimInsertConcurrency = nz(jobClaimInsertConcurrency, JOB_UI.claimInsertConcurrency);
			jobRemediationMaxClaims = nz(jobRemediationMaxClaims, JOB_UI.remediationMaxClaims);
			jobRelationsOverlap = nz(jobRelationsOverlap, JOB_UI.relationsBatchOverlapClaims);
			jobGoogleExtractionFloor = nz(jobGoogleExtractionFloor, JOB_UI.googleExtractionConcurrencyFloor);
		} catch {
			/* ignore */
		}
		jobWorkerFieldsHydrated = true;
		void loadJobs();
		void loadSepPresets();
		void loadDlq();
		pollTimer = setInterval(() => {
			void loadJobs({ withGlobalTick: false });
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
			jobGoogleThroughputEnabled +
			jobGoogleExtractionFloor +
			jobFailOnGroupingCollapse +
			jobIngestLogPins +
			jobRemediationEnabled +
			jobRemediationRevalidate +
			jobWatchdogPhaseIdleJson +
			jobWatchdogBaselineMult +
			jobForceReingest +
			jobValidationTailOnly
		);
		persistJobWorkerFields();
	});

	$effect(() => {
		if (jobValidationTailOnly) {
			jobForceReingest = false;
			validateLlm = true;
		}
	});
	$effect(() => {
		if (jobForceReingest) jobValidationTailOnly = false;
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
			Neon-backed multi-URL jobs: by default each URL runs the full pipeline through Surreal store. Enable
			<strong class="font-medium text-sophia-dark-text">Validation tail only</strong> (worker tuning) to pass
			<code class="rounded bg-black/20 px-1 py-0.5 font-mono text-xs">--force-stage validating</code> so
			extract / relate / group / embed are skipped only when the <strong>same</strong> child orchestration run
			already has checkpoints through embedding (not on a brand-new run id’s first start). Store still runs when
			reached so remediation and relation fixes persist. The job list below loads without running a global queue tick (fast).
			Use <strong class="font-medium text-sophia-dark-text">Advance all queues</strong> when you want this browser session to
			run the same tick as <code class="rounded bg-black/20 px-1 py-0.5 font-mono text-xs">pnpm ingestion:job-poller</code> (can take a while).
			On a <strong class="font-medium text-sophia-dark-text">job detail</strong> page, loads are fast reads; use
			<strong class="font-medium text-sophia-dark-text">Advance this job’s queue</strong> there (or the poller) to run a
			tick. If no admin tab is open, use Cloud Run Job + Scheduler — see
			<span class="font-mono text-xs">docs/local/operations/ingestion-credits-and-workers.md</span>.
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
				<span class="font-mono text-xs">ingest_runs</span> / job items (<span class="font-mono text-xs">done</span>),
				any run flagged <span class="font-mono text-xs">exclude_from_batch_suggest</span> (set from
				<strong class="text-sophia-dark-text">Admin → Ingest → Review &amp; run</strong> on a terminal run), with
				Surreal <span class="font-mono text-xs">ingestion_log</span> rows where
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
				<span class="text-sm text-sophia-dark-text">Exclude URLs already ingested or operator-suppressed (Neon + Surreal)</span>
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
			<div class="flex flex-wrap items-end gap-3">
				<label class="block w-24">
					<span class="font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-dim">Cohort days</span>
					<input
						type="number"
						min="1"
						max="730"
						title="Window for training-acceptable preset (Neon completed runs)"
						class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)]"
						bind:value={cohortDays}
					/>
				</label>
				<button
					type="button"
					class="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[color-mix(in_srgb,var(--color-blue)_35%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-blue)_10%,var(--color-surface))] px-4 py-2 font-mono text-xs font-medium uppercase tracking-[0.06em] text-sophia-dark-text transition hover:border-[var(--color-blue)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)] disabled:cursor-not-allowed disabled:opacity-50"
					disabled={presetBusy || neonDisabled}
					onclick={() => void fillUrlsFromJobPreset('golden')}
				>
					{presetBusy ? 'Loading…' : 'Golden URLs'}
				</button>
				<button
					type="button"
					title="Training-acceptable Neon completes in the cohort window, one row per canonical URL (latest run). Ignores “Run LLM validation” — that checkbox only affects new jobs. For Neon runs that used payload.validate=true only, use Golden + training (validation-tail)."
					class="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[color-mix(in_srgb,var(--color-blue)_35%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-blue)_10%,var(--color-surface))] px-4 py-2 font-mono text-xs font-medium uppercase tracking-[0.06em] text-sophia-dark-text transition hover:border-[var(--color-blue)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)] disabled:cursor-not-allowed disabled:opacity-50"
					disabled={presetBusy || neonDisabled}
					onclick={() => void fillUrlsFromJobPreset('training_acceptable')}
				>
					{presetBusy ? 'Loading…' : 'Training cohort'}
				</button>
				<button
					type="button"
					title={JOB_TT.phase1ValidationTailPresets}
					class="mt-6 inline-flex min-h-[44px] max-w-[28rem] flex-col items-stretch justify-center rounded-lg border border-[color-mix(in_srgb,var(--color-sage)_40%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-sage)_14%,var(--color-surface))] px-4 py-2 text-left font-mono text-xs font-medium uppercase tracking-[0.06em] text-sophia-dark-text transition hover:border-[var(--color-sage)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)] disabled:cursor-not-allowed disabled:opacity-50"
					disabled={presetBusy || neonDisabled}
					onclick={() => void fillPhase1ValidationTailPresets()}
				>
					<span>{presetBusy ? 'Loading…' : 'Golden + training (validation-tail)'}</span>
					<span class="mt-1 block text-[0.65rem] font-normal normal-case leading-snug text-sophia-dark-muted">
						Fills list, turns on validate + tail only, uses training preset with validate=true
					</span>
				</button>
			</div>
			{#if presetMessage}
				<p class="mt-2 text-sm text-sophia-dark-muted" role="status">{presetMessage}</p>
			{/if}
			<div class="flex flex-wrap items-end gap-4">
				<label class="block" title={JOB_TT.jobConcurrency}>
					<span class="font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-dim">Concurrency</span>
					<input
						type="number"
						min="1"
						max={MAX_DURABLE_INGEST_JOB_CONCURRENCY}
						title={JOB_TT.jobConcurrency}
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
					Shown numbers match the current production-friendly baseline (ingest script defaults + ingest worker caps). They are
					stored on the job row and remembered in this browser. Hover any field for env var names and rate-limit / pairing
					advice. Durable jobs always pin <span class="font-mono text-xs">voyage__voyage-4-lite</span> on the child (1024-dim corpus); embed
					batch size only affects Vertex embedding runs. For full model routing, use
					<a href="/admin/ingest" class="text-[var(--color-sage)] underline-offset-2 hover:underline">single-run ingest</a>.
				</p>
				<label
					class="mt-3 flex cursor-pointer items-center gap-3 rounded border border-[var(--color-border)]/60 bg-black/15 p-3"
					class:opacity-50={jobValidationTailOnly}
					class:pointer-events-none={jobValidationTailOnly}
					title={jobValidationTailOnly ? 'Disabled while “Validation tail only” is on.' : JOB_TT.forceReingest}
				>
					<input
						type="checkbox"
						bind:checked={jobForceReingest}
						disabled={jobValidationTailOnly}
						class="h-5 w-5 rounded border-[var(--color-border)] disabled:cursor-not-allowed"
						title={JOB_TT.forceReingest}
					/>
					<span class="text-sm text-sophia-dark-text">
						Re-ingest — bypass “already complete” in Surreal <span class="font-mono text-xs">ingestion_log</span>
						(<span class="font-mono text-xs">INGEST_FORCE_REINGEST</span> / <span class="font-mono text-xs">--force-stage extracting</span>). Turn off only for net-new URLs.
					</span>
				</label>
				<div class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					<label class="block" title={JOB_TT.extractionConcurrency}>
						<span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Extraction parallelism</span>
						<input
							type="number"
							min="1"
							max="16"
							title={JOB_TT.extractionConcurrency}
							class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm"
							bind:value={jobExtractionConcurrency}
							placeholder="INGEST_EXTRACTION_CONCURRENCY"
						/>
					</label>
					<label class="block" title={JOB_TT.extractionMaxTokensPerSection}>
						<span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Max tokens / section</span>
						<input
							type="number"
							min="1000"
							max="20000"
							title={JOB_TT.extractionMaxTokensPerSection}
							class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm"
							bind:value={jobExtractionMaxTokens}
							placeholder="INGEST_EXTRACTION_MAX_TOKENS_PER_SECTION"
						/>
					</label>
					<label class="block" title={JOB_TT.passageInsertConcurrency}>
						<span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Surreal passage inserts</span>
						<input
							type="number"
							min="1"
							max="12"
							title={JOB_TT.passageInsertConcurrency}
							class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm"
							bind:value={jobPassageInsertConcurrency}
							placeholder="INGEST_PASSAGE_INSERT_CONCURRENCY"
						/>
					</label>
					<label class="block" title={JOB_TT.claimInsertConcurrency}>
						<span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Surreal claim inserts</span>
						<input
							type="number"
							min="1"
							max="24"
							title={JOB_TT.claimInsertConcurrency}
							class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm"
							bind:value={jobClaimInsertConcurrency}
							placeholder="INGEST_CLAIM_INSERT_CONCURRENCY"
						/>
					</label>
					<label class="block" title={JOB_TT.remediationMaxClaims}>
						<span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Remediation max claims</span>
						<input
							type="number"
							min="1"
							max="200"
							title={JOB_TT.remediationMaxClaims}
							class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm"
							bind:value={jobRemediationMaxClaims}
							placeholder="INGEST_REMEDIATION_MAX_CLAIMS"
						/>
					</label>
					<label class="block" title={JOB_TT.relationsBatchOverlapClaims}>
						<span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Relations overlap</span>
						<input
							type="number"
							min="1"
							max="99"
							title={JOB_TT.relationsBatchOverlapClaims}
							class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm"
							bind:value={jobRelationsOverlap}
							placeholder="RELATIONS_BATCH_OVERLAP_CLAIMS"
						/>
					</label>
					<label class="block sm:col-span-2" title={JOB_TT.ingestProvider}>
						<span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Ingest provider</span>
						<select
							title={JOB_TT.ingestProvider}
							class="mt-2 w-full max-w-xs rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm"
							bind:value={jobIngestProvider}
						>
							<option value="auto">auto (canonical: Gemini-first, Mistral fallback)</option>
							<option value="vertex">vertex</option>
							<option value="mistral">mistral</option>
							<option value="anthropic">anthropic</option>
						</select>
					</label>
					<label class="flex cursor-pointer items-center gap-3 sm:col-span-2" title={JOB_TT.googleThroughput}>
						<input
							type="checkbox"
							bind:checked={jobGoogleThroughputEnabled}
							class="h-5 w-5 rounded border-[var(--color-border)]"
							title={JOB_TT.googleThroughput}
						/>
						<span class="text-sm text-sophia-dark-text">
							Google / Vertex throughput mode (<span class="font-mono text-xs">INGEST_GOOGLE_GENERATIVE_THROUGHPUT</span>) — faster
							parallel extraction + zero Vertex embed delay when unset
						</span>
					</label>
					<label class="block sm:col-span-2" title={JOB_TT.googleExtractionFloor}>
						<span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim"
							>Google extraction concurrency floor</span
						>
						<input
							type="number"
							min="1"
							max="12"
							title={JOB_TT.googleExtractionFloor}
							class="mt-2 w-full max-w-xs rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm"
							bind:value={jobGoogleExtractionFloor}
							placeholder="INGEST_GOOGLE_EXTRACTION_CONCURRENCY_FLOOR (default 6)"
						/>
					</label>
				</div>
				<label class="mt-3 flex cursor-pointer items-center gap-3" title={JOB_TT.failOnGroupingCollapse}>
					<input type="checkbox" bind:checked={jobFailOnGroupingCollapse} class="h-5 w-5 rounded border-[var(--color-border)]" title={JOB_TT.failOnGroupingCollapse} />
					<span class="text-sm text-sophia-dark-text">Fail on grouping position collapse (strict)</span>
				</label>
				<label class="mt-2 flex cursor-pointer items-center gap-3" title={JOB_TT.ingestLogPins}>
					<input type="checkbox" bind:checked={jobIngestLogPins} class="h-5 w-5 rounded border-[var(--color-border)]" title={JOB_TT.ingestLogPins} />
					<span class="text-sm text-sophia-dark-text">Log routing pin diagnostics (INGEST_LOG_PINS)</span>
				</label>
				{#if validateLlm}
					<div class="mt-3 space-y-2 rounded border border-[var(--color-border)]/60 bg-black/15 p-3">
						<p class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Remediation (when validation on)</p>
						<label class="flex cursor-pointer items-center gap-3" title={JOB_TT.remediationEnabled}>
							<input type="checkbox" bind:checked={jobRemediationEnabled} class="h-5 w-5 rounded border-[var(--color-border)]" title={JOB_TT.remediationEnabled} />
							<span class="text-sm text-sophia-dark-text">Enable remediation pass</span>
						</label>
						<label class="flex cursor-pointer items-center gap-3" title={JOB_TT.remediationRevalidate}>
							<input type="checkbox" bind:checked={jobRemediationRevalidate} class="h-5 w-5 rounded border-[var(--color-border)]" title={JOB_TT.remediationRevalidate} />
							<span class="text-sm text-sophia-dark-text">Re-validate after remediation</span>
						</label>
					</div>
				{/if}
				<label class="mt-4 block" title={JOB_TT.watchdogPhaseIdleJson}>
					<span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Watchdog phase idle (JSON, ms)</span>
					<textarea
						title={JOB_TT.watchdogPhaseIdleJson}
						class="mt-2 min-h-[72px] w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-xs"
						bind:value={jobWatchdogPhaseIdleJson}
						placeholder={JSON.stringify({ extracting: 480000, storing: 600000 })}
						rows="3"
					></textarea>
				</label>
				<label class="mt-2 block max-w-xs" title={JOB_TT.watchdogBaselineMult}>
					<span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Watchdog baseline mult.</span>
					<input
						type="number"
						min="0.5"
						max="10"
						step="0.1"
						title={JOB_TT.watchdogBaselineMult}
						class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm"
						bind:value={jobWatchdogBaselineMult}
						placeholder="e.g. 2.5"
					/>
				</label>
			</details>

			<label class="flex cursor-pointer items-center gap-3" title={JOB_TT.validateLlm}>
				<input type="checkbox" bind:checked={validateLlm} class="h-5 w-5 rounded border-[var(--color-border)]" title={JOB_TT.validateLlm} />
				<span class="text-sm text-sophia-dark-text">Run LLM validation stage</span>
			</label>
			<label class="mt-2 flex cursor-pointer items-start gap-3" title={JOB_TT.validationTailOnly}>
				<input
					type="checkbox"
					bind:checked={jobValidationTailOnly}
					class="mt-0.5 h-5 w-5 shrink-0 rounded border-[var(--color-border)]"
					title={JOB_TT.validationTailOnly}
				/>
				<span class="text-sm leading-snug text-sophia-dark-text">
					Validation tail only (<span class="font-mono text-xs">--force-stage validating</span>) — skip
					re-extract / re-relate / re-group / re-embed when <strong class="font-medium">Neon</strong> has checkpoints
					(claims + full embeddings) for this URL: either the <strong class="font-medium">current</strong> orchestration
					run id, or an <strong class="font-medium">earlier</strong> run the worker can attach to (same canonical URL /
					slug in <span class="font-mono text-xs">ingest_staging_*</span>). Requires
					<span class="font-mono text-xs">DATABASE_URL</span> on the worker. If nothing matches, ingest exits with code
					<span class="font-mono text-xs">3</span> (no auto-retry that strips this flag — that would full re-ingest).
				</span>
			</label>
			{#if jobValidationTailOnly}
				<p class="mt-2 max-w-3xl rounded border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-50">
					If validation-only fails, it is often <strong class="font-medium">not</strong> a missing code fix: the source may
					have never persisted through embedding in Neon, or slug/URL metadata may not match a prior row. Operator
					reference: <span class="font-mono text-[11px]">docs/local/operations/validation-only-ingest-prerequisites.md</span>.
					Re-storing in Surreal still runs if the pipeline reaches Stage 6. Workers can set
					<span class="font-mono">INGEST_SKIP_STORE_WHEN_NO_GRAPH_CHANGES=1</span> to skip Stage 6 when validation and
					remediation changed no graph and a <span class="font-mono">source</span> row already exists.
				</p>
			{/if}
			<label class="flex cursor-pointer items-center gap-3" title={JOB_TT.mergeIntoRunningJob}>
				<input
					type="checkbox"
					bind:checked={mergeIntoRunningJob}
					class="h-5 w-5 rounded border-[var(--color-border)]"
					title={JOB_TT.mergeIntoRunningJob}
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
					disabled={loading || advanceQueuesBusy}
					onclick={() => void loadJobs({ withGlobalTick: false })}
				>
					{loading ? 'Refreshing…' : 'Refresh list'}
				</button>
				<button
					type="button"
					class="rounded-lg border border-[var(--color-border)] bg-transparent px-5 py-3 font-mono text-sm uppercase tracking-[0.08em] text-sophia-dark-muted transition hover:border-[var(--color-sage)] hover:text-sophia-dark-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)] disabled:cursor-not-allowed disabled:opacity-50"
					disabled={neonDisabled || loading || advanceQueuesBusy}
					title="Runs tickAllRunningIngestionJobs on the server (same as the job poller). Can take minutes with many jobs."
					onclick={() => void advanceQueuesThenRefresh()}
				>
					{advanceQueuesBusy ? 'Advancing…' : 'Advance all queues'}
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
		<p class="mt-2 text-xs text-sophia-dark-muted">
			Sorted: active work first (running → jobs with pending/running URLs → errors → done).
		</p>
		{#if advanceQueuesMessage}
			<p class="mt-3 text-sm text-sophia-dark-sage" role="status">{advanceQueuesMessage}</p>
		{/if}
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
						{#each sortedJobs as j (j.id)}
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
