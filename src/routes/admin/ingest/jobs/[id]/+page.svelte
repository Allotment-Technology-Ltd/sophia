<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
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
	};

	type EventRow = {
		seq: number;
		eventType: string;
		payload: Record<string, unknown> | null;
		createdAt?: string;
	};

	let job = $state<JobRow | null>(null);
	let items = $state<ItemRow[]>([]);
	let events = $state<EventRow[]>([]);
	let lastEventSeq = $state(0);
	let loadError = $state('');
	let neonDisabled = $state(false);

	let detailTimer: ReturnType<typeof setInterval> | null = null;
	let eventsTimer: ReturnType<typeof setInterval> | null = null;

	function currentJobId(): string {
		return page.params.id?.trim() ?? '';
	}

	async function authHeaders(): Promise<Record<string, string>> {
		const token = await getIdToken();
		if (!token) throw new Error('Authentication required.');
		return { Authorization: `Bearer ${token}` };
	}

	async function fetchDetail(): Promise<void> {
		const jobId = currentJobId();
		if (!jobId) return;
		loadError = '';
		neonDisabled = false;
		try {
			const res = await fetch(`/api/admin/ingest/jobs/${encodeURIComponent(jobId)}`, {
				headers: await authHeaders()
			});
			const body = await res.json().catch(() => ({}));
			if (res.status === 503) {
				neonDisabled = true;
				job = null;
				items = [];
				loadError =
					typeof body?.error === 'string' ? body.error : 'Neon ingest persistence is not enabled.';
				return;
			}
			if (!res.ok) {
				throw new Error(typeof body?.error === 'string' ? body.error : 'Failed to load job.');
			}
			job = (body?.job as JobRow) ?? null;
			items = Array.isArray(body?.items) ? (body.items as ItemRow[]) : [];
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Failed to load job.';
			job = null;
			items = [];
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
		const params = new URLSearchParams();
		params.set('runId', runId);
		params.set('monitor', '1');
		window.location.href = `/admin/ingest?${params.toString()}`;
	}

	$effect(() => {
		if (!browser) return;
		const id = page.params.id?.trim() ?? '';
		if (!id) return;
		lastEventSeq = 0;
		events = [];
		void fetchDetail();
		void fetchEvents();
	});

	onMount(() => {
		detailTimer = setInterval(() => {
			if (currentJobId()) void fetchDetail();
		}, 4000);

		eventsTimer = setInterval(() => {
			if (currentJobId()) void fetchEvents();
		}, 4000);
	});

	onDestroy(() => {
		if (detailTimer) clearInterval(detailTimer);
		if (eventsTimer) clearInterval(eventsTimer);
	});
</script>

<svelte:head>
	<title>Ingestion job — Admin</title>
</svelte:head>

<main class="job-detail-page sophia-stack-comfortable">
	<p class="font-mono text-xs">
		<a href="/admin/ingest/jobs" class="text-sophia-dark-sage underline-offset-2 hover:underline">← All jobs</a>
	</p>

	{#if neonDisabled}
		<p class="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100" role="status">
			{loadError}
		</p>
	{:else if loadError}
		<p class="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100" role="alert">
			{loadError}
		</p>
	{/if}

	{#if job}
		<header class="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
			<h1 class="font-serif text-2xl text-sophia-dark-text">Job</h1>
			<p class="mt-2 break-all font-mono text-xs text-sophia-dark-muted">{job.id}</p>
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
			<p class="mt-4 text-sm text-sophia-dark-muted">
				Summary: total {job.summary?.total ?? '—'}, pending {job.summary?.pending ?? '—'}, running
				{job.summary?.running ?? '—'}, done {job.summary?.done ?? '—'}, error {job.summary?.error ?? '—'}
			</p>
		</header>

		<section class="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5" aria-labelledby="items-heading">
			<h2 id="items-heading" class="font-serif text-lg text-sophia-dark-text">URLs</h2>
			<div class="mt-4 overflow-x-auto">
				<table class="w-full min-w-[720px] border-collapse text-left text-sm">
					<thead>
						<tr class="border-b border-[var(--color-border)] font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-dim">
							<th class="py-3 pr-3">URL</th>
							<th class="py-3 pr-3">Status</th>
							<th class="py-3 pr-3">Run</th>
							<th class="py-3">Error</th>
						</tr>
					</thead>
					<tbody>
						{#each items as it (it.id)}
							<tr class="border-b border-[var(--color-border)]/60 align-top">
								<td class="max-w-[280px] py-3 pr-3 font-mono text-xs break-all">
									{it.url}
								</td>
								<td class="py-3 pr-3">{it.status}</td>
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
