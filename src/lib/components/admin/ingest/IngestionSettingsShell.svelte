<script lang="ts">
	import IngestionWorkspaceNav, { type IngestionWorkspaceNavId } from '$lib/components/admin/ingest/IngestionWorkspaceNav.svelte';
	import IngestionContextStrip, {
		type IngestionContextStage,
		type WizardStepId
	} from '$lib/components/admin/ingest/IngestionContextStrip.svelte';

	export let kicker = 'Admin · Ingest';
	export let title: string;
	export let lead: string;
	export let activeNav: IngestionWorkspaceNavId;
	export let journeyStage: IngestionContextStage | null = null;

	export let wizardStep: WizardStepId | null = null;
	export let wizardTitle = 'Ingestion wizard';
	export let wizardDescription = 'Return to the wizard to continue the guided flow.';
	export let wizardReturnHref = '/admin/ingest/operator?step=configure';
</script>

<main class="shell">
	<header class="hero">
		<p class="font-mono text-xs uppercase tracking-[0.12em] text-sophia-dark-dim">{kicker}</p>
		<h1 class="mt-2 font-serif text-3xl text-sophia-dark-text sm:text-[2.1rem]">{title}</h1>
		<p class="mt-2 max-w-3xl text-sm leading-6 text-sophia-dark-muted">{lead}</p>
		<div class="mt-4">
			<IngestionWorkspaceNav active={activeNav} />
		</div>
		{#if journeyStage}
			<div class="mt-3">
				<IngestionContextStrip
					activeStage={journeyStage}
					{wizardStep}
					{wizardTitle}
					wizardDescription={wizardDescription}
					wizardReturnHref={wizardReturnHref}
				/>
			</div>
		{/if}
	</header>

	<div class="mt-6">
		<slot />
	</div>
</main>

<style>
	.shell {
		min-height: calc(100vh - var(--nav-height));
		padding: 20px;
		max-width: 1240px;
		margin: 0 auto;
		color: var(--color-text);
	}
	.hero {
		border: 1px solid var(--color-border);
		background: linear-gradient(130deg, rgba(127, 163, 131, 0.16), rgba(44, 96, 142, 0.12));
		border-radius: 12px;
		padding: 20px;
	}
</style>

