<script lang="ts">
	export let neonDisabled: boolean;

	export let urlsInput: string;

	export let sepPresetId: string;
	export let sepCustomKeywords: string;
	export let sepBatchCount: number;
	export let sepExcludeIngested: boolean;
	export let sepPresets: { id: string; label: string }[];
	export let sepSuggestLoading: boolean;
	export let sepSuggestMessage: string;
	export let sepLastStats: string;

	export let cohortDays: number;
	export let presetBusy: boolean;
	export let presetMessage: string;
	export let trimStripTraining: boolean;
	export let trimStripGolden: boolean;
	export let trimStripDlq: boolean;
	export let trimBusy: boolean;

	export let onFillFromSep: () => void | Promise<void>;
	export let onPresetGolden: () => void | Promise<void>;
	export let onPresetTraining: () => void | Promise<void>;
	export let onPresetPhase1Bundle: () => void | Promise<void>;
	export let onTrimUrls: () => void | Promise<void>;
	export let onUseInStartJob: () => void;
</script>

<section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
	<h2 class="font-serif text-lg text-sophia-dark-text">Build batch</h2>
	<p class="mt-2 text-sm text-sophia-dark-muted">Use helpers to fill the URL list, then jump back to Start job.</p>

	<div class="mt-5 rounded-lg border border-[var(--color-border)] bg-black/10 p-4 sophia-stack-default">
		<h3 class="font-serif text-base text-sophia-dark-text">SEP catalog helper</h3>
		<p class="text-sm leading-6 text-sophia-dark-muted">
			Build a batch from <span class="font-mono text-xs">data/sep-entry-urls.json</span> by topic preset + keyword fragments.
		</p>
		<div class="flex flex-wrap items-end gap-4">
			<label class="block min-w-[200px] flex-1">
				<span class="font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-dim">Topic preset</span>
				<select
					class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 text-sm text-sophia-dark-text focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)]"
					bind:value={sepPresetId}
					disabled={neonDisabled}
				>
					<option value="">— Optional —</option>
					{#each sepPresets as p (p.id)}
						<option value={p.id}>{p.label}</option>
					{/each}
				</select>
			</label>
			<label class="block min-w-[200px] flex-[2]">
				<span class="font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-dim">Custom keywords (slug fragments)</span>
				<input
					type="text"
					class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)]"
					bind:value={sepCustomKeywords}
					placeholder="e.g. bayesian, confirmation"
					autocomplete="off"
					disabled={neonDisabled}
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
					disabled={neonDisabled}
				/>
			</label>
		</div>
		<label class="flex cursor-pointer items-center gap-3">
			<input type="checkbox" bind:checked={sepExcludeIngested} class="h-5 w-5 rounded border-[var(--color-border)]" disabled={neonDisabled} />
			<span class="text-sm text-sophia-dark-text">Exclude URLs already ingested or operator-suppressed (Neon + Surreal)</span>
		</label>
		{#if sepLastStats}
			<p class="font-mono text-xs text-sophia-dark-muted">{sepLastStats}</p>
		{/if}
		{#if sepSuggestMessage}
			<p class="text-sm text-amber-100" role="status">{sepSuggestMessage}</p>
		{/if}
		<div class="flex flex-wrap items-center gap-3">
			<button
				type="button"
				class="inline-flex min-h-[44px] max-w-md items-center justify-center rounded-lg border border-[color-mix(in_srgb,var(--color-blue)_35%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-blue)_12%,var(--color-surface))] px-5 py-3 font-mono text-sm font-medium text-sophia-dark-text transition hover:border-[var(--color-blue)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)] disabled:cursor-not-allowed disabled:opacity-50"
				disabled={sepSuggestLoading || neonDisabled}
				onclick={() => void onFillFromSep()}
			>
				{sepSuggestLoading ? 'Building list…' : 'Fill URL list from catalog'}
			</button>
			<button
				type="button"
				class="inline-flex min-h-[44px] items-center rounded-lg border border-[var(--color-border)] bg-transparent px-5 py-3 font-mono text-sm text-sophia-dark-muted transition hover:border-[var(--color-sage)] hover:text-sophia-dark-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)]"
				onclick={() => onUseInStartJob()}
			>
				Use in Start job
			</button>
		</div>
	</div>

	<div class="mt-5 rounded-lg border border-[var(--color-border)] bg-black/10 p-4 sophia-stack-default">
		<h3 class="font-serif text-base text-sophia-dark-text">Presets</h3>
		<div class="flex flex-wrap items-end gap-3">
			<label class="block w-24">
				<span class="font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-dim">Cohort days</span>
				<input
					type="number"
					min="1"
					max="730"
					class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)]"
					bind:value={cohortDays}
					disabled={neonDisabled}
				/>
			</label>
			<button
				type="button"
				class="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[color-mix(in_srgb,var(--color-blue)_35%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-blue)_10%,var(--color-surface))] px-4 py-2 font-mono text-xs font-medium uppercase tracking-[0.06em] text-sophia-dark-text transition hover:border-[var(--color-blue)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)] disabled:cursor-not-allowed disabled:opacity-50"
				disabled={presetBusy || neonDisabled}
				onclick={() => void onPresetGolden()}
			>
				{presetBusy ? 'Loading…' : 'Golden URLs'}
			</button>
			<button
				type="button"
				class="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[color-mix(in_srgb,var(--color-blue)_35%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-blue)_10%,var(--color-surface))] px-4 py-2 font-mono text-xs font-medium uppercase tracking-[0.06em] text-sophia-dark-text transition hover:border-[var(--color-blue)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)] disabled:cursor-not-allowed disabled:opacity-50"
				disabled={presetBusy || neonDisabled}
				onclick={() => void onPresetTraining()}
			>
				{presetBusy ? 'Loading…' : 'Training cohort'}
			</button>
			<button
				type="button"
				class="mt-6 inline-flex min-h-[44px] max-w-[28rem] flex-col items-stretch justify-center rounded-lg border border-[color-mix(in_srgb,var(--color-sage)_40%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-sage)_14%,var(--color-surface))] px-4 py-2 text-left font-mono text-xs font-medium uppercase tracking-[0.06em] text-sophia-dark-text transition hover:border-[var(--color-sage)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)] disabled:cursor-not-allowed disabled:opacity-50"
				disabled={presetBusy || neonDisabled}
				onclick={() => void onPresetPhase1Bundle()}
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
		<details class="mt-4 rounded-lg border border-[var(--color-border)] bg-black/10 p-4">
			<summary class="cursor-pointer font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-muted">Trim pasted URLs</summary>
			<div class="mt-3 flex flex-col gap-2 text-sm text-sophia-dark-text">
				<label class="flex cursor-pointer items-center gap-2">
					<input type="checkbox" bind:checked={trimStripTraining} class="h-4 w-4 rounded border-[var(--color-border)]" />
					<span>Remove training-acceptable URLs</span>
				</label>
				<label class="flex cursor-pointer items-center gap-2">
					<input type="checkbox" bind:checked={trimStripGolden} class="h-4 w-4 rounded border-[var(--color-border)]" />
					<span>Remove golden URLs already validation-complete</span>
				</label>
				<label class="flex cursor-pointer items-center gap-2">
					<input type="checkbox" bind:checked={trimStripDlq} class="h-4 w-4 rounded border-[var(--color-border)]" />
					<span>Remove URLs with permanent durable failures</span>
				</label>
			</div>
			<div class="mt-4 flex flex-wrap gap-3">
				<button
					type="button"
					class="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[color-mix(in_srgb,var(--color-sage)_40%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-sage)_12%,var(--color-surface))] px-4 py-2 font-mono text-xs font-medium uppercase tracking-[0.06em] text-sophia-dark-text transition hover:border-[var(--color-sage)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)] disabled:cursor-not-allowed disabled:opacity-50"
					disabled={trimBusy || neonDisabled}
					onclick={() => void onTrimUrls()}
				>
					{trimBusy ? 'Trimming…' : 'Apply trim to URL list'}
				</button>
				<button
					type="button"
					class="inline-flex min-h-[44px] items-center rounded-lg border border-[var(--color-border)] bg-transparent px-5 py-3 font-mono text-sm text-sophia-dark-muted transition hover:border-[var(--color-sage)] hover:text-sophia-dark-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)]"
					onclick={() => onUseInStartJob()}
				>
					Use in Start job
				</button>
			</div>
		</details>
	</div>

	<div class="mt-5 rounded-lg border border-[var(--color-border)] bg-black/10 p-4">
		<h3 class="font-serif text-base text-sophia-dark-text">URL list (shared)</h3>
		<label class="mt-3 block">
			<textarea
				class="min-h-[160px] w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm text-sophia-dark-text focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)]"
				bind:value={urlsInput}
				rows="7"
				autocomplete="off"
				disabled={neonDisabled}
			></textarea>
		</label>
	</div>
</section>

