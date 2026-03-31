<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { getIdToken } from '$lib/authClient';

	type QueueRow = {
		id: string;
		canonical_url: string;
		hostname?: string;
		status?: string;
		last_error?: string | null;
		pass_hints?: string[];
		last_submitted_at?: string;
	};

	type SourcePack = { id: string; name: string; description: string; urls: string[] };
	type TraditionOption = { id: string; label: string };
	type RepositoryOption = { id: string; label: string };
	type SuggestedCandidate = {
		title: string;
		url: string;
		repository: string;
		licenseType: string;
		reuseMode: string;
	};

	type BatchItem = {
		queueRecordId: string;
		url: string;
		status: string;
		childRunId: string | null;
		error: string | null;
		licenseType: string;
		reuseMode: string;
		attempts: number;
	};

	type BatchRun = {
		id: string;
		status: string;
		createdAtMs: number;
		updatedAtMs: number;
		requestedByEmail: string | null;
		sourcePackId: string | null;
		concurrency: number;
		items: BatchItem[];
		summary: {
			total: number;
			pending: number;
			running: number;
			done: number;
			error: number;
			cancelled: number;
			skipped: number;
		};
	};

	type ChildStageStatus = 'idle' | 'running' | 'done' | 'error' | 'skipped';
	type ChildRunStatusSnapshot = {
		runId: string;
		status: string;
		currentStageKey: string | null;
		currentAction: string | null;
		lastFailureStageKey: string | null;
		resumable: boolean;
		error: string | null;
		issueCount: number;
		processAlive: boolean;
		idleForMs: number | null;
		stages: Record<string, { status?: ChildStageStatus; summary?: string }>;
	};

	const PIPELINE_STAGE_ORDER = ['fetch', 'extract', 'relate', 'group', 'embed', 'validate', 'store'] as const;
	const PIPELINE_STAGE_LABELS: Record<(typeof PIPELINE_STAGE_ORDER)[number], string> = {
		fetch: 'Fetch',
		extract: 'Extract',
		relate: 'Relate',
		group: 'Group',
		embed: 'Embed',
		validate: 'Validate',
		store: 'Store'
	};

	let queueRows = $state<QueueRow[]>([]);
	let queueStatusFilter = $state('all');
	let queueError = $state('');
	let queueOpsMessage = $state('');
	let queueLoading = $state(false);
	let selectedRows = $state<Record<string, boolean>>({});

	let sourcePacks = $state<SourcePack[]>([]);
	let selectedPackId = $state('stoa-primary-core');
	let urlsInput = $state('');
	let preview = $state<{ accepted: number; metadataOnly: number; blocked: number } | null>(null);
	let previewError = $state('');
	let queueSubmitMessage = $state('');
	let traditions = $state<TraditionOption[]>([]);
	let repositories = $state<RepositoryOption[]>([]);
	let selectedTradition = $state('stoicism');
	let sourceCount = $state(10);
	let selectedRepositories = $state<Record<string, boolean>>({});
	let suggestedCandidates = $state<SuggestedCandidate[]>([]);
	let suggestMessage = $state('');

	let runLimit = $state(30);
	let runConcurrency = $state(2);
	let runStatusFilter = $state<'approved' | 'pending_review' | 'queued' | 'failed'>('approved');
	let batchRuns = $state<BatchRun[]>([]);
	let runError = $state('');
	let activeRunId = $state('');
	let activeRun = $state<BatchRun | null>(null);
	let pollingTimer: ReturnType<typeof setInterval> | null = null;
	let childRunSnapshots = $state<Record<string, ChildRunStatusSnapshot>>({});

	async function authHeaders(): Promise<Record<string, string>> {
		const token = await getIdToken();
		if (!token) throw new Error('Authentication required');
		return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
	}

	function parseUrls(input: string): string[] {
		return Array.from(new Set(input.split(/\r?\n|,|;/).map((u) => u.trim()).filter(Boolean)));
	}

	function setPack(packId: string): void {
		selectedPackId = packId;
		const pack = sourcePacks.find((p) => p.id === packId);
		if (pack) urlsInput = pack.urls.join('\n');
	}

	async function loadPacks(): Promise<void> {
		const res = await fetch('/api/admin/ingest/batch/source-packs', { headers: await authHeaders() });
		const body = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Failed to load packs');
		sourcePacks = Array.isArray(body?.packs) ? (body.packs as SourcePack[]) : [];
		if (!urlsInput && sourcePacks.length > 0) {
			setPack(sourcePacks[0]?.id ?? '');
		}
	}

	async function loadWizardOptions(): Promise<void> {
		const res = await fetch('/api/admin/ingest/batch/suggest', { headers: await authHeaders() });
		const body = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Failed to load wizard options');
		traditions = Array.isArray(body?.traditions) ? (body.traditions as TraditionOption[]) : [];
		repositories = Array.isArray(body?.repositories) ? (body.repositories as RepositoryOption[]) : [];
		const initialRepos: Record<string, boolean> = {};
		for (const repo of repositories) initialRepos[repo.id] = true;
		selectedRepositories = initialRepos;
		if (!selectedTradition && traditions.length > 0) selectedTradition = traditions[0]?.id ?? 'stoicism';
	}

	function selectedRepositoryIds(): string[] {
		return Object.entries(selectedRepositories)
			.filter(([, checked]) => checked)
			.map(([id]) => id);
	}

	async function scanSuggestedSources(): Promise<void> {
		suggestMessage = '';
		suggestedCandidates = [];
		try {
			const repos = selectedRepositoryIds();
			if (repos.length === 0) throw new Error('Select at least one canonical repository.');
			const res = await fetch('/api/admin/ingest/batch/suggest', {
				method: 'POST',
				headers: await authHeaders(),
				body: JSON.stringify({
					tradition: selectedTradition,
					count: sourceCount,
					repositories: repos
				})
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Scan failed');
			const urls = Array.isArray(body?.urls) ? (body.urls as string[]) : [];
			suggestedCandidates = Array.isArray(body?.candidates) ? (body.candidates as SuggestedCandidate[]) : [];
			urlsInput = urls.join('\n');
			preview = null;
			queueSubmitMessage = '';
			suggestMessage = `Scanned ${urls.length} open-license sources for ${selectedTradition}.`;
		} catch (error) {
			suggestMessage = error instanceof Error ? error.message : 'Scan failed';
		}
	}

	async function loadQueue(): Promise<void> {
		queueLoading = true;
		queueError = '';
		try {
			const params = new URLSearchParams();
			params.set('status', queueStatusFilter);
			params.set('limit', '200');
			const res = await fetch(`/api/admin/ingest/batch/queue?${params.toString()}`, {
				headers: await authHeaders()
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Failed to load queue');
			queueRows = Array.isArray(body?.rows) ? (body.rows as QueueRow[]) : [];
		} catch (error) {
			queueError = error instanceof Error ? error.message : 'Failed to load queue';
			queueRows = [];
		} finally {
			queueLoading = false;
		}
	}

	async function resetHistoricFailedQueue(): Promise<void> {
		queueOpsMessage = '';
		queueError = '';
		try {
			const res = await fetch('/api/admin/ingest/batch/queue/reset-failed', {
				method: 'POST',
				headers: await authHeaders(),
				body: JSON.stringify({ limit: 5000 })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Failed to reset failed rows');
			const updated = typeof body?.updated === 'number' ? body.updated : 0;
			queueOpsMessage = `Reset ${updated} failed queue rows back to approved.`;
			await loadQueue();
		} catch (error) {
			queueError = error instanceof Error ? error.message : 'Failed to reset failed rows';
		}
	}

	async function previewPolicies(): Promise<void> {
		previewError = '';
		preview = null;
		try {
			const urls = parseUrls(urlsInput);
			if (urls.length === 0) throw new Error('Enter URLs first.');
			const res = await fetch('/api/admin/ingest/batch/queue', {
				method: 'POST',
				headers: await authHeaders(),
				body: JSON.stringify({ urls, preview_only: true })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Policy preview failed');
			preview = {
				accepted: typeof body.accepted === 'number' ? body.accepted : 0,
				metadataOnly: typeof body.metadataOnly === 'number' ? body.metadataOnly : 0,
				blocked: typeof body.blocked === 'number' ? body.blocked : 0
			};
		} catch (error) {
			previewError = error instanceof Error ? error.message : 'Policy preview failed';
		}
	}

	async function queueUrls(): Promise<void> {
		queueSubmitMessage = '';
		try {
			const urls = parseUrls(urlsInput);
			if (urls.length === 0) throw new Error('Enter URLs first.');
			const res = await fetch('/api/admin/ingest/batch/queue', {
				method: 'POST',
				headers: await authHeaders(),
				body: JSON.stringify({ urls, source_pack_id: selectedPackId })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Queue request failed');
			const queuedCount = Array.isArray(body?.queued) ? body.queued.length : 0;
			const rejectedCount = Array.isArray(body?.rejected) ? body.rejected.length : 0;
			queueSubmitMessage = `Queued ${queuedCount}. Rejected ${rejectedCount}.`;
			await loadQueue();
		} catch (error) {
			queueSubmitMessage = error instanceof Error ? error.message : 'Queue request failed';
		}
	}

	function selectedIds(): string[] {
		return Object.entries(selectedRows)
			.filter(([, selected]) => selected)
			.map(([id]) => id);
	}

	function stageGlyph(status: ChildStageStatus | undefined): string {
		if (status === 'done') return '✓';
		if (status === 'running') return '●';
		if (status === 'error') return '!';
		if (status === 'skipped') return '—';
		return '○';
	}

	function stageStatusLabel(status: ChildStageStatus | undefined): string {
		if (status === 'done') return 'done';
		if (status === 'running') return 'running';
		if (status === 'error') return 'error';
		if (status === 'skipped') return 'skipped';
		return 'idle';
	}

	function stageName(key: string | null): string {
		if (!key) return '—';
		if (key in PIPELINE_STAGE_LABELS) {
			return PIPELINE_STAGE_LABELS[key as keyof typeof PIPELINE_STAGE_LABELS];
		}
		return key;
	}

	function formatDuration(ms: number | null): string {
		if (ms == null || ms < 0) return '—';
		if (ms < 1000) return `${ms}ms`;
		const sec = Math.floor(ms / 1000);
		if (sec < 60) return `${sec}s`;
		const min = Math.floor(sec / 60);
		const rem = sec % 60;
		return `${min}m ${rem}s`;
	}

	function itemResumeReadiness(item: BatchItem, snapshot: ChildRunStatusSnapshot | undefined): 'checkpoint' | 'fallback' | null {
		if (item.status !== 'cancelled' && item.status !== 'error') return null;
		return snapshot?.resumable === true ? 'checkpoint' : 'fallback';
	}

	function openChildRunInExpand(runId: string): void {
		const params = new URLSearchParams();
		params.set('runId', runId);
		params.set('monitor', '1');
		window.location.href = `/admin/ingest?${params.toString()}`;
	}

	function viewChildRunReport(runId: string): void {
		const params = new URLSearchParams();
		params.set('reportRunId', runId);
		window.location.href = `/admin/ingest?${params.toString()}`;
	}

	async function cancelBatchItemRun(queueRecordId: string): Promise<void> {
		if (!activeRunId) return;
		runError = '';
		try {
			const res = await fetch(`/api/admin/ingest/batch/run/${activeRunId}/item/cancel`, {
				method: 'POST',
				headers: await authHeaders(),
				body: JSON.stringify({ queue_record_id: queueRecordId })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Cancel item failed');
			activeRun = body.run as BatchRun;
			await refreshChildRunSnapshots();
			await loadRuns();
		} catch (error) {
			runError = error instanceof Error ? error.message : 'Cancel item failed';
		}
	}

	async function resumeBatchItemRun(queueRecordId: string): Promise<void> {
		if (!activeRunId) return;
		runError = '';
		try {
			const res = await fetch(`/api/admin/ingest/batch/run/${activeRunId}/item/resume`, {
				method: 'POST',
				headers: await authHeaders(),
				body: JSON.stringify({ queue_record_id: queueRecordId })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Resume item failed');
			activeRun = body.run as BatchRun;
			startPolling();
			await refreshChildRunSnapshots();
			await loadRuns();
		} catch (error) {
			runError = error instanceof Error ? error.message : 'Resume item failed';
		}
	}

	async function refreshChildRunSnapshots(): Promise<void> {
		try {
			if (!activeRun) return;
			const runIds = Array.from(
				new Set(
					activeRun.items
						.map((item) => item.childRunId)
						.filter((id): id is string => typeof id === 'string' && id.length > 0)
				)
			);
			if (runIds.length === 0) {
				childRunSnapshots = {};
				return;
			}
			const headers = await authHeaders();
			const results = await Promise.all(
				runIds.map(async (id) => {
					try {
						const res = await fetch(`/api/admin/ingest/run/${id}/status`, { headers });
						const body = await res.json().catch(() => ({}));
						if (res.ok) {
							return [
								id,
								{
									runId: id,
									status: typeof body?.status === 'string' ? body.status : 'running',
									currentStageKey: typeof body?.currentStageKey === 'string' ? body.currentStageKey : null,
									currentAction: typeof body?.currentAction === 'string' ? body.currentAction : null,
									lastFailureStageKey:
										typeof body?.lastFailureStageKey === 'string' ? body.lastFailureStageKey : null,
									resumable: body?.resumable === true,
									error: typeof body?.error === 'string' ? body.error : null,
									issueCount: typeof body?.issueCount === 'number' ? body.issueCount : 0,
									processAlive: Boolean(body?.processAlive),
									idleForMs: typeof body?.idleForMs === 'number' ? body.idleForMs : null,
									stages:
										body?.stages && typeof body.stages === 'object'
											? (body.stages as ChildRunStatusSnapshot['stages'])
											: {}
								} satisfies ChildRunStatusSnapshot
							] as const;
						}
						// Not in-memory on this instance; fall back to durable Firestore/Neon report.
						const reportRes = await fetch(`/api/admin/ingest/reports/${id}`, { headers });
						const reportBody = await reportRes.json().catch(() => ({}));
						if (reportRes.ok) {
							const reportStatus = typeof reportBody?.status === 'string' ? reportBody.status : 'done';
							const lastFailureStageKey =
								typeof reportBody?.lastFailureStageKey === 'string' ? reportBody.lastFailureStageKey : null;
							const terminalError =
								typeof reportBody?.terminalError === 'string' ? reportBody.terminalError : null;
							const completedStage =
								reportStatus === 'done' ? 'store' : lastFailureStageKey ?? null;
							return [
								id,
								{
									runId: id,
									status: reportStatus,
									currentStageKey: completedStage,
									currentAction: reportStatus === 'done' ? 'Completed (durable report)' : 'Completed with issues (durable report)',
									lastFailureStageKey,
									resumable: false,
									error: terminalError,
									issueCount: typeof reportBody?.issueCount === 'number' ? reportBody.issueCount : 0,
									processAlive: false,
									idleForMs: null,
									stages: {}
								} satisfies ChildRunStatusSnapshot
							] as const;
						}
						return [
							id,
							{
								runId: id,
								status: 'error',
								currentStageKey: null,
								currentAction: null,
								lastFailureStageKey: null,
								resumable: false,
								error:
									typeof body?.error === 'string'
										? body.error
										: typeof reportBody?.error === 'string'
											? reportBody.error
											: 'Failed to load child run status',
								issueCount: 0,
								processAlive: false,
								idleForMs: null,
								stages: {}
							} satisfies ChildRunStatusSnapshot
						] as const;
					} catch (error) {
						return [
							id,
							{
								runId: id,
								status: 'error',
								currentStageKey: null,
								currentAction: null,
								lastFailureStageKey: null,
								resumable: false,
								error: error instanceof Error ? error.message : 'Failed to load child run status',
								issueCount: 0,
								processAlive: false,
								idleForMs: null,
								stages: {}
							} satisfies ChildRunStatusSnapshot
						] as const;
					}
				})
			);
			childRunSnapshots = Object.fromEntries(results);
		} catch (error) {
			runError = error instanceof Error ? error.message : 'Failed to refresh child run status';
		}
	}

	async function bulkAction(action: 'approve' | 'reject'): Promise<void> {
		const ids = selectedIds();
		if (ids.length === 0) return;
		const endpoint = action === 'approve' ? 'approve' : 'reject';
		const res = await fetch(`/api/admin/ingest/batch/queue/${endpoint}`, {
			method: 'POST',
			headers: await authHeaders(),
			body: JSON.stringify({
				record_ids: ids,
				reason: action === 'reject' ? 'manual_batch_reject' : undefined
			})
		});
		const body = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : `Failed to ${action}`);
		selectedRows = {};
		await loadQueue();
	}

	async function loadRuns(): Promise<void> {
		const res = await fetch('/api/admin/ingest/batch/run?limit=40', { headers: await authHeaders() });
		const body = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Failed to load runs');
		batchRuns = Array.isArray(body?.runs) ? (body.runs as BatchRun[]) : [];
	}

	async function startBatchRun(): Promise<void> {
		runError = '';
		try {
			const res = await fetch('/api/admin/ingest/batch/run', {
				method: 'POST',
				headers: await authHeaders(),
				body: JSON.stringify({
					concurrency: runConcurrency,
					limit: runLimit,
					status_filter: runStatusFilter,
					source_pack_id: selectedPackId
				})
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Failed to start batch run');
			activeRun = body.run as BatchRun;
			activeRunId = activeRun?.id ?? '';
			await loadRuns();
			startPolling();
		} catch (error) {
			runError = error instanceof Error ? error.message : 'Failed to start batch run';
		}
	}

	async function pollActiveRun(): Promise<void> {
		if (!activeRunId) return;
		const res = await fetch(`/api/admin/ingest/batch/run/${activeRunId}/status`, {
			headers: await authHeaders()
		});
		const body = await res.json().catch(() => ({}));
		if (!res.ok) {
			runError = typeof body?.error === 'string' ? body.error : 'Run status failed';
			return;
		}
		activeRun = body.run as BatchRun;
		await refreshChildRunSnapshots();
		await loadRuns();
		if (activeRun && ['done', 'error', 'cancelled'].includes(activeRun.status)) {
			stopPolling();
		}
	}

	function startPolling(): void {
		stopPolling();
		if (!activeRunId) return;
		pollingTimer = setInterval(() => void pollActiveRun(), 2500);
		void pollActiveRun();
	}

	function stopPolling(): void {
		if (pollingTimer) clearInterval(pollingTimer);
		pollingTimer = null;
	}

	async function cancelActiveRun(): Promise<void> {
		if (!activeRunId) return;
		const res = await fetch(`/api/admin/ingest/batch/run/${activeRunId}/cancel`, {
			method: 'POST',
			headers: await authHeaders()
		});
		const body = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Cancel failed');
		activeRun = body.run as BatchRun;
		await loadRuns();
	}

	async function resumeActiveRun(): Promise<void> {
		if (!activeRunId) return;
		const res = await fetch(`/api/admin/ingest/batch/run/${activeRunId}/resume`, {
			method: 'POST',
			headers: await authHeaders()
		});
		const body = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Resume failed');
		activeRun = body.run as BatchRun;
		startPolling();
		await loadRuns();
	}

	function selectRun(run: BatchRun): void {
		activeRunId = run.id;
		activeRun = run;
		void refreshChildRunSnapshots();
		startPolling();
	}

	onMount(async () => {
		try {
			await Promise.all([loadPacks(), loadWizardOptions(), loadQueue(), loadRuns()]);
			const params = new URLSearchParams(window.location.search);
			const initialRunId = params.get('runId')?.trim() ?? '';
			if (initialRunId) {
				const existing = batchRuns.find((run) => run.id === initialRunId) ?? null;
				if (existing) {
					selectRun(existing);
				} else {
					activeRunId = initialRunId;
					startPolling();
				}
			}
		} catch (error) {
			runError = error instanceof Error ? error.message : 'Failed to initialize';
		}
	});
	onDestroy(stopPolling);
</script>

<svelte:head>
	<title>STOA batch ingestion — Admin</title>
</svelte:head>

<main class="batch-page">
	<header class="batch-hero">
		<p class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-dim">Admin</p>
		<div class="mt-2 flex flex-wrap items-start justify-between gap-4">
			<div>
				<h1 class="font-serif text-3xl text-sophia-dark-text sm:text-[2.1rem]">STOA batch ingestion</h1>
				<p class="mt-2 max-w-3xl text-sm leading-6 text-sophia-dark-muted">
					Queue, review, and execute strict-open STOA source batches with live progress and retry controls.
				</p>
			</div>
			<nav class="flex flex-wrap items-center gap-2" aria-label="Admin shortcuts">
				<a href="/admin" class="admin-hub-action">Admin home</a>
				<a href="/admin/ingest" class="admin-hub-action">Expand</a>
				<a href="/admin/ingest/runs" class="admin-hub-action">All runs</a>
			</nav>
		</div>
	</header>

	<section class="batch-grid">
		<div class="expand-card">
			<div class="expand-card-inner">
				<h2 class="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Batch wizard</h2>
				<p class="mt-2 text-sm text-sophia-dark-muted">
					Step 1: choose tradition, source count, and canonical repositories. Scan returns only open-license sources.
				</p>
				<div class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
					<label class="font-mono text-xs text-sophia-dark-muted">
						Tradition
						<select bind:value={selectedTradition} class="mt-1 w-full rounded border border-sophia-dark-border bg-sophia-dark-bg p-2">
							{#each traditions as t}
								<option value={t.id}>{t.label}</option>
							{/each}
						</select>
					</label>
					<label class="font-mono text-xs text-sophia-dark-muted">
						Source count
						<select bind:value={sourceCount} class="mt-1 w-full rounded border border-sophia-dark-border bg-sophia-dark-bg p-2">
							<option value={5}>5</option>
							<option value={10}>10</option>
							<option value={15}>15</option>
							<option value={20}>20</option>
							<option value={25}>25</option>
							<option value={30}>30</option>
						</select>
					</label>
					<div class="font-mono text-xs text-sophia-dark-muted">
						Canonical repositories
						<div class="mt-1 grid grid-cols-1 gap-1 rounded border border-sophia-dark-border bg-sophia-dark-bg p-2">
							{#each repositories as repo}
								<label class="flex items-center gap-2">
									<input type="checkbox" bind:checked={selectedRepositories[repo.id]} />
									<span>{repo.label}</span>
								</label>
							{/each}
						</div>
					</div>
				</div>
				<div class="mt-3 flex flex-wrap gap-2">
					<button type="button" class="admin-hub-action" onclick={() => void scanSuggestedSources()}>Scan suitable sources</button>
				</div>
				{#if suggestMessage}<p class="mt-2 font-mono text-xs text-sophia-dark-muted">{suggestMessage}</p>{/if}

				<p class="mt-4 text-sm text-sophia-dark-muted">
					Step 2: optional source-pack quick presets.
				</p>
				<div class="mt-2 flex flex-wrap gap-2">
					{#each sourcePacks as pack}
						<button type="button" class="admin-hub-action" onclick={() => setPack(pack.id)}>{pack.name}</button>
					{/each}
				</div>

				{#if suggestedCandidates.length > 0}
					<div class="mt-3 max-h-[10rem] overflow-auto rounded border border-sophia-dark-border bg-sophia-dark-bg/40 p-2">
						<ul class="space-y-1 font-mono text-[0.7rem] text-sophia-dark-muted">
							{#each suggestedCandidates as c}
								<li>
									<span class="text-sophia-dark-text">{c.title}</span>
									<span class="text-sophia-dark-dim"> — {c.repository} · {c.licenseType} · {c.reuseMode}</span>
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				<p class="mt-4 text-sm text-sophia-dark-muted">
					Step 3: preview policy, queue URLs, then use Queue review + Batch run cards below.
				</p>
				<textarea class="mt-3 w-full rounded border border-sophia-dark-border bg-sophia-dark-bg p-3 font-mono text-xs text-sophia-dark-text" rows="8" bind:value={urlsInput}></textarea>
				<div class="mt-3 flex flex-wrap gap-2">
					<button type="button" class="admin-hub-action" onclick={() => void previewPolicies()}>Policy preview</button>
					<button type="button" class="admin-hub-action" onclick={() => void queueUrls()}>Queue URLs</button>
				</div>
				{#if preview}
					<p class="mt-2 font-mono text-xs text-sophia-dark-muted">
						Accepted(full text): {preview.accepted} · Metadata-only: {preview.metadataOnly} · Blocked: {preview.blocked}
					</p>
				{/if}
				{#if previewError}<p class="mt-2 font-mono text-xs text-sophia-dark-copper">{previewError}</p>{/if}
				{#if queueSubmitMessage}<p class="mt-2 font-mono text-xs text-sophia-dark-muted">{queueSubmitMessage}</p>{/if}
			</div>
		</div>

		<div class="expand-card">
			<div class="expand-card-inner">
				<h2 class="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Queue review</h2>
				<div class="mt-3 flex flex-wrap items-center gap-2">
					<select bind:value={queueStatusFilter} class="rounded border border-sophia-dark-border bg-sophia-dark-bg p-2 font-mono text-xs" onchange={() => void loadQueue()}>
						<option value="all">all</option>
						<option value="approved">approved</option>
						<option value="pending_review">pending_review</option>
						<option value="queued">queued</option>
						<option value="ingesting">ingesting</option>
						<option value="failed">failed</option>
						<option value="rejected">rejected</option>
					</select>
					<button type="button" class="admin-hub-action" onclick={() => void bulkAction('approve')}>Approve selected</button>
					<button type="button" class="admin-hub-action" onclick={() => void bulkAction('reject')}>Reject selected</button>
					<button type="button" class="admin-hub-action" onclick={() => void resetHistoricFailedQueue()}>
						Reset historic failed
					</button>
				</div>
				{#if queueError}<p class="mt-2 font-mono text-xs text-sophia-dark-copper">{queueError}</p>{/if}
				{#if queueOpsMessage}<p class="mt-2 font-mono text-xs text-sophia-dark-muted">{queueOpsMessage}</p>{/if}
				<div class="mt-3 max-h-[18rem] overflow-auto rounded border border-sophia-dark-border">
					<table class="min-w-full text-left font-mono text-xs text-sophia-dark-muted">
						<thead class="border-b border-sophia-dark-border bg-sophia-dark-bg/50 text-sophia-dark-dim">
							<tr>
								<th class="px-2 py-2"></th>
								<th class="px-2 py-2">Status</th>
								<th class="px-2 py-2">URL</th>
							</tr>
						</thead>
						<tbody>
							{#each queueRows as row}
								<tr class="border-b border-sophia-dark-border/60 last:border-b-0">
									<td class="px-2 py-2 align-top">
										<input type="checkbox" bind:checked={selectedRows[row.id]} />
									</td>
									<td class="px-2 py-2 align-top">{row.status}</td>
									<td class="px-2 py-2 align-top break-all">{row.canonical_url}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				{#if queueLoading}<p class="mt-2 text-xs text-sophia-dark-muted">Loading queue…</p>{/if}
			</div>
		</div>

		<div class="expand-card">
			<div class="expand-card-inner">
				<h2 class="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Batch run</h2>
				<div class="mt-3 grid grid-cols-2 gap-2">
					<label class="font-mono text-xs text-sophia-dark-muted">Concurrency <input class="mt-1 w-full rounded border border-sophia-dark-border bg-sophia-dark-bg p-2" type="number" min="1" max="8" bind:value={runConcurrency} /></label>
					<label class="font-mono text-xs text-sophia-dark-muted">Limit <input class="mt-1 w-full rounded border border-sophia-dark-border bg-sophia-dark-bg p-2" type="number" min="1" max="200" bind:value={runLimit} /></label>
				</div>
				<label class="mt-3 block font-mono text-xs text-sophia-dark-muted">
					Source status
					<select bind:value={runStatusFilter} class="mt-1 w-full rounded border border-sophia-dark-border bg-sophia-dark-bg p-2">
						<option value="approved">approved</option>
						<option value="failed">failed (retry historic)</option>
						<option value="pending_review">pending_review</option>
						<option value="queued">queued</option>
					</select>
				</label>
				<div class="mt-3 flex flex-wrap gap-2">
					<button type="button" class="admin-hub-action" onclick={() => void startBatchRun()}>Start batch run</button>
					<button type="button" class="admin-hub-action" onclick={() => void cancelActiveRun()} disabled={!activeRunId}>Cancel active</button>
					<button type="button" class="admin-hub-action" onclick={() => void resumeActiveRun()} disabled={!activeRunId}>Resume active</button>
				</div>
				{#if runError}<p class="mt-2 font-mono text-xs text-sophia-dark-copper">{runError}</p>{/if}
				<div class="mt-3 max-h-[14rem] overflow-auto rounded border border-sophia-dark-border">
					<table class="min-w-full text-left font-mono text-xs text-sophia-dark-muted">
						<thead class="border-b border-sophia-dark-border bg-sophia-dark-bg/50 text-sophia-dark-dim">
							<tr><th class="px-2 py-2">Run</th><th class="px-2 py-2">Status</th><th class="px-2 py-2">Summary</th></tr>
						</thead>
						<tbody>
							{#each batchRuns as run}
								<tr class="cursor-pointer border-b border-sophia-dark-border/60 last:border-b-0" onclick={() => selectRun(run)}>
									<td class="px-2 py-2">{run.id}</td>
									<td class="px-2 py-2">{run.status}</td>
									<td class="px-2 py-2">t:{run.summary.total} d:{run.summary.done} e:{run.summary.error} r:{run.summary.running}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		</div>

		<div class="expand-card">
			<div class="expand-card-inner">
				<h2 class="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Active monitor</h2>
				{#if !activeRun}
					<p class="mt-3 text-sm text-sophia-dark-muted">Select or start a batch run.</p>
				{:else}
					<p class="mt-2 font-mono text-xs text-sophia-dark-muted">
						{activeRun.id} · {activeRun.status} · pending {activeRun.summary.pending} · running {activeRun.summary.running} · done {activeRun.summary.done} · error {activeRun.summary.error}
					</p>
					<div class="mt-3 max-h-[14rem] overflow-auto rounded border border-sophia-dark-border">
						<table class="min-w-full text-left font-mono text-xs text-sophia-dark-muted">
							<thead class="border-b border-sophia-dark-border bg-sophia-dark-bg/50 text-sophia-dark-dim">
								<tr>
									<th class="px-2 py-2">Status</th>
									<th class="px-2 py-2">URL</th>
									<th class="px-2 py-2">Run</th>
									<th class="px-2 py-2">Pipeline</th>
									<th class="px-2 py-2">Actions</th>
								</tr>
							</thead>
							<tbody>
								{#each activeRun.items as item}
									{@const childRunId = item.childRunId}
									{@const resumeReadiness = itemResumeReadiness(item, childRunId ? childRunSnapshots[childRunId] : undefined)}
									<tr class="border-b border-sophia-dark-border/60 last:border-b-0">
										<td class="px-2 py-2">
											<div>{item.status}</div>
											{#if resumeReadiness}
												<span
													class="resume-readiness-badge {resumeReadiness === 'checkpoint'
														? 'resume-readiness-badge--checkpoint'
														: 'resume-readiness-badge--fallback'}"
													title={resumeReadiness === 'checkpoint'
														? 'Resume item will continue from checkpoint.'
														: 'Resume item will relaunch from queue.'}
												>
													{resumeReadiness === 'checkpoint' ? 'checkpoint-resume' : 'fallback-relaunch'}
												</span>
											{/if}
										</td>
										<td class="px-2 py-2 break-all">{item.url}</td>
										<td class="px-2 py-2">
											{#if childRunId}
												<div>{childRunId}</div>
												<div class="mt-1 flex flex-wrap gap-2">
													<button type="button" class="text-[0.65rem] text-sophia-dark-sage underline" onclick={() => openChildRunInExpand(childRunId)}>Open in Expand</button>
													<button type="button" class="text-[0.65rem] text-sophia-dark-muted underline" onclick={() => viewChildRunReport(childRunId)}>View report</button>
												</div>
											{:else}
												—
											{/if}
										</td>
										<td class="px-2 py-2">
											{#if childRunId && childRunSnapshots[childRunId]}
												{@const snap = childRunSnapshots[childRunId]}
												<div class="text-sophia-dark-text">
													{stageName(snap.currentStageKey)}
													<span class="text-sophia-dark-dim"> · {snap.processAlive ? 'live' : snap.status}</span>
												</div>
												<div class="mt-1 text-[0.65rem] text-sophia-dark-dim">
													{snap.currentAction ?? 'Waiting for next event…'}
												</div>
												<div class="mt-1 text-[0.65rem] text-sophia-dark-dim">
													issues {snap.issueCount} · idle {formatDuration(snap.idleForMs)}
												</div>
												<div class="mt-1 flex flex-wrap gap-1">
													{#each PIPELINE_STAGE_ORDER as stageKey}
														{@const status = snap.stages?.[stageKey]?.status}
														<span
															class="inline-flex items-center gap-1 rounded border border-sophia-dark-border/70 px-1.5 py-0.5 text-[0.6rem] text-sophia-dark-dim"
															title={`${PIPELINE_STAGE_LABELS[stageKey]}: ${stageStatusLabel(status)}`}
														>
															<span>{stageGlyph(status)}</span>
															<span>{PIPELINE_STAGE_LABELS[stageKey]}</span>
														</span>
													{/each}
												</div>
												{#if snap.error}
													<div class="mt-1 text-[0.65rem] text-sophia-dark-copper">{snap.error}</div>
												{/if}
											{:else if childRunId}
												<span class="text-sophia-dark-dim">Loading run telemetry…</span>
											{:else}
												<span class="text-sophia-dark-dim">No child run yet.</span>
											{/if}
										</td>
										<td class="px-2 py-2">
											<div class="flex flex-wrap gap-2">
												{#if item.status === 'running' || item.status === 'launching' || item.status === 'pending'}
													<button
														type="button"
														class="text-[0.65rem] text-sophia-dark-copper underline"
														onclick={() => void cancelBatchItemRun(item.queueRecordId)}
													>
														Cancel item
													</button>
												{/if}
												{#if item.status === 'cancelled' || item.status === 'error'}
													<button
														type="button"
														class="text-[0.65rem] text-sophia-dark-amber underline"
														onclick={() => void resumeBatchItemRun(item.queueRecordId)}
													>
														Resume item
													</button>
												{/if}
											</div>
										</td>
									</tr>
									{#if item.error}
										<tr class="border-b border-sophia-dark-border/30 last:border-b-0"><td class="px-2 py-1 text-sophia-dark-copper" colspan="5">{item.error}</td></tr>
									{/if}
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>
		</div>
	</section>
</main>

<style>
	.batch-page { min-height: calc(100vh - var(--nav-height)); padding: 20px; max-width: 1320px; margin: 0 auto; color: var(--color-text); }
	.batch-hero { border: 1px solid var(--color-border); background: linear-gradient(130deg, rgba(127, 163, 131, 0.2), rgba(44, 96, 142, 0.14)); border-radius: 12px; padding: 20px; }
	.batch-grid { margin-top: 24px; display: grid; gap: 16px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.expand-card { border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-surface); }
	.expand-card-inner { padding: 20px; }
	.resume-readiness-badge {
		display: inline-flex;
		align-items: center;
		margin-top: 4px;
		padding: 1px 6px;
		border-radius: 999px;
		border: 1px solid var(--color-border);
		font-size: 0.58rem;
		line-height: 1.15;
		letter-spacing: 0.02em;
		text-transform: lowercase;
		white-space: nowrap;
	}
	.resume-readiness-badge--checkpoint {
		color: var(--color-sage, #7fa383);
		background: color-mix(in srgb, var(--color-sage, #7fa383) 13%, transparent);
		border-color: color-mix(in srgb, var(--color-sage, #7fa383) 35%, var(--color-border));
	}
	.resume-readiness-badge--fallback {
		color: var(--color-copper, #b87333);
		background: color-mix(in srgb, var(--color-copper, #b87333) 12%, transparent);
		border-color: color-mix(in srgb, var(--color-copper, #b87333) 35%, var(--color-border));
	}
	@media (max-width: 980px) { .batch-grid { grid-template-columns: 1fr; } }
</style>

