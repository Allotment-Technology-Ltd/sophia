<script lang="ts">
	import { onMount } from 'svelte';
	import type { GraphNode, GraphEdge } from '$lib/types/api';
	import { formatTraceTag, getNodeTraceTags } from '$lib/utils/graphTrace';

	interface Props {
		node: GraphNode;
		edges: GraphEdge[];
		nodes: GraphNode[];
		position: { x: number; y: number };
		onClose: () => void;
		onJumpToReferences?: () => void;
	}

	let {
		node,
		edges,
		nodes,
		position,
		onClose,
		onJumpToReferences
	}: Props = $props();
	let detailEl = $state<HTMLDivElement | null>(null);

	const nodeTraceTags = $derived(getNodeTraceTags(node));

	// Find connected nodes
	const connectedEdges = $derived(
		edges.filter((e) => e.from === node.id || e.to === node.id)
	);

	const connectedNodes = $derived(
		connectedEdges.map((edge) => {
			const otherId = edge.from === node.id ? edge.to : edge.from;
			const otherNode = nodes.find((n) => n.id === otherId);
			return {
				node: otherNode,
				edge,
				direction: edge.from === node.id ? 'outgoing' : 'incoming'
			};
		}).filter((c) => c.node !== undefined)
	);

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onClose();
		}
	}

	// Keep close keyboard path reliable even if focus leaves the dialog.
	onMount(() => {
		if (detailEl) detailEl.focus();
		const onWindowKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', onWindowKeyDown);
		return () => window.removeEventListener('keydown', onWindowKeyDown);
	});

	function getEdgeLabel(type: string): string {
		const labels: Record<string, string> = {
			'contains': 'contains',
			'supports': 'supports',
			'contradicts': 'contradicts',
			'responds-to': 'responds to',
			'depends-on': 'depends on',
			'defines': 'defines',
			'qualifies': 'qualifies'
		};
		return labels[type] || type;
	}

	function getPhaseColor(phase?: string): string {
		switch (phase) {
			case 'retrieval': return 'var(--color-amber)';
			case 'analysis': return 'var(--color-sage)';
			case 'critique': return 'var(--color-copper)';
			case 'synthesis': return 'var(--color-blue)';
			default: return 'var(--color-muted)';
		}
	}
</script>

<div
	bind:this={detailEl}
	class="node-detail"
	style:left="{position.x}px"
	style:top="{position.y}px"
	role="dialog"
	aria-labelledby="detail-heading"
	aria-modal="true"
	tabindex="-1"
	onkeydown={handleKeyDown}
	onclick={(e) => e.stopPropagation()}
	onmousedown={(e) => e.stopPropagation()}
>
	<div class="detail-header">
		<h3 id="detail-heading" class="detail-title">
			<span 
				class="type-badge" 
				style:background-color={node.type === 'source' ? 'var(--color-sage-bg)' : 'var(--color-muted)'}
				style:color={node.type === 'source' ? 'var(--color-sage)' : 'var(--color-text)'}
			>
				{node.type}
			</span>
			{#if node.phase}
				<span class="phase-badge" style:color={getPhaseColor(node.phase)}>
					{node.phase}
				</span>
			{/if}
		</h3>
		<button
			class="close-button"
			onclick={onClose}
			aria-label="Close detail panel"
		>
			<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
				<path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
			</svg>
		</button>
	</div>

	<div class="detail-body">
		<p class="node-label">{node.label}</p>

		{#if nodeTraceTags.length > 0}
			<section class="connections">
				<h4 class="connections-heading">Trace tags</h4>
				<div class="trace-tag-list">
					{#each nodeTraceTags as tag}
						<span class="trace-tag">{formatTraceTag(tag)}</span>
					{/each}
				</div>
			</section>
		{/if}

		{#if node.provenance_id || node.unresolved_tension_id || (node.derived_from && node.derived_from.length > 0)}
			<section class="connections">
				<h4 class="connections-heading">Trace metadata</h4>
				<div class="trace-meta-list">
					{#if node.provenance_id}
						<p class="trace-meta-row"><strong>Provenance:</strong> {node.provenance_id}</p>
					{/if}
					{#if node.unresolved_tension_id}
						<p class="trace-meta-row"><strong>Tension:</strong> {node.unresolved_tension_id}</p>
					{/if}
					{#if node.derived_from && node.derived_from.length > 0}
						<p class="trace-meta-row"><strong>Derived from:</strong> {node.derived_from.slice(0, 3).join(', ')}</p>
					{/if}
				</div>
			</section>
		{/if}

		{#if connectedNodes.length > 0}
			<section class="connections">
				<h4 class="connections-heading">Connections ({connectedNodes.length})</h4>
				<ul class="connection-list">
					{#each connectedNodes as { node: connectedNode, edge, direction }}
						<li class="connection-item">
							<span class="connection-direction">
								{direction === 'outgoing' ? '→' : '←'}
							</span>
							<span class="edge-type">{getEdgeLabel(edge.type)}</span>
							<span class="connected-node">
								<span 
									class="node-type-indicator"
									style:background-color={connectedNode?.type === 'source' ? 'var(--color-sage)' : 'var(--color-muted)'}
									aria-label={connectedNode?.type}
								></span>
								{connectedNode?.label}
							</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if onJumpToReferences}
			<button class="jump-button" onclick={onJumpToReferences}>
				Jump to References
				<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
					<path d="M1 11L11 1M11 1H1M11 1v10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
				</svg>
			</button>
		{/if}
	</div>
</div>

<style>
	.node-detail {
		position: absolute;
		width: 280px;
		max-height: 400px;
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
		z-index: 100;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		transform: translate(-50%, -100%) translateY(-20px);
		animation: detail-enter 250ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
	}

	@keyframes detail-enter {
		from {
			opacity: 0;
			transform: translate(-50%, -100%) translateY(-10px) scale(0.95);
		}
		to {
			opacity: 1;
			transform: translate(-50%, -100%) translateY(-20px) scale(1);
		}
	}

	.detail-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3);
		border-bottom: 1px solid var(--color-border);
		gap: var(--space-2);
	}

	.detail-title {
		margin: 0;
		font-size: var(--text-ui);
		font-family: var(--font-ui);
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex: 1;
	}

	.type-badge,
	.phase-badge {
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		font-size: 0.65rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.phase-badge {
		background: transparent;
		opacity: 0.8;
	}

	.close-button {
		background: transparent;
		border: none;
		color: var(--color-muted);
		cursor: pointer;
		padding: var(--space-1);
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-sm);
		transition: var(--transition-fast);
	}

	.close-button:hover {
		color: var(--color-text);
		background: var(--color-surface);
	}

	.close-button:focus-visible {
		outline: var(--focus-ring-width) solid var(--focus-ring-color);
		outline-offset: var(--focus-ring-offset);
	}

	.detail-body {
		padding: var(--space-3);
		overflow-y: auto;
		flex: 1;
	}

	.node-label {
		margin: 0 0 var(--space-3) 0;
		font-size: var(--text-body);
		line-height: var(--leading-body);
		color: var(--color-text);
	}

	.connections {
		margin-top: var(--space-3);
	}

	.connections-heading {
		margin: 0 0 var(--space-2) 0;
		font-size: var(--text-ui);
		font-family: var(--font-ui);
		color: var(--color-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.connection-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.trace-tag-list {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.trace-tag {
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		border-radius: 999px;
		padding: 2px 8px;
		font-family: var(--font-ui);
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.trace-meta-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.trace-meta-row {
		margin: 0;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		color: var(--color-muted);
		line-height: 1.35;
	}

	.connection-item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: 0.875rem;
		line-height: 1.4;
	}

	.connection-direction {
		color: var(--color-dim);
		font-family: var(--font-ui);
		flex-shrink: 0;
	}

	.edge-type {
		color: var(--color-muted);
		font-size: 0.75rem;
		font-family: var(--font-ui);
		flex-shrink: 0;
	}

	.connected-node {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--color-text);
		flex: 1;
		min-width: 0;
	}

	.node-type-indicator {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.jump-button {
		margin-top: var(--space-3);
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: var(--color-sage-bg);
		border: 1px solid var(--color-sage-border);
		color: var(--color-sage);
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		border-radius: var(--radius-sm);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		transition: var(--transition-fast);
	}

	.jump-button:hover {
		background: var(--color-sage-border);
	}

	.jump-button:focus-visible {
		outline: var(--focus-ring-width) solid var(--focus-ring-color);
		outline-offset: var(--focus-ring-offset);
	}

	:global(html.reduce-motion) .node-detail {
		animation: none;
		transition: none;
	}
</style>
