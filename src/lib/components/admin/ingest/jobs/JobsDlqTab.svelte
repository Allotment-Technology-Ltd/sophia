<script context="module" lang="ts">
	export type DlqRow = {
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
</script>

<script lang="ts">
	export let neonDisabled: boolean;
	export let dlqItems: DlqRow[];
	export let dlqLoading: boolean;
	export let dlqMessage: string;
	export let dlqReplayBusy: boolean;
	export let dlqRemoveBusy: boolean;
	export let dlqSelected: Record<string, boolean>;

	export let onToggleDlq: (id: string) => void;
	export let onReplaySelected: () => void | Promise<void>;
	export let onRemoveSelected: () => void | Promise<void>;
	export let onExportCsv: () => void;
	export let onRefreshDlq: () => void | Promise<void>;
	export let onBackToDashboard: () => void;

	$: selectedCount = Object.values(dlqSelected).filter(Boolean).length;
</script>

<section
	id="dead-letter"
	class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
	aria-labelledby="dlq-heading"
>
	<h2 id="dlq-heading" class="font-serif text-lg text-sophia-dark-text">Dead letter queue</h2>
	<p class="mt-2 text-sm text-sophia-dark-muted">
		URLs that hit <span class="font-mono text-xs">INGEST_JOB_ITEM_MAX_ATTEMPTS</span> without a successful run.
	</p>
	{#if dlqMessage}
		<p class="mt-3 text-sm text-amber-100" role="status">{dlqMessage}</p>
	{/if}
	<div class="mt-4 flex flex-wrap gap-3">
		<button
			type="button"
			class="inline-flex min-h-[44px] items-center rounded-lg border border-[color-mix(in_srgb,var(--color-sage)_40%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-sage)_12%,var(--color-surface))] px-5 py-3 font-mono text-sm font-medium text-sophia-dark-text transition hover:border-[var(--color-sage)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)] disabled:cursor-not-allowed disabled:opacity-50"
			disabled={dlqReplayBusy || neonDisabled}
			onclick={() => {
				if (confirm('Replay selected DLQ items? This will re-queue work and may restart runs.')) {
					void onReplaySelected();
				}
			}}
		>
			{dlqReplayBusy ? 'Replaying…' : 'Replay selected'}
		</button>
		<button
			type="button"
			class="inline-flex min-h-[44px] items-center rounded-lg border border-red-500/40 bg-red-500/10 px-5 py-3 font-mono text-sm font-medium text-red-100 transition hover:border-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)] disabled:cursor-not-allowed disabled:opacity-50"
			disabled={dlqRemoveBusy || neonDisabled || selectedCount === 0}
			onclick={() => {
				if (
					confirm(
						`Remove ${selectedCount} DLQ item(s)? This will mark them cancelled so they stop showing up in the DLQ.`
					)
				) {
					void onRemoveSelected();
				}
			}}
		>
			{dlqRemoveBusy ? 'Removing…' : 'Remove selected'}
		</button>
		<button
			type="button"
			class="inline-flex min-h-[44px] items-center rounded-lg border border-[var(--color-border)] bg-transparent px-5 py-3 font-mono text-sm text-sophia-dark-muted transition hover:border-[var(--color-sage)] hover:text-sophia-dark-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)]"
			disabled={dlqItems.length === 0}
			onclick={onExportCsv}
		>
			Export CSV
		</button>
		<button
			type="button"
			class="inline-flex min-h-[44px] items-center rounded-lg border border-[var(--color-border)] bg-transparent px-5 py-3 font-mono text-sm text-sophia-dark-muted transition hover:border-[var(--color-sage)] hover:text-sophia-dark-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)]"
			disabled={dlqLoading}
			onclick={() => void onRefreshDlq()}
		>
			{dlqLoading ? 'Loading…' : 'Refresh DLQ'}
		</button>
		<button
			type="button"
			class="inline-flex min-h-[44px] items-center rounded-lg border border-[var(--color-border)] bg-transparent px-5 py-3 font-mono text-sm text-sophia-dark-muted transition hover:border-[var(--color-sage)] hover:text-sophia-dark-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)]"
			onclick={() => onBackToDashboard()}
		>
			Back to dashboard
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
									onchange={() => onToggleDlq(r.itemId)}
								/>
							</td>
							<td class="py-3 pr-3 font-mono text-xs">
								<a
									href="/admin/ingest/operator/activity?panel=jobs&q={encodeURIComponent(r.jobId)}"
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

