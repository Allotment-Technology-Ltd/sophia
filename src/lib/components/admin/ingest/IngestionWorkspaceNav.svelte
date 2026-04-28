<script context="module" lang="ts">
	export type IngestionWorkspaceNavId =
		| 'dashboard'
		| 'home'
		| 'monitoring'
		| 'triage';
</script>

<script lang="ts">
	export let active: IngestionWorkspaceNavId | null = null;
	export let compact = false;

	type NavItem = { id: IngestionWorkspaceNavId; label: string; href: string; kind?: 'primary' | 'secondary' };
	const items: NavItem[] = [
		{ id: 'dashboard', label: 'Dashboard', href: '/admin/ingest', kind: 'primary' },
		{ id: 'home', label: 'Workspace', href: '/admin/ingest/operator', kind: 'primary' },
		{ id: 'monitoring', label: 'Monitoring', href: '/admin/ingest/operator/activity', kind: 'primary' },
		{ id: 'triage', label: 'Triage', href: '/admin/ingest/operator/triage', kind: 'primary' }
	];
</script>

<nav class="ws-nav" class:compact={compact} aria-label="Ingestion workspace navigation">
	<ul class="ws-list">
		{#each items as it (it.id)}
			<li>
				<a
					class="ws-link"
					class:active={active === it.id}
					class:primary={it.kind === 'primary'}
					href={it.href}
					aria-current={active === it.id ? 'page' : undefined}
				>
					{it.label}
				</a>
			</li>
		{/each}
	</ul>
</nav>

<style>
	.ws-nav {
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: color-mix(in srgb, var(--color-surface) 92%, black 8%);
		padding: 10px;
	}

	.ws-nav.compact {
		padding: 8px;
	}

	.ws-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
	}

	.ws-link {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 40px;
		padding: 8px 10px;
		border-radius: 10px;
		border: 1px solid transparent;
		background: transparent;
		text-decoration: none;
		color: var(--color-muted);
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
		white-space: nowrap;
	}

	.ws-link:hover {
		border-color: color-mix(in srgb, var(--color-sage) 35%, var(--color-border));
		color: var(--color-text);
	}

	.ws-link:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px var(--color-blue);
	}

	.ws-link.primary {
		color: color-mix(in srgb, var(--color-text) 88%, var(--color-muted));
	}

	.ws-link.active {
		border-color: color-mix(in srgb, var(--color-sage) 45%, var(--color-border));
		background: color-mix(in srgb, var(--color-sage) 12%, transparent);
		color: var(--color-text);
	}
</style>

