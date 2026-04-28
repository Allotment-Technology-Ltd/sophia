<script context="module" lang="ts">
	export type IngestionContextStage = 'configure' | 'sources' | 'run' | 'monitor' | 'triage';
	export type WizardStepId = 'configure' | 'sources' | 'mode' | 'review' | 'monitor';
</script>

<script lang="ts">
	export let activeStage: IngestionContextStage;

	// Optional: when present, we show wizard chips + CTA.
	export let wizardStep: WizardStepId | null = null;
	export let wizardTitle = 'Ingestion wizard';
	export let wizardDescription = 'Return to the wizard to continue the guided flow.';
	export let wizardReturnHref = '/admin/ingest/operator?step=configure';

	type StageItem = { id: IngestionContextStage; label: string; href: string };
	const stages: StageItem[] = [
		{ id: 'configure', label: '1 Configure', href: '/admin/ingest/operator?step=configure' },
		{ id: 'sources', label: '2 Sources', href: '/admin/ingest/operator?step=sources' },
		{ id: 'run', label: '3 Run setup', href: '/admin/ingest/operator?step=review' },
		{ id: 'monitor', label: '4 Monitor', href: '/admin/ingest/operator/activity' },
		{ id: 'triage', label: '5 Triage', href: '/admin/ingest/operator/activity?panel=dlq' }
	];
</script>

<section class="strip" aria-label="Ingestion context">
	<div class="top">
		<nav class="journey" aria-label="Ingestion journey">
			<ol class="journey-list">
				{#each stages as s (s.id)}
					<li>
						<a
							class="journey-link"
							class:active={s.id === activeStage}
							href={s.href}
							aria-current={s.id === activeStage ? 'step' : undefined}
						>
							{s.label}
						</a>
					</li>
				{/each}
			</ol>
		</nav>

		{#if wizardStep}
			<div class="wiz">
				<div class="wiz-copy">
					<p class="wiz-kicker">{wizardTitle}</p>
					<p class="wiz-desc">{wizardDescription}</p>
				</div>
				<div class="wiz-actions">
					<a class="wiz-btn" href={wizardReturnHref}>Back to wizard</a>
				</div>
			</div>
		{/if}
	</div>

	{#if wizardStep}
		<ol class="wiz-steps" aria-label="Wizard steps">
			<li class:active={wizardStep === 'configure'}>1 Configure</li>
			<li class:active={wizardStep === 'sources'}>2 Sources</li>
			<li class:active={wizardStep === 'mode'}>3 Mode</li>
			<li class:active={wizardStep === 'review'}>4 Review</li>
			<li class:active={wizardStep === 'monitor'}>5 Monitor</li>
		</ol>
	{/if}
</section>

<style>
	.strip {
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: color-mix(in srgb, var(--color-surface) 92%, black 8%);
		padding: 12px 14px;
	}

	.top {
		display: grid;
		gap: 12px;
	}
	@media (min-width: 960px) {
		.top {
			grid-template-columns: 1fr minmax(0, 520px);
			align-items: start;
		}
	}

	.journey-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.journey-link {
		display: inline-flex;
		align-items: center;
		min-height: 40px;
		padding: 7px 11px;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--color-border) 85%, transparent);
		background: transparent;
		text-decoration: none;
		font-size: 12px;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-muted);
	}
	.journey-link:hover {
		border-color: color-mix(in srgb, var(--color-sage) 35%, var(--color-border));
		color: var(--color-text);
	}
	.journey-link.active {
		border-color: color-mix(in srgb, var(--color-sage) 45%, var(--color-border));
		background: color-mix(in srgb, var(--color-sage) 12%, transparent);
		color: var(--color-text);
		font-weight: 600;
	}

	.wiz {
		border: 1px solid color-mix(in srgb, var(--color-border) 85%, transparent);
		border-radius: 12px;
		background: color-mix(in srgb, black 10%, transparent);
		padding: 10px 12px;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px 14px;
	}
	.wiz-kicker {
		margin: 0;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		opacity: 0.78;
	}
	.wiz-desc {
		margin: 6px 0 0;
		font-size: 13px;
		line-height: 1.45;
		color: var(--color-text);
		opacity: 0.92;
		max-width: 60rem;
	}
	.wiz-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 40px;
		padding: 8px 12px;
		border-radius: 10px;
		border: 1px solid color-mix(in srgb, var(--color-sage) 35%, var(--color-border));
		background: color-mix(in srgb, var(--color-sage) 12%, var(--color-surface));
		color: var(--color-text);
		text-decoration: none;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.wiz-btn:hover {
		border-color: var(--color-sage);
	}

	.wiz-steps {
		margin: 10px 0 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.wiz-steps li {
		border: 1px solid color-mix(in srgb, var(--color-border) 85%, transparent);
		border-radius: 999px;
		padding: 5px 10px;
		font-size: 12px;
		opacity: 0.8;
	}
	.wiz-steps li.active {
		opacity: 1;
		border-color: color-mix(in srgb, var(--color-sage) 45%, var(--color-border));
		background: color-mix(in srgb, var(--color-sage) 10%, transparent);
	}
</style>

