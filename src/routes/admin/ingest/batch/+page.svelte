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

	let queueRows = $state<QueueRow[]>([]);
	let queueStatusFilter = $state('all');
	let queueError = $state('');
	let queueLoading = $state(false);
	let selectedRows = $state<Record<string, boolean>>({});

	let sourcePacks = $state<SourcePack[]>([]);
	let selectedPackId = $state('stoa-primary-core');
	let urlsInput = $state('');
	let preview = $state<{ accepted: number; metadataOnly: number; blocked: number } | null>(null);
	let previewError = $state('');
	let queueSubmitMessage = $state('');

	let runLimit = $state(30);
	let runConcurrency = $state(2);
	let batchRuns = $state<BatchRun[]>([]);
	let runError = $state('');
	let activeRunId = $state('');
	let activeRun = $state<BatchRun | null>(null);
	let pollingTimer: ReturnType<typeof setInterval> | null = null;

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
					status_filter: 'approved',
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
		startPolling();
	}

	onMount(async () => {
		try {
			await Promise.all([loadPacks(), loadQueue(), loadRuns()]);
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
				<h2 class="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Source intake</h2>
				<div class="mt-3 flex flex-wrap gap-2">
					{#each sourcePacks as pack}
						<button type="button" class="admin-hub-action" onclick={() => setPack(pack.id)}>{pack.name}</button>
					{/each}
				</div>
				<textarea class="mt-3 w-full rounded border border-sophia-dark-border bg-sophia-dark-bg p-3 font-mono text-xs text-sophia-dark-text" rows="8" bind:value={urlsInput} />
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
				</div>
				{#if queueError}<p class="mt-2 font-mono text-xs text-sophia-dark-copper">{queueError}</p>{/if}
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
								<tr><th class="px-2 py-2">Status</th><th class="px-2 py-2">URL</th><th class="px-2 py-2">Run</th></tr>
							</thead>
							<tbody>
								{#each activeRun.items as item}
									<tr class="border-b border-sophia-dark-border/60 last:border-b-0">
										<td class="px-2 py-2">{item.status}</td>
										<td class="px-2 py-2 break-all">{item.url}</td>
										<td class="px-2 py-2">{item.childRunId ?? '—'}</td>
									</tr>
									{#if item.error}
										<tr class="border-b border-sophia-dark-border/30 last:border-b-0"><td class="px-2 py-1 text-sophia-dark-copper" colspan="3">{item.error}</td></tr>
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
	@media (max-width: 980px) { .batch-grid { grid-template-columns: 1fr; } }
</style>

