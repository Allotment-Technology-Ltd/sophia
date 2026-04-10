<script lang="ts">
	import { onMount } from 'svelte';
	import { getIdToken } from '$lib/authClient';

	type Row = {
		id: string;
		text: string;
		validation_score: number | null;
		verification_state: string | null;
		review_state: string | null;
		position_in_source: number | null;
		source_title: string | null;
		source_url: string | null;
	};

	let rows = $state<Row[]>([]);
	let loadError = $state('');
	let loading = $state(true);
	let busy = $state(false);
	let maxScore = $state(80);
	let selected = $state<Set<string>>(new Set());
	let actionMsg = $state('');

	async function authHeaders(): Promise<Record<string, string>> {
		const token = await getIdToken();
		if (!token) throw new Error('Authentication required.');
		return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
	}

	async function loadQueue(): Promise<void> {
		loading = true;
		loadError = '';
		try {
			const q = new URLSearchParams();
			q.set('max_score', String(maxScore));
			q.set('limit', '50');
			const res = await fetch(`/api/admin/quarantine/queue?${q.toString()}`, {
				headers: await authHeaders()
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(typeof body?.error === 'string' ? body.error : 'Failed to load queue.');
			}
			rows = Array.isArray(body?.claims) ? (body.claims as Row[]) : [];
			selected = new Set();
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Failed to load queue.';
			rows = [];
		} finally {
			loading = false;
		}
	}

	function toggle(id: string): void {
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selected = next;
	}

	async function runRemediation(): Promise<void> {
		if (selected.size === 0) return;
		busy = true;
		actionMsg = '';
		try {
			const res = await fetch('/api/admin/quarantine/remediate', {
				method: 'POST',
				headers: await authHeaders(),
				body: JSON.stringify({ claim_ids: [...selected] })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(typeof body?.error === 'string' ? body.error : 'Remediation failed.');
			}
			actionMsg = `Processed ${Array.isArray(body?.results) ? body.results.length : 0} claim(s).`;
			await loadQueue();
		} catch (e) {
			actionMsg = e instanceof Error ? e.message : 'Remediation failed.';
		} finally {
			busy = false;
		}
	}

	onMount(() => {
		void loadQueue();
	});
</script>

<svelte:head>
	<title>Quarantine — Admin — SOPHIA</title>
</svelte:head>

<main class="quarantine-page sophia-stack-comfortable">
	<header class="quarantine-hero">
		<p class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-dim">Admin</p>
		<h1 class="mt-2 font-serif text-2xl text-sophia-dark-text sm:text-3xl">Quarantine review</h1>
		<p class="mt-2 max-w-3xl text-sm leading-6 text-sophia-dark-muted">
			Claims with low validation scores, non-validated verification, or review flags. Select rows and run agent
			remediation (same passage-bounded repair contract as ingest Stage 5b).
		</p>
	</header>

	<section
		class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
		aria-label="Filters and actions"
	>
		<div
			class="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between"
		>
			<label class="flex w-full min-w-0 flex-1 flex-col gap-2 sm:max-w-xs">
				<span class="font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-dim">
					Max validation score (exclude above)
				</span>
				<input
					type="number"
					class="min-h-[44px] w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm text-sophia-dark-text focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)]"
					min="0"
					max="100"
					bind:value={maxScore}
				/>
			</label>
			<div class="flex w-full flex-wrap gap-3 sm:w-auto sm:justify-end">
				<button
					type="button"
					class="min-h-[44px] rounded-lg border border-[var(--color-border)] bg-black/20 px-5 py-3 font-mono text-xs uppercase tracking-[0.08em] text-sophia-dark-text transition hover:border-[var(--color-sage)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)] disabled:opacity-50"
					onclick={() => void loadQueue()}
					disabled={loading}
				>
					Refresh
				</button>
				<button
					type="button"
					class="min-h-[44px] rounded-lg border border-[color-mix(in_srgb,var(--color-sage)_40%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-sage)_12%,var(--color-surface))] px-5 py-3 font-mono text-xs uppercase tracking-[0.08em] text-sophia-dark-text transition hover:border-[var(--color-sage)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)] disabled:cursor-not-allowed disabled:opacity-50"
					onclick={() => void runRemediation()}
					disabled={busy || selected.size === 0}
				>
					{busy ? 'Running…' : 'Run agent remediation'}
				</button>
			</div>
		</div>
		{#if actionMsg}
			<p class="mt-4 text-sm text-sophia-dark-muted">{actionMsg}</p>
		{/if}
	</section>

	<section class="mt-6" aria-label="Queue table">
		{#if loading}
			<p class="text-sm text-sophia-dark-muted">Loading…</p>
		{:else if loadError}
			<p class="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100" role="alert">
				{loadError}
			</p>
		{:else if rows.length === 0}
			<p class="text-sm text-sophia-dark-muted">No claims in queue for this filter.</p>
		{:else}
			<div class="overflow-x-auto rounded-xl border border-[var(--color-border)]">
				<table class="w-full min-w-[720px] border-collapse text-left text-sm">
					<thead>
						<tr
							class="border-b border-[var(--color-border)] bg-black/15 font-mono text-xs uppercase tracking-[0.08em] text-sophia-dark-dim"
						>
							<th class="p-3">Select</th>
							<th class="p-3">Score</th>
							<th class="p-3">Verification</th>
							<th class="p-3">Review</th>
							<th class="p-3">Source</th>
							<th class="p-3">Claim</th>
						</tr>
					</thead>
					<tbody>
						{#each rows as row (row.id)}
							<tr class="border-b border-[var(--color-border)]/60">
								<td class="p-3 align-top">
									<input
										type="checkbox"
										checked={selected.has(row.id)}
										onclick={(e) => {
											e.preventDefault();
											toggle(row.id);
										}}
										class="h-5 w-5 rounded border-[var(--color-border)]"
										aria-label={`Select claim ${row.id}`}
									/>
								</td>
								<td class="p-3 align-top font-mono text-xs">
									{row.validation_score != null ? row.validation_score : '—'}
								</td>
								<td class="p-3 align-top font-mono text-xs">{row.verification_state ?? '—'}</td>
								<td class="p-3 align-top font-mono text-xs">{row.review_state ?? '—'}</td>
								<td class="p-3 align-top text-xs text-sophia-dark-muted">
									{#if row.source_url}
										<a
											href={row.source_url}
											class="text-[var(--color-sage)] underline-offset-2 hover:underline"
											target="_blank"
											rel="noreferrer">{row.source_title ?? row.source_url}</a
										>
									{:else}
										{row.source_title ?? '—'}
									{/if}
								</td>
								<td class="p-3 align-top text-xs leading-relaxed text-sophia-dark-text">
									{row.text.length > 220 ? `${row.text.slice(0, 220)}…` : row.text}
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
	.quarantine-page {
		min-height: calc(100vh - var(--nav-height));
		padding: 20px;
		max-width: 1240px;
		margin: 0 auto;
		color: var(--color-text);
	}
	.quarantine-hero {
		border: 1px solid var(--color-border);
		background: linear-gradient(130deg, rgba(127, 163, 131, 0.16), rgba(44, 96, 142, 0.12));
		border-radius: 12px;
		padding: 20px;
		margin-bottom: 24px;
	}
</style>
