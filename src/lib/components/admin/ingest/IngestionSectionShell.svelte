<script lang="ts">
	export let title: string;
	export let description = '';
	export let emphasized = false;
</script>

<section class="ingest-section" class:emphasized={emphasized}>
	<div class="section-head">
		<div class="min-w-0">
			<h2 class="section-title">{title}</h2>
			{#if description}
				<p class="section-description">{description}</p>
			{/if}
		</div>
		<div class="section-actions">
			<slot name="actions" />
		</div>
	</div>
	<div class="section-body">
		<slot />
	</div>
</section>

<style>
	.ingest-section {
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: var(--color-surface);
		padding: 16px;
	}
	.ingest-section.emphasized {
		background: color-mix(in srgb, var(--color-sage) 8%, var(--color-surface));
		border-color: color-mix(in srgb, var(--color-sage) 40%, var(--color-border));
	}
	.section-head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 10px 16px;
	}
	.section-title {
		margin: 0;
		font-family: var(--font-serif);
		font-size: 1.08rem;
		color: var(--color-text);
	}
	.section-description {
		margin: 6px 0 0;
		font-size: 0.9rem;
		line-height: 1.5;
		color: var(--color-text);
		opacity: 0.92;
		max-width: 62rem;
	}
	.section-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}
	.section-body {
		margin-top: 12px;
	}
</style>

