<script lang="ts">
	import { authorizedFetchJson } from '$lib/authorizedFetchJson';

	let {
		jobId = $bindable(''),
		neonDisabled = false,
		onAfterAction
	}: {
		jobId?: string;
		neonDisabled?: boolean;
		onAfterAction?: () => void | Promise<void>;
	} = $props();

	let onlyDlq = $state(false);
	let busyRestart = $state(false);
	let busyResume = $state(false);
	let message = $state('');
	let err = $state('');

	const trimmedId = $derived(String(jobId ?? '').trim());

	async function restartFailed(): Promise<void> {
		err = '';
		message = '';
		if (!trimmedId) {
			err = 'Enter a durable job id (from the jobs list or DLQ).';
			return;
		}
		busyRestart = true;
		try {
			const body = await authorizedFetchJson<Record<string, unknown>>(
				`/api/admin/ingest/jobs/${encodeURIComponent(trimmedId)}/retry`,
				{
					method: 'POST',
					jsonBody: { mode: 'restart', only_dlq: onlyDlq }
				}
			);
			const n = typeof body.touched === 'number' ? body.touched : 0;
			message = `Restart queued for ${n} URL(s). The worker will pick them up on the next tick.`;
			await onAfterAction?.();
		} catch (e) {
			err = e instanceof Error ? e.message : 'Restart failed';
		} finally {
			busyRestart = false;
		}
	}

	async function resumeFailed(): Promise<void> {
		err = '';
		message = '';
		if (!trimmedId) {
			err = 'Enter a durable job id.';
			return;
		}
		busyResume = true;
		try {
			const body = await authorizedFetchJson<Record<string, unknown>>(
				`/api/admin/ingest/jobs/${encodeURIComponent(trimmedId)}/retry`,
				{
					method: 'POST',
					jsonBody: { mode: 'resume', only_dlq: onlyDlq }
				}
			);
			const n = typeof body.touched === 'number' ? body.touched : 0;
			const results = Array.isArray(body.resumeResults) ? body.resumeResults : [];
			const failed = results.filter((r) => typeof r === 'object' && r && (r as { ok?: boolean }).ok === false);
			message =
				failed.length > 0
					? `Resume: ${n} started; some child runs reported errors — check job events.`
					: `Resume started for ${n} URL(s) with an existing ingest run id.`;
			await onAfterAction?.();
		} catch (e) {
			err = e instanceof Error ? e.message : 'Resume failed';
		} finally {
			busyResume = false;
		}
	}
</script>

<section
	class="recovery-card rounded-xl border border-[color-mix(in_srgb,var(--color-sage)_35%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-sage)_8%,var(--color-surface))] p-5 shadow-sm"
	aria-labelledby="recovery-heading"
>
	<div class="recovery-card__head">
		<h2 id="recovery-heading" class="font-serif text-lg font-medium text-sophia-dark-text">
			Recover failed URLs (durable job)
		</h2>
		<p class="mt-2 max-w-2xl text-sm leading-relaxed text-sophia-dark-text/90">
			Use this when items are <strong class="font-medium">failed</strong> but not necessarily on the dead-letter table
			below. <span class="font-mono text-xs opacity-90">Restart</span> re-queues from scratch;
			<span class="font-mono text-xs opacity-90">Resume</span> continues an existing child run from checkpoint when a run id
			exists.
		</p>
	</div>

	<div class="mt-5 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
		<label class="block">
			<span class="block font-mono text-[0.65rem] uppercase tracking-[0.12em] text-sophia-dark-dim">Job id</span>
			<input
				type="text"
				class="mt-2 w-full max-w-xl rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 font-mono text-sm text-sophia-dark-text shadow-inner"
				placeholder="ingestion_job_…"
				bind:value={jobId}
				disabled={neonDisabled}
				autocomplete="off"
				spellcheck="false"
			/>
		</label>
		<label class="flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--color-border)]/70 bg-black/10 px-4 py-3 lg:max-w-sm">
			<input type="checkbox" bind:checked={onlyDlq} class="h-5 w-5 rounded border-[var(--color-border)]" disabled={neonDisabled} />
			<span class="text-sm text-sophia-dark-text">Limit to DLQ-stamped rows only</span>
		</label>
	</div>

	<div class="mt-5 flex flex-wrap gap-3">
		<button
			type="button"
			class="recovery-btn recovery-btn--primary"
			disabled={neonDisabled || busyRestart || busyResume}
			onclick={() => void restartFailed()}
		>
			{busyRestart ? 'Restarting…' : 'Restart failed URLs'}
		</button>
		<button
			type="button"
			class="recovery-btn recovery-btn--secondary"
			disabled={neonDisabled || busyRestart || busyResume}
			onclick={() => void resumeFailed()}
		>
			{busyResume ? 'Resuming…' : 'Resume failed URLs'}
		</button>
	</div>

	{#if err}
		<p class="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-100" role="alert">{err}</p>
	{/if}
	{#if message}
		<p class="mt-4 rounded-md border border-[var(--color-border)] bg-black/15 px-3 py-2 text-sm text-sophia-dark-text" role="status">
			{message}
		</p>
	{/if}
</section>

<style>
	.recovery-btn {
		min-height: 44px;
		border-radius: 10px;
		padding: 10px 18px;
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			border-color 0.15s ease,
			background 0.15s ease,
			opacity 0.15s ease;
	}
	.recovery-btn:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}
	.recovery-btn--primary {
		border: 1px solid color-mix(in srgb, var(--color-sage) 55%, var(--color-border));
		background: color-mix(in srgb, var(--color-sage) 22%, var(--color-surface));
		color: var(--color-text);
	}
	.recovery-btn--primary:hover:not(:disabled) {
		border-color: var(--color-sage);
		background: color-mix(in srgb, var(--color-sage) 30%, var(--color-surface));
	}
	.recovery-btn--secondary {
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
	}
	.recovery-btn--secondary:hover:not(:disabled) {
		border-color: color-mix(in srgb, var(--color-sage) 40%, var(--color-border));
	}
</style>
