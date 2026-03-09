<script lang="ts">
	import type { GraphNode, GraphEdge } from '$lib/types/api';
	import { computeLayout, type LayoutPosition } from '$lib/utils/graphLayout';
	import NodeDetail from './NodeDetail.svelte';

	interface Props {
		nodes: GraphNode[];
		edges: GraphEdge[];
		width?: number;
		height?: number;
		pinnedNodeIds?: string[];
		pathNodeIds?: string[];
		pathEdges?: Array<{ from: string; to: string }>;
		onNodeSelect?: (nodeId: string) => void;
		onJumpToReferences?: (nodeId: string) => void;
	}

	let {
		nodes = [],
		edges = [],
		width = 800,
		height = 600,
		pinnedNodeIds = [],
		pathNodeIds = [],
		pathEdges = [],
		onNodeSelect,
		onJumpToReferences
	}: Props = $props();

	// State management
	let highlightedNodeId = $state<string | null>(null);
	let selectedNodeId = $state<string | null>(null);
	let focusedNodeId = $state<string | null>(null);
	let positions = $state<Map<string, LayoutPosition>>(new Map());

	// Compute layout when nodes or edges change
	$effect(() => {
		if (nodes.length > 0) {
			positions = computeLayout(nodes, edges, width, height);
		}
	});

	// Derived values
	const selectedNode = $derived(
		selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null
	);

	const selectedPosition = $derived(
		selectedNodeId && positions.has(selectedNodeId)
			? positions.get(selectedNodeId)!
			: null
	);

	const highlightedEdges = $derived(
		highlightedNodeId
			? edges.filter((e) => e.from === highlightedNodeId || e.to === highlightedNodeId)
			: []
	);

	const selectedEdges = $derived(
		selectedNodeId
			? edges.filter((e) => e.from === selectedNodeId || e.to === selectedNodeId)
			: []
	);

	// Node rendering helpers
	function getNodeRadius(node: GraphNode): number {
		return node.type === 'source' ? 20 : 12;
	}

	function getNodeColor(node: GraphNode): string {
		if (node.type === 'source') {
			return 'var(--color-sage)';
		}
		// Color claims by phase
		switch (node.phase) {
			case 'retrieval': return 'var(--color-amber)';
			case 'analysis': return 'var(--color-sage)';
			case 'critique': return 'var(--color-copper)';
			case 'synthesis': return 'var(--color-blue)';
			default: return 'var(--color-muted)';
		}
	}

	function getNodeStrokeColor(node: GraphNode): string {
		if (selectedNodeId === node.id) {
			return 'var(--color-sage)';
		}
		if (highlightedNodeId === node.id) {
			return 'var(--color-sage)';
		}
		return getNodeColor(node);
	}

	function isNodeHighlighted(nodeId: string): boolean {
		if (highlightedNodeId === nodeId) return true;
		if (selectedNodeId === nodeId) return true;
		if (pinnedNodeIds.includes(nodeId)) return true;
		if (pathNodeIds.includes(nodeId)) return true;
		const connectedEdge = highlightedEdges.find(
			(e) => e.from === nodeId || e.to === nodeId
		);
		return !!connectedEdge;
	}

	function isEdgeHighlighted(edge: GraphEdge): boolean {
		if (
			pathEdges.some(
				(pathEdge) =>
					(pathEdge.from === edge.from && pathEdge.to === edge.to) ||
					(pathEdge.from === edge.to && pathEdge.to === edge.from)
			)
		) {
			return true;
		}
		return highlightedEdges.some((e) => e.from === edge.from && e.to === edge.to);
	}

	function isEdgeSelected(edge: GraphEdge): boolean {
		return selectedEdges.some((e) => e.from === edge.from && e.to === edge.to);
	}

	// Event handlers
	function handleNodeClick(nodeId: string) {
		if (selectedNodeId === nodeId) {
			// Second click - keep selected, detail panel already showing
			return;
		}
		selectedNodeId = nodeId;
		onNodeSelect?.(nodeId);
	}

	function handleNodeMouseEnter(nodeId: string) {
		highlightedNodeId = nodeId;
	}

	function handleNodeMouseLeave() {
		highlightedNodeId = null;
	}

	function handleNodeKeyDown(e: KeyboardEvent, nodeId: string) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			handleNodeClick(nodeId);
		} else if (e.key === 'Escape') {
			selectedNodeId = null;
			highlightedNodeId = null;
		}
	}

	function handleNodeFocus(nodeId: string) {
		focusedNodeId = nodeId;
		highlightedNodeId = nodeId;
	}

	function handleNodeBlur() {
		focusedNodeId = null;
		if (selectedNodeId === null) {
			highlightedNodeId = null;
		}
	}

	function handleCloseDetail() {
		selectedNodeId = null;
	}

	function handleJumpToReferences() {
		if (selectedNodeId) {
			onJumpToReferences?.(selectedNodeId);
		}
	}

	// Accessibility announcement
	function getNodeAriaLabel(node: GraphNode): string {
		const connectedCount = edges.filter(
			(e) => e.from === node.id || e.to === node.id
		).length;
		return `${node.type} node: ${node.label}. ${connectedCount} connections. ${
			node.phase ? node.phase + ' phase.' : ''
		}`;
	}
</script>

<div 
	class="graph-canvas-container" 
	role="application" 
	aria-label="Argument graph visualization"
>
	<svg
		{width}
		{height}
		class="graph-svg"
		role="img"
		aria-label="Interactive graph showing sources and claims"
	>
		<title>Argument Graph</title>
		<desc>
			A visualization of {nodes.length} nodes and {edges.length} edges representing sources and claims.
			Use tab to navigate between nodes, enter to select, and escape to deselect.
		</desc>

		<!-- Background -->
		<rect width={width} height={height} fill="var(--color-bg)" />

		<!-- Edges (render first so nodes appear on top) -->
		<g class="edges-group" aria-label="Graph edges">
			{#each edges as edge, i}
				{#if positions.has(edge.from) && positions.has(edge.to)}
					{@const fromPos = positions.get(edge.from)!}
					{@const toPos = positions.get(edge.to)!}
					{@const isHighlighted = isEdgeHighlighted(edge)}
					{@const isSelected = isEdgeSelected(edge)}
					<line
						x1={fromPos.x}
						y1={fromPos.y}
						x2={toPos.x}
						y2={toPos.y}
						class="graph-edge"
						class:highlighted={isHighlighted}
						class:selected={isSelected}
						stroke={isSelected ? 'var(--color-sage)' : 'var(--color-dim)'}
						stroke-width={isSelected ? 2 : 1}
						opacity={isHighlighted || isSelected ? 0.8 : 0.3}
						aria-label="{edge.type} relation"
						style:animation-delay="{i * 20}ms"
					/>
				{/if}
			{/each}
		</g>

		<!-- Nodes -->
		<g class="nodes-group" aria-label="Graph nodes">
			{#each nodes as node, i}
				{#if positions.has(node.id)}
					{@const pos = positions.get(node.id)!}
					{@const radius = getNodeRadius(node)}
					{@const isHighlighted = isNodeHighlighted(node.id)}
					{@const isSelected = selectedNodeId === node.id}
					{@const isPinned = pinnedNodeIds.includes(node.id)}
					<g
						class="graph-node"
						class:highlighted={isHighlighted}
						class:selected={isSelected}
						class:pinned={isPinned}
						transform="translate({pos.x}, {pos.y})"
						style:animation-delay="{i * 30}ms"
					>
						<!-- Selection ring (only for selected) -->
						{#if isSelected}
							<circle
								class="node-ring"
								r={radius + 6}
								fill="none"
								stroke="var(--color-sage)"
								stroke-width="2"
								opacity="0.6"
							/>
						{/if}

						<!-- Highlight ring (for hover/focus) -->
						{#if isHighlighted && !isSelected}
							<circle
								class="node-highlight-ring"
								r={radius + 4}
								fill="none"
								stroke="var(--color-sage)"
								stroke-width="1.5"
								opacity="0.5"
							/>
						{/if}

						{#if isPinned}
							<circle
								class="node-pinned-ring"
								r={radius + 9}
								fill="none"
								stroke="var(--color-amber)"
								stroke-width="1.5"
								opacity="0.55"
							/>
						{/if}

						<!-- Main node circle -->
						<circle
							r={radius}
							fill={getNodeColor(node)}
							stroke={getNodeStrokeColor(node)}
							stroke-width="2"
							opacity={isHighlighted ? 1 : 0.85}
							tabindex="0"
							role="button"
							aria-label={getNodeAriaLabel(node)}
							aria-pressed={isSelected}
							onclick={() => handleNodeClick(node.id)}
							onmouseenter={() => handleNodeMouseEnter(node.id)}
							onmouseleave={handleNodeMouseLeave}
							onkeydown={(e) => handleNodeKeyDown(e, node.id)}
							onfocus={() => handleNodeFocus(node.id)}
							onblur={handleNodeBlur}
							style:cursor="pointer"
						/>

						<!-- Node label (abbreviated) -->
						<text
							y={radius + 18}
							class="node-label"
							text-anchor="middle"
							font-family="var(--font-ui)"
							font-size="10"
							fill="var(--color-muted)"
							pointer-events="none"
						>
							{node.label.length > 20 ? node.label.slice(0, 20) + '...' : node.label}
						</text>
					</g>
				{/if}
			{/each}
		</g>
	</svg>

	<!-- Detail panel -->
	{#if selectedNode && selectedPosition}
		<NodeDetail
			node={selectedNode}
			{edges}
			{nodes}
			position={selectedPosition}
			onClose={handleCloseDetail}
			onJumpToReferences={handleJumpToReferences}
		/>
	{/if}
</div>

<!-- Live region for accessibility announcements -->
<div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
	{#if selectedNodeId}
		{@const node = nodes.find((n) => n.id === selectedNodeId)}
		{node?.label} selected
	{/if}
</div>

<style>
	.graph-canvas-container {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		background: var(--color-bg);
	}

	.graph-svg {
		display: block;
		width: 100%;
		height: 100%;
	}

	.node-label {
		user-select: none;
	}

	/* Screen reader only */
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border-width: 0;
	}
</style>
