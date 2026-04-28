<script lang="ts">
	export let neonDisabled: boolean;
	export let validateLlm: boolean;

	export let workerTuningOpen: boolean;

	export let jobForceReingest: boolean;
	export let jobValidationTailOnly: boolean;
	export let jobExtractionConcurrency: string | number;
	export let jobExtractionMaxTokens: string | number;
	export let jobPassageInsertConcurrency: string | number;
	export let jobClaimInsertConcurrency: string | number;
	export let jobRemediationMaxClaims: string | number;
	export let jobRelationsOverlap: string | number;
	export let jobIngestProvider: 'auto' | 'anthropic' | 'vertex' | 'mistral';
	export let jobGoogleThroughputEnabled: boolean;
	export let jobGoogleExtractionFloor: string | number;
	export let jobFailOnGroupingCollapse: boolean;
	export let jobIngestLogPins: boolean;
	export let jobRemediationEnabled: boolean;
	export let jobRemediationRevalidate: boolean;
	export let jobRemediationTargetedRevalidate: boolean;
	export let jobWatchdogPhaseIdleJson: string;
	export let jobWatchdogBaselineMult: string;

	export let preferTogetherForDurableJobs: boolean;
	export let preferTogetherModelId: string;
	export let applyOperatorPhaseModelPins: boolean;
</script>

<section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
	<h2 class="font-serif text-lg text-sophia-dark-text">Advanced</h2>
	<p class="mt-2 text-sm text-sophia-dark-muted">Advanced defaults are remembered in this browser and stamped into the durable job row.</p>

	<details class="mt-4 rounded-lg border border-[var(--color-border)] bg-black/10 p-4" bind:open={workerTuningOpen}>
		<summary class="cursor-pointer font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-muted">
			Worker defaults (per URL run)
		</summary>

		<label
			class="mt-3 flex cursor-pointer items-center gap-3 rounded border border-[var(--color-border)]/60 bg-black/15 p-3"
			class:opacity-50={jobValidationTailOnly}
			class:pointer-events-none={jobValidationTailOnly}
		>
			<input
				type="checkbox"
				bind:checked={jobForceReingest}
				disabled={jobValidationTailOnly || neonDisabled}
				class="h-5 w-5 rounded border-[var(--color-border)] disabled:cursor-not-allowed"
			/>
			<span class="text-sm text-sophia-dark-text">Re-ingest (force extract)</span>
		</label>

		<div class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			<label class="block">
				<span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Extraction parallelism</span>
				<input
					type="number"
					min="1"
					max="16"
					class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm"
					bind:value={jobExtractionConcurrency}
					disabled={neonDisabled}
				/>
			</label>
			<label class="block">
				<span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Max tokens / section</span>
				<input
					type="number"
					min="1000"
					max="20000"
					class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm"
					bind:value={jobExtractionMaxTokens}
					disabled={neonDisabled}
				/>
			</label>
			<label class="block">
				<span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Surreal passage inserts</span>
				<input
					type="number"
					min="1"
					max="12"
					class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm"
					bind:value={jobPassageInsertConcurrency}
					disabled={neonDisabled}
				/>
			</label>
			<label class="block">
				<span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Surreal claim inserts</span>
				<input
					type="number"
					min="1"
					max="24"
					class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm"
					bind:value={jobClaimInsertConcurrency}
					disabled={neonDisabled}
				/>
			</label>
			<label class="block">
				<span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Remediation max claims</span>
				<input
					type="number"
					min="1"
					max="200"
					class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm"
					bind:value={jobRemediationMaxClaims}
					disabled={neonDisabled}
				/>
			</label>
			<label class="block">
				<span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Relations overlap</span>
				<input
					type="number"
					min="1"
					max="99"
					class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm"
					bind:value={jobRelationsOverlap}
					disabled={neonDisabled}
				/>
			</label>
			<label class="block sm:col-span-2">
				<span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Ingest provider</span>
				<select
					class="mt-2 w-full max-w-xs rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm"
					bind:value={jobIngestProvider}
					disabled={neonDisabled}
				>
					<option value="auto">auto</option>
					<option value="vertex">vertex</option>
					<option value="mistral">mistral</option>
					<option value="anthropic">anthropic</option>
				</select>
			</label>
			<label class="flex cursor-pointer items-center gap-3 sm:col-span-2">
				<input type="checkbox" bind:checked={jobGoogleThroughputEnabled} class="h-5 w-5 rounded border-[var(--color-border)]" disabled={neonDisabled} />
				<span class="text-sm text-sophia-dark-text">Google / Vertex throughput mode</span>
			</label>
			<label class="block sm:col-span-2">
				<span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Google extraction floor</span>
				<input
					type="number"
					min="1"
					max="12"
					class="mt-2 w-full max-w-xs rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm"
					bind:value={jobGoogleExtractionFloor}
					disabled={neonDisabled}
				/>
			</label>
		</div>

		<label class="mt-3 flex cursor-pointer items-center gap-3">
			<input type="checkbox" bind:checked={jobFailOnGroupingCollapse} class="h-5 w-5 rounded border-[var(--color-border)]" disabled={neonDisabled} />
			<span class="text-sm text-sophia-dark-text">Fail on grouping position collapse (strict)</span>
		</label>
		<label class="mt-2 flex cursor-pointer items-center gap-3">
			<input type="checkbox" bind:checked={jobIngestLogPins} class="h-5 w-5 rounded border-[var(--color-border)]" disabled={neonDisabled} />
			<span class="text-sm text-sophia-dark-text">Log routing pin diagnostics</span>
		</label>

		{#if validateLlm}
			<div class="mt-3 space-y-2 rounded border border-[var(--color-border)]/60 bg-black/15 p-3">
				<p class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Remediation</p>
				<label class="flex cursor-pointer items-center gap-3">
					<input type="checkbox" bind:checked={jobRemediationEnabled} class="h-5 w-5 rounded border-[var(--color-border)]" disabled={neonDisabled} />
					<span class="text-sm text-sophia-dark-text">Enable remediation pass</span>
				</label>
				<label class="flex cursor-pointer items-center gap-3">
					<input type="checkbox" bind:checked={jobRemediationRevalidate} class="h-5 w-5 rounded border-[var(--color-border)]" disabled={neonDisabled} />
					<span class="text-sm text-sophia-dark-text">Full second validation after remediation</span>
				</label>
				<label class="flex cursor-pointer items-center gap-3">
					<input type="checkbox" bind:checked={jobRemediationTargetedRevalidate} class="h-5 w-5 rounded border-[var(--color-border)]" disabled={neonDisabled} />
					<span class="text-sm text-sophia-dark-text">Targeted re-validation</span>
				</label>
			</div>
		{/if}

		<label class="mt-4 block">
			<span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Watchdog phase idle (JSON)</span>
			<textarea
				class="mt-2 min-h-[72px] w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-xs"
				bind:value={jobWatchdogPhaseIdleJson}
				rows="3"
				disabled={neonDisabled}
			></textarea>
		</label>
		<label class="mt-2 block max-w-xs">
			<span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Watchdog baseline mult.</span>
			<input
				type="number"
				min="0.5"
				max="10"
				step="0.1"
				class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm"
				bind:value={jobWatchdogBaselineMult}
				disabled={neonDisabled}
			/>
		</label>
	</details>

	<div class="mt-4 rounded-lg border border-[var(--color-border)] bg-black/10 p-4 sophia-stack-default">
		<h3 class="font-serif text-base text-sophia-dark-text">Model pinning</h3>
		<label class="flex cursor-pointer items-start gap-3 rounded border border-[var(--color-border)]/50 bg-black/10 p-3">
			<input type="checkbox" bind:checked={preferTogetherForDurableJobs} class="mt-0.5 h-5 w-5 shrink-0 rounded border-[var(--color-border)]" disabled={neonDisabled} />
			<span class="text-sm leading-snug text-sophia-dark-text">
				<strong class="font-medium">Prefer Together</strong> for extraction/relations/grouping/remediation/json_repair.
			</span>
		</label>
		{#if preferTogetherForDurableJobs}
			<label class="block max-w-xl">
				<span class="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-sophia-dark-dim">Together model id</span>
				<input class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm" bind:value={preferTogetherModelId} disabled={neonDisabled} />
			</label>
		{/if}
		<label class="flex cursor-pointer items-start gap-3 rounded border border-[var(--color-border)]/50 bg-black/10 p-3">
			<input type="checkbox" bind:checked={applyOperatorPhaseModelPins} class="mt-0.5 h-5 w-5 shrink-0 rounded border-[var(--color-border)]" disabled={neonDisabled} />
			<span class="text-sm leading-snug text-sophia-dark-text">
				<strong class="font-medium">Apply per-phase model overrides</strong> from Operator hub (saved in this browser).
			</span>
		</label>
	</div>
</section>

