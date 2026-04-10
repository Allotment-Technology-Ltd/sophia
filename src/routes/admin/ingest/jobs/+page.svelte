<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { getIdToken } from '$lib/authClient';

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

	let pollTimer: ReturnType<typeof setInterval> | null = null;

	async function authHeaders(json = false): Promise<Record<string, string>> {
		const token = await getIdToken();
		if (!token) throw new Error('Authentication required.');
		const h: Record<string, string> = { Authorization: `Bearer ${token}` };
		if (json) h['Content-Type'] = 'application/json';
		return h;
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

	async function startJob(): Promise<void> {
		submitMessage = '';
		const urls = parseUrls(urlsInput);
		if (urls.length === 0) {
			submitMessage = 'Add at least one valid URL (one per line).';
			return;
		}
		submitting = true;
		try {
			const res = await fetch('/api/admin/ingest/jobs', {
				method: 'POST',
				headers: await authHeaders(true),
				body: JSON.stringify({
					urls,
					concurrency: Math.max(1, Math.min(8, Math.trunc(concurrency) || 2)),
					notes: notes.trim() || null,
					validate: validateLlm
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
			urlsInput = '';
			notes = '';
			await loadJobs();
			window.location.href = `/admin/ingest/jobs/${encodeURIComponent(jobId)}`;
		} catch (e) {
			submitMessage = e instanceof Error ? e.message : 'Failed to start job.';
		} finally {
			submitting = false;
		}
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
		void loadJobs();
		pollTimer = setInterval(() => void loadJobs(), 8000);
	});

	onDestroy(() => {
		if (pollTimer) clearInterval(pollTimer);
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
		<p class="mt-2 text-sm text-sophia-dark-muted">One URL per line. Concurrency is capped at 8.</p>
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
						max="8"
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
			<label class="flex cursor-pointer items-center gap-3">
				<input type="checkbox" bind:checked={validateLlm} class="h-5 w-5 rounded border-[var(--color-border)]" />
				<span class="text-sm text-sophia-dark-text">Run LLM validation stage</span>
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
