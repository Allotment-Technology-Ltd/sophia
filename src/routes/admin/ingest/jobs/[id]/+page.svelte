<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { getIdToken } from '$lib/authClient';

	type JobSummary = Record<string, number | undefined>;

	type JobRow = {
		id: string;
		status: string;
		concurrency: number;
		validateLlm?: boolean;
		summary: JobSummary;
		pipelineVersion?: string | null;
		embeddingFingerprint?: string | null;
		notes?: string | null;
		actorEmail?: string | null;
		createdAt?: string;
		updatedAt?: string;
		completedAt?: string | null;
	};

	type ItemRow = {
		id: string;
		url: string;
		status: string;
		childRunId?: string | null;
		lastError?: string | null;
		attempts?: number;
		updatedAt?: string;
		dlqEnqueuedAt?: string | null;
		failureClass?: string | null;
		lastFailureKind?: string | null;
		dlqReplayCount?: number;
	};

	type ChildRunSummaryRow = {
		itemId: string;
		childRunId: string;
		url: string;
		runStatus: string;
		validate: boolean;
		extractionModel: string | null;
		avgFaithfulness: number | null;
		issueCount: number;
	};

	type IssuePipelineRecentRow = {
		runId: string;
		url: string | null;
		seq: number;
		kind: string;
		severity: string;
		stageHint: string | null;
		message: string;
		rawLine?: string | null;
		createdAt: string | null;
	};

	type IssuePipelineSignals = {
		totalIssues: number;
		incidentIssueCount: number;
		byKind: Record<string, number>;
		byStageHint: Record<string, number>;
		recent: IssuePipelineRecentRow[];
	};

	type EventRow = {
		seq: number;
		eventType: string;
		payload: Record<string, unknown> | null;
		createdAt?: string;
	};

	const emptyIssuePipelineSignals: IssuePipelineSignals = {
		totalIssues: 0,
		incidentIssueCount: 0,
		byKind: {},
		byStageHint: {},
		recent: []
	};

	let job = $state<JobRow | null>(null);
	let items = $state<ItemRow[]>([]);
	let childRunSummaries = $state<ChildRunSummaryRow[]>([]);
	let issuePipelineSignals = $state<IssuePipelineSignals>({ ...emptyIssuePipelineSignals });
	let issuePipelineCopyStatus = $state('');
	let events = $state<EventRow[]>([]);
	let lastEventSeq = $state(0);
	let loadError = $state('');
	let neonDisabled = $state(false);

	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let pollToken = 0;
	let pollInFlight = $state(false);
	let retryBusy = $state(false);
	let retryMessage = $state('');
	let cancelJobBusy = $state(false);
	let cancelJobMessage = $state('');
	let itemActionBusyId = $state<string | null>(null);
	let itemActionMessage = $state('');
	let childRespawnBusyId = $state<string | null>(null);
	let respawnWorkersBusy = $state(false);
	let respawnWorkersMessage = $state('');
	let advanceJobTickBusy = $state(false);
	let advanceJobTickMessage = $state('');
	/** Shown when opening the ingest monitor in a new tab is blocked by the browser. */
	let openRunMonitorMessage = $state('');
	/** From API — max starts per URL (INGEST_JOB_ITEM_MAX_ATTEMPTS). */
	let itemMaxAttempts = $state(2);

	function currentJobId(): string {
		return page.params.id?.trim() ?? '';
	}

	async function authHeaders(): Promise<Record<string, string>> {
		const token = await getIdToken();
		if (!token) throw new Error('Authentication required.');
		return { Authorization: `Bearer ${token}` };
	}

	const DETAIL_FETCH_MS = 90_000;

	async function fetchDetail(opts?: { tick?: boolean }): Promise<void> {
		const jobId = currentJobId();
		if (!jobId) return;
		loadError = '';
		neonDisabled = false;
		const tickQs = opts?.tick === true ? 'tick=1' : 'tick=0';
		const controller = new AbortController();
		const abortTimer = setTimeout(() => controller.abort(), DETAIL_FETCH_MS);
		try {
			const res = await fetch(`/api/admin/ingest/jobs/${encodeURIComponent(jobId)}?${tickQs}`, {
				headers: await authHeaders(),
				signal: controller.signal
			});
			const body = await res.json().catch(() => ({}));
			if (res.status === 503) {
				neonDisabled = true;
				job = null;
				items = [];
				childRunSummaries = [];
				issuePipelineSignals = { ...emptyIssuePipelineSignals };
				loadError =
					typeof body?.error === 'string' ? body.error : 'Neon ingest persistence is not enabled.';
				return;
			}
			if (!res.ok) {
				throw new Error(typeof body?.error === 'string' ? body.error : 'Failed to load job.');
			}
			const jobBody = (body?.job as JobRow) ?? null;
			if (!jobBody) {
				throw new Error('Job not found or the server returned an incomplete response.');
			}
			job = jobBody;
			items = Array.isArray(body?.items) ? (body.items as ItemRow[]) : [];
			childRunSummaries = Array.isArray(body?.childRunSummaries)
				? (body.childRunSummaries as ChildRunSummaryRow[])
				: [];
			const rawSignals = body?.issuePipelineSignals;
			if (
				rawSignals &&
				typeof rawSignals === 'object' &&
				typeof (rawSignals as IssuePipelineSignals).totalIssues === 'number'
			) {
				const s = rawSignals as IssuePipelineSignals;
				const incidentRaw = (s as { incidentIssueCount?: unknown }).incidentIssueCount;
				const legacyLessResume = (s as { totalIssuesLessResume?: unknown }).totalIssuesLessResume;
				const incidentIssueCount =
					typeof incidentRaw === 'number' && Number.isFinite(incidentRaw)
						? incidentRaw
						: typeof legacyLessResume === 'number' && Number.isFinite(legacyLessResume)
							? legacyLessResume
							: s.totalIssues;
				issuePipelineSignals = {
					totalIssues: s.totalIssues,
					incidentIssueCount,
					byKind: s.byKind && typeof s.byKind === 'object' ? s.byKind : {},
					byStageHint: s.byStageHint && typeof s.byStageHint === 'object' ? s.byStageHint : {},
					recent: Array.isArray(s.recent) ? s.recent : []
				};
			} else {
				issuePipelineSignals = { ...emptyIssuePipelineSignals };
			}
			itemMaxAttempts =
				typeof body?.itemMaxAttempts === 'number' && Number.isFinite(body.itemMaxAttempts)
					? body.itemMaxAttempts
					: 2;
		} catch (e) {
			const aborted =
				(e instanceof DOMException && e.name === 'AbortError') ||
				(e instanceof Error && e.name === 'AbortError');
			if (aborted) {
				loadError =
					'Loading this job timed out. Try again, or use “Advance this job’s queue” if the server was busy ticking this job.';
			} else {
				loadError = e instanceof Error ? e.message : 'Failed to load job.';
			}
			job = null;
			items = [];
			childRunSummaries = [];
			issuePipelineSignals = { ...emptyIssuePipelineSignals };
		} finally {
			clearTimeout(abortTimer);
		}
	}

	/** Runs {@link tickIngestionJob} for this job only (may be slow); then refreshes with a fast read. */
	async function advanceThisJobQueue(): Promise<void> {
		const jobId = currentJobId();
		if (!jobId) return;
		advanceJobTickMessage = '';
		advanceJobTickBusy = true;
		const controller = new AbortController();
		const abortTimer = setTimeout(() => controller.abort(), 120_000);
		try {
			const res = await fetch(`/api/admin/ingest/jobs/${encodeURIComponent(jobId)}?tick=1`, {
				headers: await authHeaders(),
				signal: controller.signal
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(typeof body?.error === 'string' ? body.error : 'Advance job queue failed.');
			}
			await fetchDetail({ tick: false });
			{
				const j = job;
				advanceJobTickMessage = j
					? `Tick finished — pending ${j.summary?.pending ?? 0} · running ${j.summary?.running ?? 0} · done ${j.summary?.done ?? 0} · errors ${j.summary?.error ?? 0}.`
					: 'Tick finished.';
			}
			setTimeout(() => {
				advanceJobTickMessage = '';
			}, 6000);
			await fetchEvents();
		} catch (e) {
			const aborted =
				(e instanceof DOMException && e.name === 'AbortError') ||
				(e instanceof Error && e.name === 'AbortError');
			if (aborted) {
				advanceJobTickMessage = 'Advance timed out (server still busy). Try again in a moment.';
			} else {
				advanceJobTickMessage = e instanceof Error ? e.message : 'Advance failed.';
			}
		} finally {
			clearTimeout(abortTimer);
			advanceJobTickBusy = false;
		}
	}

	async function fetchEvents(): Promise<void> {
		const jobId = currentJobId();
		if (!jobId || neonDisabled) return;
		try {
			const res = await fetch(
				`/api/admin/ingest/jobs/${encodeURIComponent(jobId)}/events?since_seq=${lastEventSeq}&limit=200`,
				{ headers: await authHeaders() }
			);
			const body = await res.json().catch(() => ({}));
			if (!res.ok) return;
			const batch = Array.isArray(body?.events) ? (body.events as EventRow[]) : [];
			if (batch.length === 0) return;
			const merged = [...events, ...batch].sort((a, b) => a.seq - b.seq);
			const seen = new Set<number>();
			events = merged.filter((ev) => {
				if (seen.has(ev.seq)) return false;
				seen.add(ev.seq);
				return true;
			});
			lastEventSeq = Math.max(lastEventSeq, ...batch.map((e) => e.seq));
		} catch {
			/* ignore event poll errors */
		}
	}

	function openChildRun(runId: string | null | undefined): void {
		if (!runId) return;
		openRunMonitorMessage = '';
		const params = new URLSearchParams();
		params.set('runId', runId);
		params.set('monitor', '1');
		const url = `/admin/ingest?${params.toString()}`;
		if (!browser) return;
		const win = window.open(url, '_blank', 'noopener,noreferrer');
		if (!win || win.closed) {
			openRunMonitorMessage =
				'Could not open a new tab (popup blocker?). Allow popups for this site, or open the monitor manually: ' +
				url;
		}
	}

	async function copyIssuePipelineJson(): Promise<void> {
		if (!browser) return;
		issuePipelineCopyStatus = '';
		try {
			await navigator.clipboard.writeText(JSON.stringify(issuePipelineSignals, null, 2));
			issuePipelineCopyStatus = 'Copied JSON to clipboard.';
			setTimeout(() => {
				issuePipelineCopyStatus = '';
			}, 2500);
		} catch {
			issuePipelineCopyStatus = 'Could not copy (clipboard permission).';
		}
	}

	const failedCount = $derived(
		job ? (typeof job.summary?.error === 'number' ? job.summary.error : 0) : 0
	);

	const launchCapErrorCount = $derived(
		items.filter(
			(i) =>
				typeof i.lastError === 'string' && /too many concurrent ingest/i.test(i.lastError)
		).length
	);

	const dlqItemCount = $derived(items.filter((i) => Boolean(i.dlqEnqueuedAt)).length);
	const dlqErrorCount = $derived(
		items.filter((i) => i.status === 'error' && Boolean(i.dlqEnqueuedAt)).length
	);

	const hasPendingOrRunning = $derived(
		items.some((i) => i.status === 'pending' || i.status === 'running')
	);

	function jobItemStatusRank(status: string): number {
		const t = (status ?? '').toLowerCase();
		if (t === 'running') return 0;
		if (t === 'pending') return 1;
		if (t === 'error') return 2;
		if (t === 'cancelled') return 3;
		if (t === 'done') return 4;
		if (t === 'skipped') return 5;
		return 9;
	}

	const sortedJobItems = $derived(
		[...items].sort((a, b) => {
			const d = jobItemStatusRank(a.status) - jobItemStatusRank(b.status);
			if (d !== 0) return d;
			return (a.url ?? '').localeCompare(b.url ?? '');
		})
	);

	const sortedChildRunSummaries = $derived(
		[...childRunSummaries].sort((a, b) => {
			const d = jobItemStatusRank(a.runStatus) - jobItemStatusRank(b.runStatus);
			if (d !== 0) return d;
			return (a.url ?? '').localeCompare(b.url ?? '');
		})
	);

	const checkpointHelpVisible = $derived(
		items.some(
			(i) =>
				typeof i.lastError === 'string' &&
				(/INGEST_FORCE_STAGE_MISSING_CHECKPOINT/i.test(i.lastError) ||
					/Validation-only ingest requires/i.test(i.lastError) ||
					/--force-stage validating requires/i.test(i.lastError) ||
					/exited with code 3/i.test(i.lastError))
		)
	);

	const canStopEntireJob = $derived(
		Boolean(
			job &&
				job.status !== 'cancelled' &&
				(job.status === 'running' || (job.status === 'done' && hasPendingOrRunning))
		)
	);

	async function postItemModify(
		itemId: string,
		action: 'requeue_to_pending' | 'cancel'
	): Promise<void> {
		const jobId = currentJobId();
		if (!jobId) return;
		itemActionBusyId = itemId;
		itemActionMessage = '';
		try {
			const res = await fetch(
				`/api/admin/ingest/jobs/${encodeURIComponent(jobId)}/items/${encodeURIComponent(itemId)}`,
				{
					method: 'POST',
					headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
					body: JSON.stringify({ action })
				}
			);
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(typeof body?.error === 'string' ? body.error : 'Action failed');
			}
			itemActionMessage = '';
			await fetchDetail();
			await fetchEvents();
		} catch (e) {
			itemActionMessage = e instanceof Error ? e.message : 'Action failed';
		} finally {
			itemActionBusyId = null;
		}
	}

	async function postCancelEntireJob(): Promise<void> {
		const jobId = currentJobId();
		if (!jobId) return;
		const ok = window.confirm(
			'Stop this entire ingestion job? Pending URLs will not start; running URLs are abandoned in Neon (in-flight workers may take a moment to exit). You can start a new job afterward.'
		);
		if (!ok) return;
		cancelJobBusy = true;
		cancelJobMessage = '';
		try {
			const res = await fetch(`/api/admin/ingest/jobs/${encodeURIComponent(jobId)}/cancel`, {
				method: 'POST',
				headers: await authHeaders()
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(typeof body?.error === 'string' ? body.error : 'Cancel request failed');
			}
			cancelJobMessage = `Job stopped. Pending cancelled: ${body?.pendingCancelled ?? '—'}, running abandoned: ${body?.runningAbandoned ?? '—'}.`;
			await fetchDetail();
			await fetchEvents();
		} catch (e) {
			cancelJobMessage = e instanceof Error ? e.message : 'Cancel failed';
		} finally {
			cancelJobBusy = false;
		}
	}

	async function postRespawnRunningWorkers(): Promise<void> {
		const jobId = currentJobId();
		if (!jobId) return;
		respawnWorkersBusy = true;
		respawnWorkersMessage = '';
		try {
			const res = await fetch(
				`/api/admin/ingest/jobs/${encodeURIComponent(jobId)}/respawn-workers`,
				{
					method: 'POST',
					headers: await authHeaders()
				}
			);
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(typeof body?.error === 'string' ? body.error : 'Respawn request failed');
			}
			const touched = typeof body.touched === 'number' ? body.touched : 0;
			const results = Array.isArray(body.results) ? body.results : [];
			const failed = results.filter((r: { ok?: boolean }) => r && r.ok === false);
			respawnWorkersMessage =
				failed.length > 0
					? `Touched ${touched} run(s); ${failed.length} failed (${failed.map((f: { error?: string }) => f.error ?? '?').join('; ')}).`
					: touched === 0
						? 'No running items with a child run id — nothing to respawn.'
						: `Started worker respawn for ${touched} run(s) (checkpoint resume on this server).`;
			await fetchDetail();
			await fetchEvents();
		} catch (e) {
			respawnWorkersMessage = e instanceof Error ? e.message : 'Respawn failed';
		} finally {
			respawnWorkersBusy = false;
		}
	}

	async function postRespawnSingleChildRun(childRunId: string): Promise<void> {
		childRespawnBusyId = childRunId;
		itemActionMessage = '';
		try {
			const res = await fetch(
				`/api/admin/ingest/run/${encodeURIComponent(childRunId)}/resume`,
				{
					method: 'POST',
					headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
					body: JSON.stringify({ respawn_stale_worker: true })
				}
			);
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(typeof body?.error === 'string' ? body.error : 'Respawn failed');
			}
			itemActionMessage = `Respawn requested for ${childRunId}.`;
			await fetchDetail();
			await fetchEvents();
		} catch (e) {
			itemActionMessage = e instanceof Error ? e.message : 'Respawn failed';
		} finally {
			childRespawnBusyId = null;
		}
	}

	async function postJobRetry(
		mode: 'restart' | 'resume',
		itemId?: string,
		opts?: { onlyDlq?: boolean }
	): Promise<void> {
		const jobId = currentJobId();
		if (!jobId) return;
		retryBusy = true;
		retryMessage = '';
		itemActionMessage = '';
		try {
			const res = await fetch(`/api/admin/ingest/jobs/${encodeURIComponent(jobId)}/retry`, {
				method: 'POST',
				headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mode,
					...(itemId ? { itemId } : {}),
					...(opts?.onlyDlq ? { only_dlq: true } : {})
				})
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(typeof body?.error === 'string' ? body.error : 'Retry request failed');
			}
			if (Array.isArray(body?.resumeResults)) {
				const bad = (body.resumeResults as { ok?: boolean; error?: string }[]).filter((r) => !r.ok);
				if (bad.length > 0) {
					retryMessage = `Some resumes failed: ${bad.map((b) => b.error ?? '?').join('; ')}`;
				}
			}
			await fetchDetail();
			await fetchEvents();
		} catch (e) {
			retryMessage = e instanceof Error ? e.message : 'Retry failed';
		} finally {
			retryBusy = false;
		}
	}

	/**
	 * Single serial poller: avoids overlapping GETs (Svelte effect + dual intervals caused
	 * ERR_INSUFFICIENT_RESOURCES in Chrome when many requests piled up).
	 */
	$effect(() => {
		if (!browser) return;
		const id = page.params.id?.trim() ?? '';
		if (!id) return;

		pollToken += 1;
		const token = pollToken;
		lastEventSeq = 0;
		events = [];

		function clearPoll(): void {
			if (pollTimer) {
				clearTimeout(pollTimer);
				pollTimer = null;
			}
		}

		function arm(delayMs: number): void {
			clearPoll();
			pollTimer = setTimeout(() => {
				pollTimer = null;
				void pollTick();
			}, delayMs);
		}

		async function pollTick(): Promise<void> {
			if (token !== pollToken) return;
			const jobId = currentJobId();
			if (!jobId) return;
			if (pollInFlight) {
				arm(2000);
				return;
			}
			pollInFlight = true;
			let ok = false;
			try {
				await fetchDetail();
				ok = !neonDisabled && !loadError;
				if (ok && !neonDisabled) await fetchEvents();
			} finally {
				pollInFlight = false;
			}
			if (token !== pollToken) return;
			const j = job;
			const terminal =
				(j &&
					j.status === 'done' &&
					(typeof j.summary?.pending === 'number' ? j.summary.pending : 0) === 0 &&
					(typeof j.summary?.running === 'number' ? j.summary.running : 0) === 0) ||
				j?.status === 'cancelled';
			const baseMs = terminal ? 30_000 : 5000;
			const delayMs = ok ? baseMs : Math.min(60_000, baseMs * 3);
			arm(delayMs);
		}

		void pollTick();

		return () => {
			clearPoll();
			pollToken += 1;
		};
	});
</script>

<svelte:head>
	<title>Ingestion job — Admin</title>
</svelte:head>

<main class="job-detail-page sophia-stack-comfortable">
	<p class="font-mono text-xs">
		<a href="/admin/ingest/jobs" class="text-sophia-dark-sage underline-offset-2 hover:underline">← All jobs</a>
		<span class="text-sophia-dark-muted"> · </span>
		<a href="/admin/ingest/jobs#dead-letter" class="text-sophia-dark-sage underline-offset-2 hover:underline"
			>Dead letter queue</a
		>
	</p>

	{#if neonDisabled}
		<p class="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100" role="status">
			{loadError}
		</p>
	{:else if loadError}
		<p class="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100" role="alert">
			{loadError}
		</p>
	{:else if !job}
		<p class="mt-4 font-mono text-sm text-sophia-dark-muted">Loading job…</p>
		<p class="mt-2 max-w-xl text-xs leading-relaxed text-sophia-dark-dim">
			If this stays here, the request may be slow or blocked — wait, reload, or check auth. Job detail uses a fast
			server read (<span class="font-mono">tick=0</span>); it should not hang on queue work the way the old
			auto-tick did.
		</p>
	{/if}

	{#if openRunMonitorMessage}
		<p class="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100" role="status">
			{openRunMonitorMessage}
		</p>
	{/if}

	{#if job}
		<header class="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h1 class="font-serif text-2xl text-sophia-dark-text">Job</h1>
					<p class="mt-2 break-all font-mono text-xs text-sophia-dark-muted">{job.id}</p>
				</div>
				<div class="flex max-w-md flex-col items-end gap-2">
					<button
						type="button"
						class="inline-flex min-h-[40px] shrink-0 items-center rounded-lg border border-[var(--color-border)] bg-black/10 px-4 py-2 font-mono text-xs text-sophia-dark-text transition hover:bg-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)] disabled:cursor-not-allowed disabled:opacity-50"
						disabled={advanceJobTickBusy || cancelJobBusy || retryBusy || respawnWorkersBusy}
						title="Runs the same server tick as the job poller for this job only (reconcile + launch pending). Can take a while."
						onclick={() => void advanceThisJobQueue()}
					>
						{advanceJobTickBusy ? 'Advancing…' : 'Advance this job’s queue'}
					</button>
					<p class="text-right text-[11px] leading-snug text-sophia-dark-muted">
						Loads use a fast read (<span class="font-mono">tick=0</span>). Use this to drain pending URLs or
						refresh Neon state when no poller is running.
					</p>
				</div>
			</div>
			{#if advanceJobTickMessage}
				<p class="mt-3 text-sm text-sophia-dark-sage" role="status">{advanceJobTickMessage}</p>
			{/if}
			<dl class="mt-4 grid gap-3 font-mono text-xs sm:grid-cols-2">
				<div>
					<dt class="text-sophia-dark-dim">Status</dt>
					<dd class="mt-1 text-sophia-dark-text">{job.status}</dd>
				</div>
				<div>
					<dt class="text-sophia-dark-dim">Concurrency</dt>
					<dd class="mt-1 text-sophia-dark-text">{job.concurrency}</dd>
				</div>
				<div>
					<dt class="text-sophia-dark-dim">Validate LLM</dt>
					<dd class="mt-1 text-sophia-dark-text">{job.validateLlm ? 'yes' : 'no'}</dd>
				</div>
				<div>
					<dt class="text-sophia-dark-dim">Pipeline version</dt>
					<dd class="mt-1 break-all text-sophia-dark-text">{job.pipelineVersion ?? '—'}</dd>
				</div>
				<div class="sm:col-span-2">
					<dt class="text-sophia-dark-dim">Embedding fingerprint</dt>
					<dd class="mt-1 break-all text-sophia-dark-text">{job.embeddingFingerprint ?? '—'}</dd>
				</div>
				{#if job.notes}
					<div class="sm:col-span-2">
						<dt class="text-sophia-dark-dim">Notes</dt>
						<dd class="mt-1 text-sophia-dark-text">{job.notes}</dd>
					</div>
				{/if}
			</dl>

			{#if childRunSummaries.length > 0}
				<details
					class="mt-6 border-t border-[var(--color-border)] pt-5 [&_summary::-webkit-details-marker]:hidden"
					open
				>
					<summary
						class="flex cursor-pointer list-none items-baseline justify-between gap-3 font-serif text-lg text-sophia-dark-text marker:content-none"
					>
						<span>Child runs (Neon)</span>
						<span class="font-mono text-xs font-normal text-sophia-dark-dim">Show / hide</span>
					</summary>
					<div class="mt-3" role="region" aria-label="Child run summaries">
						<p class="text-sm text-sophia-dark-muted">
							Sorted: running → pending → errors → done. Latest snapshot per job item that has a
							<span class="font-mono text-xs">child_run_id</span>. Faithfulness is averaged from
							<span class="font-mono text-xs">ingest_staging_validation</span> when rows exist.
						</p>
						<div class="mt-3 overflow-x-auto rounded-lg border border-[var(--color-border)]">
							<table class="w-full min-w-[760px] border-collapse text-left font-mono text-xs">
								<thead>
									<tr class="border-b border-[var(--color-border)] bg-black/15 text-sophia-dark-dim">
										<th class="px-3 py-2 font-normal">URL</th>
										<th class="px-3 py-2 font-normal">Run</th>
										<th class="px-3 py-2 font-normal">Status</th>
										<th class="px-3 py-2 font-normal">Validate</th>
										<th class="px-3 py-2 font-normal">Extract model</th>
										<th class="px-3 py-2 font-normal">Avg faith.</th>
										<th class="px-3 py-2 font-normal">Issues</th>
										<th class="px-3 py-2 font-normal">Worker</th>
									</tr>
								</thead>
								<tbody>
									{#each sortedChildRunSummaries as s (s.childRunId)}
										<tr class="border-b border-[var(--color-border)]/60 align-top text-sophia-dark-text">
											<td class="max-w-[220px] px-3 py-2 break-all">{s.url}</td>
											<td class="px-3 py-2">
												<button
													type="button"
													class="text-left text-sophia-dark-sage underline-offset-2 hover:underline"
													onclick={() => openChildRun(s.childRunId)}
												>
													{s.childRunId}
												</button>
											</td>
											<td class="px-3 py-2">{s.runStatus}</td>
											<td class="px-3 py-2">{s.validate ? 'yes' : 'no'}</td>
											<td class="max-w-[180px] px-3 py-2 break-all">{s.extractionModel ?? '—'}</td>
											<td class="px-3 py-2">{s.avgFaithfulness != null ? s.avgFaithfulness : '—'}</td>
											<td class="px-3 py-2">{s.issueCount}</td>
											<td class="px-3 py-2">
												{#if s.runStatus === 'running'}
													<button
														type="button"
														class="rounded border border-[var(--color-border)] bg-black/15 px-2 py-1 font-mono text-[11px] uppercase tracking-wide text-sophia-dark-text hover:bg-black/25 disabled:opacity-50"
														disabled={childRespawnBusyId === s.childRunId || respawnWorkersBusy}
														onclick={() => void postRespawnSingleChildRun(s.childRunId)}
													>
														{childRespawnBusyId === s.childRunId ? '…' : 'Respawn'}
													</button>
												{:else}
													<span class="text-sophia-dark-dim">—</span>
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				</details>
			{/if}

			{#if job.status === 'running' && hasPendingOrRunning}
				<div
					class="mt-6 rounded-lg border border-[var(--color-border)] bg-black/10 p-4"
					role="region"
					aria-label="Recover workers after deploy"
				>
					<h2 class="font-serif text-lg text-sophia-dark-text">Workers after deploy</h2>
					<p class="mt-2 text-sm text-sophia-dark-muted">
						A new app revision often leaves <span class="font-mono text-xs">ingest_runs.status=running</span> in Neon
						with <strong>no</strong> local <code class="rounded bg-black/25 px-1 font-mono text-[11px]">tsx</code> child
						on this instance. <strong class="text-sophia-dark-text">Respawn</strong> only starts that CLI worker on the
						<strong>server</strong>; it does not reload your admin browser tab or sign you out. Use the run id links in the
						table above to open the ingest monitor in a <strong>new tab</strong> if you want logs while staying on this job.
						Per-run errors such as “process already attached” mean that URL already has a worker on
						<em>this</em> server — skip or use the monitor for that run id.
					</p>
					{#if respawnWorkersMessage}
						<p class="mt-3 text-sm text-sophia-dark-sage" role="status">{respawnWorkersMessage}</p>
					{/if}
					<button
						type="button"
						class="mt-3 inline-flex min-h-[44px] items-center rounded-lg border border-sophia-dark-sage/50 bg-sophia-dark-sage/15 px-5 py-3 font-mono text-sm font-medium text-sophia-dark-text transition hover:bg-sophia-dark-sage/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sophia-dark-sage disabled:cursor-not-allowed disabled:opacity-50"
						disabled={respawnWorkersBusy || cancelJobBusy || retryBusy}
						onclick={() => void postRespawnRunningWorkers()}
					>
						{respawnWorkersBusy ? 'Respawning…' : 'Respawn workers for all running URLs'}
					</button>
				</div>
			{/if}

			<details
				class="mt-6 border-t border-[var(--color-border)] pt-5 [&_summary::-webkit-details-marker]:hidden"
				open
			>
				<summary
					class="flex cursor-pointer list-none items-center justify-between gap-3 font-serif text-lg text-sophia-dark-text marker:content-none"
				>
					<span>Pipeline issues (Neon)</span>
					<span class="font-mono text-xs font-normal text-sophia-dark-dim">Show / hide</span>
				</summary>
				<div class="mt-3" role="region" aria-label="Pipeline issues from linked child runs">
					<div class="flex flex-wrap items-end justify-between gap-3">
						<p class="text-sm text-sophia-dark-muted">
							Structured rows from <span class="font-mono text-xs">ingest_run_issues</span> for every
							<span class="font-mono text-xs">child_run_id</span> still linked on this job.
						</p>
						<button
							type="button"
							class="inline-flex min-h-[40px] shrink-0 items-center rounded-lg border border-[var(--color-border)] bg-black/10 px-4 py-2 font-mono text-xs text-sophia-dark-text transition hover:bg-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sophia-dark-sage disabled:opacity-50"
							disabled={
								issuePipelineSignals.totalIssues === 0 &&
								issuePipelineSignals.incidentIssueCount === 0
							}
							onclick={() => void copyIssuePipelineJson()}
						>
							Copy rollup JSON
						</button>
					</div>
				{#if issuePipelineCopyStatus}
					<p class="mt-2 text-xs text-sophia-dark-sage" role="status">{issuePipelineCopyStatus}</p>
				{/if}
				{#if issuePipelineSignals.totalIssues === 0}
					<p class="mt-3 text-sm text-sophia-dark-muted">No issues recorded for linked runs yet.</p>
				{:else}
					<p class="mt-3 font-mono text-xs text-sophia-dark-text">
						Total issues: {issuePipelineSignals.totalIssues}
						{#if issuePipelineSignals.incidentIssueCount !== issuePipelineSignals.totalIssues}
							<span class="text-sophia-dark-dim">
								· incidents (excl. resume_checkpoint): {issuePipelineSignals.incidentIssueCount}
							</span>
						{/if}
					</p>
					<div class="mt-4 grid gap-6 lg:grid-cols-2">
						<div>
							<h3 class="text-sm font-medium text-sophia-dark-text">By kind</h3>
							<div class="mt-2 overflow-x-auto rounded-lg border border-[var(--color-border)]">
								<table class="w-full border-collapse text-left font-mono text-xs">
									<tbody>
										{#each Object.entries(issuePipelineSignals.byKind).sort((a, b) => b[1] - a[1]) as [kind, n] (kind)}
											<tr class="border-b border-[var(--color-border)]/60 text-sophia-dark-text">
												<td class="px-3 py-2">{kind}</td>
												<td class="px-3 py-2 text-right tabular-nums">{n}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						</div>
						<div>
							<h3 class="text-sm font-medium text-sophia-dark-text">By stage hint</h3>
							<div class="mt-2 overflow-x-auto rounded-lg border border-[var(--color-border)]">
								<table class="w-full border-collapse text-left font-mono text-xs">
									<tbody>
										{#each Object.entries(issuePipelineSignals.byStageHint).sort((a, b) => b[1] - a[1]) as [stage, n] (stage)}
											<tr class="border-b border-[var(--color-border)]/60 text-sophia-dark-text">
												<td class="px-3 py-2">{stage}</td>
												<td class="px-3 py-2 text-right tabular-nums">{n}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						</div>
					</div>
					<div class="mt-6 overflow-x-auto rounded-lg border border-[var(--color-border)]">
						<table class="w-full min-w-[720px] border-collapse text-left font-mono text-xs">
							<thead>
								<tr class="border-b border-[var(--color-border)] bg-black/15 text-sophia-dark-dim">
									<th class="px-3 py-2 font-normal">When</th>
									<th class="px-3 py-2 font-normal">Kind</th>
									<th class="px-3 py-2 font-normal">Stage</th>
									<th class="px-3 py-2 font-normal">Run</th>
									<th class="px-3 py-2 font-normal">URL</th>
									<th class="px-3 py-2 font-normal">Message</th>
									<th class="px-3 py-2 font-normal">Raw line</th>
								</tr>
							</thead>
							<tbody>
								{#each issuePipelineSignals.recent as row (row.runId + ':' + row.seq)}
									<tr class="border-b border-[var(--color-border)]/60 align-top text-sophia-dark-text">
										<td class="whitespace-nowrap px-3 py-2 text-sophia-dark-dim">
											{row.createdAt ?? '—'}
										</td>
										<td class="px-3 py-2">{row.kind}</td>
										<td class="max-w-[120px] px-3 py-2 break-words">{row.stageHint ?? '—'}</td>
										<td class="px-3 py-2">
											<button
												type="button"
												class="text-left text-sophia-dark-sage underline-offset-2 hover:underline"
												onclick={() => openChildRun(row.runId)}
											>
												{row.runId}
											</button>
										</td>
										<td class="max-w-[200px] px-3 py-2 break-all">{row.url ?? '—'}</td>
										<td class="max-w-[320px] px-3 py-2 break-words">{row.message}</td>
										<td class="max-w-[280px] px-3 py-2 break-words text-sophia-dark-dim">
											{row.rawLine?.trim() ? row.rawLine : '—'}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
				</div>
			</details>

			<p class="mt-4 text-sm text-sophia-dark-muted">
				Summary: total {job.summary?.total ?? '—'}, pending {job.summary?.pending ?? '—'}, running
				{job.summary?.running ?? '—'}, done {job.summary?.done ?? '—'}, error {job.summary?.error ?? '—'}, cancelled
				{job.summary?.cancelled ?? '—'}
			</p>

			{#if canStopEntireJob}
				<div class="mt-5 border-t border-[var(--color-border)] pt-5" role="region" aria-label="Stop entire job">
					<h2 class="font-serif text-lg text-sophia-dark-text">Stop entire job</h2>
					<p class="mt-2 text-sm text-sophia-dark-muted">
						Use this when a batch is failing repeatedly after a config change. No further URLs are launched from
						this job; pending rows are cancelled and in-flight child runs are marked abandoned in Neon so you can
						start a fresh job from the list page.
					</p>
					{#if cancelJobMessage}
						<p
							class="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
							role="status"
						>
							{cancelJobMessage}
						</p>
					{/if}
					<button
						type="button"
						class="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-lg border border-red-500/50 bg-red-500/15 px-5 py-3 font-mono text-sm font-medium text-red-100 transition hover:bg-red-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:cursor-not-allowed disabled:opacity-50"
						disabled={cancelJobBusy || retryBusy}
						onclick={() => void postCancelEntireJob()}
					>
						{cancelJobBusy ? 'Stopping…' : 'Stop entire job'}
					</button>
				</div>
			{/if}
			<p class="mt-2 text-sm text-sophia-dark-muted">
				Automatic retry: each URL may start up to <span class="font-mono text-sophia-dark-text">{itemMaxAttempts}</span>
				time(s) (server <code class="rounded bg-black/20 px-1 py-0.5 font-mono text-[11px]">INGEST_JOB_ITEM_MAX_ATTEMPTS</code>).
				Retryable failures return to <span class="font-mono text-xs text-sophia-dark-text">pending</span>; by default the
				same <span class="font-mono text-xs">child_run_id</span> is kept so the next tick calls checkpoint
				<span class="font-mono text-xs">resume</span> instead of redoing completed stages. Set
				<code class="rounded bg-black/20 px-1 py-0.5 font-mono text-[11px]">INGEST_JOB_AUTO_REQUEUE_CLEAR_CHILD_RUN_ID=1</code>
				to force a fresh run on each auto-retry.
			</p>
			{#if launchCapErrorCount > 0}
				<p
					class="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
					role="status"
				>
					{launchCapErrorCount} URL(s) failed with a concurrent worker cap. They are re-tried automatically when
					slots free (up to {itemMaxAttempts} attempts). Raise ADMIN_INGEST_MAX_CONCURRENT if the host allows.
				</p>
			{/if}
			{#if checkpointHelpVisible}
				<div
					class="mt-3 rounded-lg border border-[var(--color-border)] bg-black/15 px-4 py-3 text-sm text-sophia-dark-muted"
					role="status"
				>
					<p class="font-medium text-sophia-dark-text">Checkpoint / validation-only errors</p>
					<p class="mt-2 leading-relaxed">
						<code class="rounded bg-black/25 px-1 py-0.5 font-mono text-[11px]">--force-stage validating</code> and
						validation-only tails need Neon staging through
						<strong class="text-sophia-dark-text">embedding</strong> for this orchestration run id. If the URL never
						finished embedding under this id, run a
						<strong class="text-sophia-dark-text">full</strong> ingest first with
						<code class="rounded bg-black/25 px-1 py-0.5 font-mono text-[11px]">DATABASE_URL</code>, or set worker env
						<code class="rounded bg-black/25 px-1 py-0.5 font-mono text-[11px]">INGEST_FORCE_STAGE_MISSING_CHECKPOINT=full</code>
						(redo from extraction) or
						<code class="rounded bg-black/25 px-1 py-0.5 font-mono text-[11px]">=resume</code> (best partial, relaxes
						gates). Add these under job <strong class="text-sophia-dark-text">worker defaults</strong> / batch
						overrides when creating the job.
					</p>
				</div>
			{/if}
			{#if dlqItemCount > 0}
				<p class="mt-3 text-sm text-sophia-dark-muted" role="status">
					{dlqItemCount} URL(s) in <span class="font-mono text-xs text-sophia-dark-text">DLQ</span> (max attempts
					reached). Replay from
					<a href="/admin/ingest/jobs#dead-letter" class="text-sophia-dark-sage underline-offset-2 hover:underline"
						>all jobs · Dead letter</a
					>.
				</p>
			{/if}

			{#if failedCount > 0}
				<div class="mt-6 border-t border-[var(--color-border)] pt-5" role="region" aria-label="Retry failed URLs">
					<h2 class="font-serif text-lg text-sophia-dark-text">Failed items</h2>
					<p class="mt-2 text-sm text-sophia-dark-muted">
						<span class="font-medium text-sophia-dark-text">Restart all failed</span> re-queues
						<span class="font-medium text-sophia-dark-text">every</span> URL in
						<span class="font-mono text-sophia-dark-text">error</span> (including one-off failures before DLQ).
						<span class="font-medium text-sophia-dark-text">Restart DLQ only</span> targets rows that hit max
						attempts (dead-letter stamp). Use
						<a href="/admin/ingest/jobs#dead-letter" class="text-sophia-dark-sage underline-offset-2 hover:underline"
							>global DLQ replay</a
						>
						to re-queue selected URLs across jobs.
						<span class="font-medium text-sophia-dark-text">Resume checkpoints</span> continues runs that still
						have a child run id.
						<span class="font-medium text-sophia-dark-text">Queue again</span> moves one URL to
						<span class="font-mono text-sophia-dark-text">pending</span> without spending another attempt.
					</p>
					{#if retryMessage}
						<p class="mt-3 text-sm text-amber-100" role="status">{retryMessage}</p>
					{/if}
					{#if itemActionMessage}
						<p class="mt-3 text-sm text-red-200/90" role="alert">{itemActionMessage}</p>
					{/if}
					<div class="mt-4 flex flex-wrap gap-3">
						<button
							type="button"
							class="rounded-lg border border-[color-mix(in_srgb,var(--color-sage)_40%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-sage)_12%,var(--color-surface))] px-5 py-3 font-mono text-sm font-medium uppercase tracking-[0.08em] text-sophia-dark-text transition hover:border-[var(--color-sage)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)] disabled:cursor-not-allowed disabled:opacity-50"
							disabled={retryBusy}
							onclick={() => void postJobRetry('restart')}
						>
							{retryBusy ? 'Working…' : 'Restart all failed'}
						</button>
						<button
							type="button"
							class="rounded-lg border border-[color-mix(in_srgb,var(--color-sage)_35%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-sage)_8%,var(--color-surface))] px-5 py-3 font-mono text-sm font-medium uppercase tracking-[0.08em] text-sophia-dark-text transition hover:border-[var(--color-sage)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)] disabled:cursor-not-allowed disabled:opacity-50"
							disabled={retryBusy || dlqErrorCount === 0}
							onclick={() => void postJobRetry('restart', undefined, { onlyDlq: true })}
						>
							{retryBusy ? 'Working…' : 'Restart DLQ only'}
						</button>
						<button
							type="button"
							class="rounded-lg border border-[var(--color-border)] bg-transparent px-5 py-3 font-mono text-sm uppercase tracking-[0.08em] text-sophia-dark-muted transition hover:border-[var(--color-sage)] hover:text-sophia-dark-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)] disabled:cursor-not-allowed disabled:opacity-50"
							disabled={retryBusy || dlqErrorCount === 0}
							onclick={() => void postJobRetry('resume', undefined, { onlyDlq: true })}
						>
							Resume DLQ (with run id)
						</button>
						<button
							type="button"
							class="rounded-lg border border-[var(--color-border)] bg-transparent px-5 py-3 font-mono text-sm uppercase tracking-[0.08em] text-sophia-dark-muted transition hover:border-[var(--color-sage)] hover:text-sophia-dark-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)] disabled:cursor-not-allowed disabled:opacity-50"
							disabled={retryBusy}
							onclick={() => void postJobRetry('resume')}
						>
							Resume checkpoints (all failed with run id)
						</button>
					</div>
				</div>
			{/if}
		</header>

		<section class="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5" aria-labelledby="items-heading">
			<h2 id="items-heading" class="font-serif text-lg text-sophia-dark-text">URLs</h2>
			<p class="mt-2 text-xs text-sophia-dark-muted">
				Sorted: running → pending → errors → done (then URL).
			</p>
			<div class="mt-4 overflow-x-auto">
				<table class="w-full min-w-[720px] border-collapse text-left text-sm">
					<thead>
						<tr class="border-b border-[var(--color-border)] font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-dim">
							<th class="py-3 pr-3">URL</th>
							<th class="py-3 pr-3">Status</th>
							<th class="py-3 pr-3">Attempts</th>
							<th class="py-3 pr-3">Run</th>
							<th class="py-3 pr-3">Retry</th>
							<th class="py-3">Error</th>
						</tr>
					</thead>
					<tbody>
						{#each sortedJobItems as it (it.id)}
							<tr class="border-b border-[var(--color-border)]/60 align-top">
								<td class="max-w-[280px] py-3 pr-3 font-mono text-xs break-all">
									{it.url}
								</td>
								<td class="py-3 pr-3">
									{it.status}
									{#if it.dlqEnqueuedAt}
										<span
											class="ml-1 inline-block rounded bg-amber-500/20 px-1.5 font-mono text-[10px] uppercase tracking-wide text-amber-100"
											title="Dead letter (max attempts)"
										>
											DLQ
										</span>
									{/if}
								</td>
								<td class="py-3 pr-3 font-mono text-xs text-sophia-dark-muted">
									{typeof it.attempts === 'number' ? it.attempts : 0}/{itemMaxAttempts}
								</td>
								<td class="py-3 pr-3 font-mono text-xs">
									{#if it.childRunId}
										<button
											type="button"
											class="text-sophia-dark-sage underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)]"
											onclick={() => openChildRun(it.childRunId)}
										>
											{it.childRunId}
										</button>
									{:else}
										—
									{/if}
								</td>
								<td class="py-3 pr-3 align-top font-mono text-[11px]">
									{#if it.status === 'error'}
										<div class="flex flex-col gap-2">
											<button
												type="button"
												class="rounded border border-[var(--color-border)] px-3 py-2 text-left uppercase tracking-[0.06em] text-sophia-dark-muted hover:border-[var(--color-sage)] hover:text-sophia-dark-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)] disabled:opacity-50"
												disabled={retryBusy || itemActionBusyId === it.id}
												onclick={() => void postItemModify(it.id, 'requeue_to_pending')}
											>
												{itemActionBusyId === it.id ? '…' : 'Queue again'}
											</button>
											<button
												type="button"
												class="rounded border border-[var(--color-border)] px-3 py-2 text-left uppercase tracking-[0.06em] text-sophia-dark-muted hover:border-red-400/50 hover:text-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)] disabled:opacity-50"
												disabled={retryBusy || itemActionBusyId === it.id}
												onclick={() => void postItemModify(it.id, 'cancel')}
											>
												Cancel URL
											</button>
											<button
												type="button"
												class="rounded border border-[var(--color-border)] px-3 py-2 text-left uppercase tracking-[0.06em] text-sophia-dark-muted hover:border-[var(--color-sage)] hover:text-sophia-dark-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)] disabled:opacity-50"
												disabled={retryBusy || itemActionBusyId === it.id}
												onclick={() => void postJobRetry('restart', it.id)}
											>
												Restart
											</button>
											{#if it.childRunId}
												<button
													type="button"
													class="rounded border border-[var(--color-border)] px-3 py-2 text-left uppercase tracking-[0.06em] text-sophia-dark-muted hover:border-[var(--color-sage)] hover:text-sophia-dark-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)] disabled:opacity-50"
													disabled={retryBusy || itemActionBusyId === it.id}
													onclick={() => void postJobRetry('resume', it.id)}
												>
													Resume
												</button>
											{/if}
										</div>
									{:else if it.status === 'running'}
										<button
											type="button"
											class="rounded border border-[var(--color-border)] px-3 py-2 text-left uppercase tracking-[0.06em] text-sophia-dark-muted hover:border-red-400/50 hover:text-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)] disabled:opacity-50"
											disabled={retryBusy || itemActionBusyId === it.id}
											onclick={() => void postItemModify(it.id, 'cancel')}
										>
											{itemActionBusyId === it.id ? '…' : 'Stop run'}
										</button>
									{:else}
										—
									{/if}
								</td>
								<td class="py-3 font-mono text-xs text-red-200/90">{it.lastError ?? '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>

		<section class="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5" aria-labelledby="events-heading">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<h2 id="events-heading" class="font-serif text-lg text-sophia-dark-text">Timeline</h2>
				<p class="font-mono text-xs text-sophia-dark-muted">Append-only events (seq after reload)</p>
			</div>
			{#if events.length === 0}
				<p class="mt-4 text-sm text-sophia-dark-muted">No events yet.</p>
			{:else}
				<ol class="mt-4 max-h-[420px] space-y-2 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-black/15 p-3 font-mono text-xs">
					{#each events as ev (ev.seq)}
						<li class="border-b border-[var(--color-border)]/40 pb-2 last:border-0">
							<span class="text-sophia-dark-dim">#{ev.seq}</span>
							<span class="ml-2 text-sophia-dark-sage">{ev.eventType}</span>
							<span class="ml-2 text-sophia-dark-muted">
								{ev.createdAt ? new Date(ev.createdAt).toLocaleString() : ''}
							</span>
							{#if ev.payload && Object.keys(ev.payload).length > 0}
								<pre class="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-[11px] text-sophia-dark-muted">{JSON.stringify(
										ev.payload,
										null,
										2
									)}</pre>
							{/if}
						</li>
					{/each}
				</ol>
			{/if}
		</section>
	{/if}
</main>

<style>
	.job-detail-page {
		min-height: calc(100vh - var(--nav-height));
		padding: 20px;
		max-width: 1240px;
		margin: 0 auto;
		color: var(--color-text);
	}
</style>
