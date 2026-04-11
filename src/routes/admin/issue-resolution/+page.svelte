<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import QuarantineReview from '$lib/components/admin/QuarantineReview.svelte';
	import { getIdToken } from '$lib/authClient';

	type DimBucket = { dim: number | null; count: number };
	type Inventory = {
		targetDim: number;
		noneCount: number;
		dimBuckets: DimBucket[];
		needsWorkCount: number;
		perSourceNonTarget: { sourceId: string; count: number }[];
	};

	type ReembedJob = {
		id: string;
		status: string;
		stage: string;
		targetDim: number;
		processedCount: number;
		totalCount: number | null;
		batchSize: number;
		lastError: string | null;
		createdAt?: string;
		updatedAt?: string;
		completedAt?: string | null;
	};

	type ReembedEvent = {
		seq: number;
		eventType: string;
		payload: Record<string, unknown> | null;
		createdAt?: string;
	};

	let tab = $state<'embedding' | 'quarantine'>('embedding');
	let inventory = $state<Inventory | null>(null);
	let inventoryError = $state('');
	let inventoryLoading = $state(true);

	let jobs = $state<ReembedJob[]>([]);
	let activeJob = $state<ReembedJob | null>(null);
	let events = $state<ReembedEvent[]>([]);
	let embedError = $state('');
	let neonDisabled = $state(false);
	let startBusy = $state(false);
	let cancelBusy = $state(false);
	let tickBusy = $state(false);
	let batchSizeInput = $state(50);

	let pollTimer: ReturnType<typeof setInterval> | null = null;

	function syncTabFromUrl(): void {
		const t = page.url.searchParams.get('tab');
		if (t === 'quarantine') tab = 'quarantine';
		else tab = 'embedding';
	}

	async function authHeaders(): Promise<Record<string, string>> {
		const token = await getIdToken();
		if (!token) throw new Error('Authentication required.');
		return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
	}

	async function loadInventory(): Promise<void> {
		inventoryLoading = true;
		inventoryError = '';
		try {
			const res = await fetch('/api/admin/reembed/inventory', { headers: await authHeaders() });
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(typeof body?.error === 'string' ? body.error : 'Inventory failed.');
			}
			inventory = (body?.inventory as Inventory) ?? null;
		} catch (e) {
			inventoryError = e instanceof Error ? e.message : 'Inventory failed.';
			inventory = null;
		} finally {
			inventoryLoading = false;
		}
	}

	async function openEmbeddingHealth(): Promise<void> {
		try {
			const res = await fetch('/api/admin/ingest/embedding-health', { headers: await authHeaders() });
			const text = await res.text();
			const w = window.open('', '_blank', 'noopener,noreferrer');
			if (w) {
				w.document.write(`<!DOCTYPE html><meta charset="utf-8"><pre style="white-space:pre-wrap;font:12px/1.4 ui-monospace,monospace;padding:16px;background:#111;color:#eee">${text.replace(/</g, '&lt;')}</pre>`);
				w.document.close();
			}
		} catch (e) {
			embedError = e instanceof Error ? e.message : 'Could not load embedding-health.';
		}
	}

	async function loadJobs(): Promise<void> {
		embedError = '';
		neonDisabled = false;
		try {
			const res = await fetch('/api/admin/reembed/jobs?limit=20', { headers: await authHeaders() });
			const body = await res.json().catch(() => ({}));
			if (res.status === 503) {
				neonDisabled = true;
				jobs = [];
				activeJob = null;
				events = [];
				embedError =
					typeof body?.error === 'string' ? body.error : 'Neon persistence is not enabled.';
				return;
			}
			if (!res.ok) {
				throw new Error(typeof body?.error === 'string' ? body.error : 'Failed to load jobs.');
			}
			jobs = Array.isArray(body?.jobs) ? (body.jobs as ReembedJob[]) : [];
			const running = jobs.find((j) => j.status === 'running' || j.status === 'pending');
			if (running) {
				await loadJobDetail(running.id);
			} else {
				activeJob = null;
				events = [];
			}
		} catch (e) {
			embedError = e instanceof Error ? e.message : 'Failed to load jobs.';
		}
	}

	async function loadJobDetail(jobId: string): Promise<void> {
		try {
			const res = await fetch(
				`/api/admin/reembed/jobs/${encodeURIComponent(jobId)}?events=1&event_limit=120`,
				{ headers: await authHeaders() }
			);
			const body = await res.json().catch(() => ({}));
			if (!res.ok) return;
			activeJob = (body?.job as ReembedJob) ?? null;
			events = Array.isArray(body?.events) ? (body.events as ReembedEvent[]) : [];
		} catch {
			/* ignore */
		}
	}

	function stopPoll(): void {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
	}

	function startPoll(): void {
		stopPoll();
		if (!browser) return;
		pollTimer = setInterval(() => {
			void loadJobs();
		}, 4000);
	}

	async function startJob(): Promise<void> {
		startBusy = true;
		embedError = '';
		try {
			const res = await fetch('/api/admin/reembed/jobs', {
				method: 'POST',
				headers: await authHeaders(),
				body: JSON.stringify({ batch_size: batchSizeInput })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(typeof body?.error === 'string' ? body.error : 'Could not start job.');
			}
			await loadJobs();
			startPoll();
		} catch (e) {
			embedError = e instanceof Error ? e.message : 'Could not start job.';
		} finally {
			startBusy = false;
		}
	}

	async function cancelJob(): Promise<void> {
		if (!activeJob) return;
		cancelBusy = true;
		try {
			const res = await fetch(`/api/admin/reembed/jobs/${encodeURIComponent(activeJob.id)}/cancel`, {
				method: 'POST',
				headers: await authHeaders()
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(typeof body?.error === 'string' ? body.error : 'Cancel failed.');
			}
			await loadJobs();
		} catch (e) {
			embedError = e instanceof Error ? e.message : 'Cancel failed.';
		} finally {
			cancelBusy = false;
		}
	}

	async function tickOnce(): Promise<void> {
		if (!activeJob) return;
		tickBusy = true;
		try {
			const res = await fetch(`/api/admin/reembed/jobs/${encodeURIComponent(activeJob.id)}/tick`, {
				method: 'POST',
				headers: await authHeaders()
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(typeof body?.error === 'string' ? body.error : 'Tick failed.');
			}
			await loadJobs();
		} catch (e) {
			embedError = e instanceof Error ? e.message : 'Tick failed.';
		} finally {
			tickBusy = false;
		}
	}

	function setTab(next: 'embedding' | 'quarantine'): void {
		tab = next;
		const u = new URL(page.url);
		u.searchParams.set('tab', next);
		void goto(`${u.pathname}${u.search}`, { replaceState: true, noScroll: true });
	}

	$effect(() => {
		syncTabFromUrl();
	});

	onMount(() => {
		syncTabFromUrl();
		void loadInventory();
		void loadJobs();
		return () => stopPoll();
	});

	$effect(() => {
		if (!browser) return;
		const run = activeJob?.status === 'running' || activeJob?.status === 'pending';
		if (run) startPoll();
		else stopPoll();
	});
</script>

<svelte:head>
	<title>Issue resolution — Admin — SOPHIA</title>
</svelte:head>

<main class="issue-resolution-page sophia-stack-comfortable">
	<header class="issue-hero">
		<p class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-dim">Admin</p>
		<h1 class="mt-2 font-serif text-2xl text-sophia-dark-text sm:text-3xl">Issue resolution</h1>
		<p class="mt-2 max-w-3xl text-sm leading-6 text-sophia-dark-muted">
			Corpus embedding maintenance (vector index + Voyage 1024 alignment) and quarantined claim triage. Re-embed jobs
			run out-of-band via Neon + the ingestion poller; use “Advance one step” only when the poller is not running.
		</p>
	</header>

	<div class="tablist" role="tablist" aria-label="Issue resolution sections">
		<button
			type="button"
			role="tab"
			class="tab-btn"
			aria-selected={tab === 'embedding'}
			onclick={() => setTab('embedding')}
		>
			Embedding issues
		</button>
		<button
			type="button"
			role="tab"
			class="tab-btn"
			aria-selected={tab === 'quarantine'}
			onclick={() => setTab('quarantine')}
		>
			Quarantine
		</button>
	</div>

	{#if tab === 'embedding'}
		<section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5" aria-label="Embedding inventory">
			<h2 class="font-serif text-lg text-sophia-dark-text">Corpus inventory</h2>
			<p class="mt-2 text-sm text-sophia-dark-muted">
				Counts from Surreal <code class="font-mono text-xs">claim.embedding</code>. Target dimension follows
				<code class="font-mono text-xs">EMBEDDING_PROVIDER</code> / <code class="font-mono text-xs">getEmbeddingDimensions()</code>.
			</p>
			{#if inventoryLoading}
				<p class="mt-4 text-sm text-sophia-dark-muted">Loading inventory…</p>
			{:else if inventoryError}
				<p class="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100" role="alert">
					{inventoryError}
				</p>
			{:else if inventory}
				<dl class="mt-4 grid gap-3 text-sm sm:grid-cols-2">
					<div>
						<dt class="font-mono text-xs uppercase tracking-[0.08em] text-sophia-dark-dim">Target dim</dt>
						<dd class="mt-1 font-mono text-sophia-dark-text">{inventory.targetDim}</dd>
					</div>
					<div>
						<dt class="font-mono text-xs uppercase tracking-[0.08em] text-sophia-dark-dim">Needs re-embed</dt>
						<dd class="mt-1 font-mono text-sophia-dark-text">{inventory.needsWorkCount}</dd>
					</div>
					<div>
						<dt class="font-mono text-xs uppercase tracking-[0.08em] text-sophia-dark-dim">Embedding NONE</dt>
						<dd class="mt-1 font-mono text-sophia-dark-text">{inventory.noneCount}</dd>
					</div>
				</dl>
				{#if inventory.dimBuckets.length > 0}
					<h3 class="mt-6 font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-dim">By vector length</h3>
					<ul class="mt-2 space-y-1 font-mono text-xs text-sophia-dark-text">
						{#each inventory.dimBuckets as b}
							<li>{b.dim ?? 'unknown'} dims — {b.count} claim(s)</li>
						{/each}
					</ul>
				{/if}
				{#if inventory.perSourceNonTarget.length > 0}
					<h3 class="mt-6 font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-dim">Non-target by source (top)</h3>
					<ul class="mt-2 max-h-48 space-y-1 overflow-y-auto font-mono text-xs text-sophia-dark-muted">
						{#each inventory.perSourceNonTarget.slice(0, 30) as s}
							<li>{s.sourceId} — {s.count}</li>
						{/each}
					</ul>
				{/if}
			{/if}
			<div class="mt-6 flex flex-wrap gap-3">
				<button
					type="button"
					class="min-h-[44px] rounded-lg border border-[var(--color-border)] bg-black/20 px-5 py-3 font-mono text-xs uppercase tracking-[0.08em] text-sophia-dark-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)] disabled:opacity-50"
					onclick={() => void loadInventory()}
					disabled={inventoryLoading}
				>
					Refresh inventory
				</button>
				<button
					type="button"
					class="inline-flex min-h-[44px] items-center rounded-lg border border-[var(--color-border)] px-5 py-3 font-mono text-xs uppercase tracking-[0.08em] text-sophia-dark-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)]"
					onclick={() => void openEmbeddingHealth()}
				>
					View embedding-health (JSON)
				</button>
			</div>
		</section>

		<section class="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5" aria-label="Re-embed job">
			<h2 class="font-serif text-lg text-sophia-dark-text">Re-embed job</h2>
			<p class="mt-2 text-sm text-sophia-dark-muted">
				Requires <code class="font-mono text-xs">DATABASE_URL</code> and the
				<code class="font-mono text-xs">0012_reembed_jobs.sql</code> migration. Production advances via
				<code class="font-mono text-xs">pnpm ingestion:job-poller</code>.
			</p>

			{#if embedError}
				<p class="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-50" role="status">
					{embedError}
				</p>
			{/if}

			{#if neonDisabled}
				<p class="mt-4 text-sm text-sophia-dark-muted">
					Neon-backed jobs are unavailable. Configure DATABASE_URL and run
					<code class="font-mono text-xs">pnpm db:migrate</code>.
				</p>
			{:else}
				<div class="mt-4 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
					<label class="flex max-w-xs flex-col gap-2">
						<span class="font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-dim">Batch size</span>
						<input
							type="number"
							class="min-h-[44px] w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm"
							min="1"
							max="500"
							bind:value={batchSizeInput}
						/>
					</label>
					<div class="flex flex-wrap gap-3">
						<button
							type="button"
							class="min-h-[44px] rounded-lg border border-[color-mix(in_srgb,var(--color-sage)_40%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-sage)_12%,var(--color-surface))] px-5 py-3 font-mono text-xs uppercase tracking-[0.08em] text-sophia-dark-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)] disabled:cursor-not-allowed disabled:opacity-50"
							disabled={startBusy || !!activeJob?.id}
							onclick={() => void startJob()}
						>
							{startBusy ? 'Starting…' : 'Start re-embed job'}
						</button>
						<button
							type="button"
							class="min-h-[44px] rounded-lg border border-[var(--color-border)] bg-black/20 px-5 py-3 font-mono text-xs uppercase tracking-[0.08em] text-sophia-dark-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)] disabled:opacity-50"
							onclick={() => void loadJobs()}
						>
							Refresh status
						</button>
						<button
							type="button"
							class="min-h-[44px] rounded-lg border border-red-500/40 bg-red-500/10 px-5 py-3 font-mono text-xs uppercase tracking-[0.08em] text-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)] disabled:opacity-50"
							disabled={cancelBusy || !activeJob || (activeJob.status !== 'running' && activeJob.status !== 'pending')}
							onclick={() => void cancelJob()}
						>
							{cancelBusy ? 'Cancelling…' : 'Cancel job'}
						</button>
						<button
							type="button"
							class="min-h-[44px] rounded-lg border border-[var(--color-border)] bg-black/20 px-5 py-3 font-mono text-xs uppercase tracking-[0.08em] text-sophia-dark-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)] disabled:opacity-50"
							disabled={tickBusy || !activeJob}
							onclick={() => void tickOnce()}
						>
							{tickBusy ? 'Advancing…' : 'Advance one step'}
						</button>
					</div>
				</div>

				{#if activeJob}
					<div class="mt-6 space-y-2 font-mono text-xs text-sophia-dark-text">
						<p><span class="text-sophia-dark-dim">Job</span> {activeJob.id}</p>
						<p><span class="text-sophia-dark-dim">Status</span> {activeJob.status}</p>
						<p><span class="text-sophia-dark-dim">Stage</span> {activeJob.stage}</p>
						<p>
							<span class="text-sophia-dark-dim">Progress</span>
							{activeJob.processedCount}
							{#if activeJob.totalCount != null}
								/ {activeJob.totalCount}
							{/if}
						</p>
						{#if activeJob.lastError}
							<p class="text-red-200">{activeJob.lastError}</p>
						{/if}
					</div>
					{#if events.length > 0}
						<h3 class="mt-6 font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-dim">Recent events</h3>
						<ul class="mt-2 max-h-56 space-y-2 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-black/15 p-3 text-xs text-sophia-dark-muted">
							{#each events.slice(-40) as ev}
								<li>
									<span class="font-mono text-sophia-dark-dim">{ev.eventType}</span>
									{#if ev.payload && Object.keys(ev.payload).length > 0}
										<span class="ml-2 opacity-80">{JSON.stringify(ev.payload).slice(0, 180)}</span>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				{:else if !neonDisabled}
					<p class="mt-4 text-sm text-sophia-dark-muted">No active job. Start one when the corpus needs migration.</p>
				{/if}
			{/if}
		</section>
	{:else}
		<section class="mb-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/60 p-4" aria-label="Quarantine intro">
			<h2 class="font-serif text-lg text-sophia-dark-text">Quarantine</h2>
			<p class="mt-2 text-sm text-sophia-dark-muted">
				Low validation scores and review flags — same remediation contract as ingest validation.
			</p>
		</section>
		<QuarantineReview embedded={true} />
	{/if}
</main>

<style>
	.issue-resolution-page {
		min-height: calc(100vh - var(--nav-height));
		padding: 20px;
		max-width: 1240px;
		margin: 0 auto;
		color: var(--color-text);
	}
	.issue-hero {
		border: 1px solid var(--color-border);
		background: linear-gradient(130deg, rgba(127, 163, 131, 0.16), rgba(44, 96, 142, 0.12));
		border-radius: 12px;
		padding: 20px;
		margin-bottom: 24px;
	}
	.tablist {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-bottom: 24px;
	}
	.tab-btn {
		min-height: 44px;
		padding: 8px 16px;
		border-radius: 8px;
		border: 1px solid var(--color-border);
		background: rgba(0, 0, 0, 0.2);
		font-family: ui-monospace, monospace;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-text);
	}
	.tab-btn[aria-selected='true'] {
		border-color: color-mix(in srgb, var(--color-sage) 45%, var(--color-border));
		background: color-mix(in srgb, var(--color-sage) 12%, var(--color-surface));
	}
	.tab-btn:focus-visible {
		outline: 2px solid var(--color-blue);
		outline-offset: 2px;
	}
</style>
