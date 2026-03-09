<script lang="ts">
	import type { GraphNode, GraphEdge } from '$lib/types/api';
	import { computeLayout, type LayoutPosition } from '$lib/utils/graphLayout';
	import NodeDetail from './NodeDetail.svelte';

	interface Props {
		nodes: GraphNode[];
		edges: GraphEdge[];
		width?: number;
		height?: number;
		isFullscreen?: boolean;
		onToggleFullscreen?: () => void;
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
		isFullscreen = false,
		onToggleFullscreen,
		pinnedNodeIds = [],
		pathNodeIds = [],
		pathEdges = [],
		onNodeSelect,
		onJumpToReferences
	}: Props = $props();

	const MIN_ZOOM = 0.45;
	const MAX_ZOOM = 2.6;

	let highlightedNodeId = $state<string | null>(null);
	let selectedNodeId = $state<string | null>(null);
	let focusedNodeId = $state<string | null>(null);
	let positions = $state<Map<string, LayoutPosition>>(new Map());
	let zoom = $state(1);
	let panX = $state(0);
	let panY = $state(0);
	let isPanning = $state(false);
	let hasUserAdjustedView = $state(false);
	let svgEl = $state<SVGSVGElement | null>(null);
	let panStartX = 0;
	let panStartY = 0;
	let panBaseX = 0;
	let panBaseY = 0;

	$effect(() => {
		if (nodes.length > 0) {
			positions = computeLayout(nodes, edges, width, height);
		}
	});

	const selectedNode = $derived(
		selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null
	);

	const selectedPosition = $derived(
		selectedNodeId && positions.has(selectedNodeId)
			? positions.get(selectedNodeId)!
			: null
	);

	const detailPosition = $derived.by(() => {
		if (!selectedPosition) return null;
		const panelWidth = 300;
		const panelHeight = 280;
		const margin = 18;
		const screenX = selectedPosition.x * zoom + panX;
		const screenY = selectedPosition.y * zoom + panY;
		return {
			x: Math.min(Math.max(screenX, (panelWidth / 2) + margin), width - (panelWidth / 2) - margin),
			y: Math.min(Math.max(screenY, panelHeight + margin), height - margin)
		};
	});

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

	$effect(() => {
		if (positions.size === 0) return;
		if (hasUserAdjustedView) return;
		fitToGraph();
	});

	function clamp(value: number, min: number, max: number): number {
		return Math.min(Math.max(value, min), max);
	}

	function getNodeRadius(node: GraphNode): number {
		return node.type === 'source' ? 20 : 12;
	}

	function getNodeColor(node: GraphNode): string {
		if (node.type === 'source') {
			return 'var(--color-sage)';
		}
		switch (node.phase) {
			case 'retrieval': return 'var(--color-amber)';
			case 'analysis': return 'var(--color-sage)';
			case 'critique': return 'var(--color-copper)';
			case 'synthesis': return 'var(--color-blue)';
			default: return 'var(--color-muted)';
		}
	}

	function getNodeStrokeColor(node: GraphNode): string {
		if (selectedNodeId === node.id) return 'var(--color-sage)';
		if (highlightedNodeId === node.id) return 'var(--color-sage)';
		return getNodeColor(node);
	}

	function isNodeHighlighted(nodeId: string): boolean {
		if (highlightedNodeId === nodeId) return true;
		if (selectedNodeId === nodeId) return true;
		if (pinnedNodeIds.includes(nodeId)) return true;
		if (pathNodeIds.includes(nodeId)) return true;
		const connectedEdge = highlightedEdges.find((e) => e.from === nodeId || e.to === nodeId);
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

	function handleNodeClick(nodeId: string) {
		if (selectedNodeId === nodeId) return;
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

	function applyZoomAtPoint(nextZoom: number, clientX: number, clientY: number): void {
		if (!svgEl) return;
		const boundedZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
		if (Math.abs(boundedZoom - zoom) < 0.0001) return;
		const rect = svgEl.getBoundingClientRect();
		const localX = clientX - rect.left;
		const localY = clientY - rect.top;
		const worldX = (localX - panX) / zoom;
		const worldY = (localY - panY) / zoom;
		zoom = boundedZoom;
		panX = localX - worldX * zoom;
		panY = localY - worldY * zoom;
		hasUserAdjustedView = true;
	}

	function zoomIn(): void {
		if (!svgEl) return;
		const rect = svgEl.getBoundingClientRect();
		applyZoomAtPoint(zoom * 1.16, rect.left + (rect.width / 2), rect.top + (rect.height / 2));
	}

	function zoomOut(): void {
		if (!svgEl) return;
		const rect = svgEl.getBoundingClientRect();
		applyZoomAtPoint(zoom / 1.16, rect.left + (rect.width / 2), rect.top + (rect.height / 2));
	}

	function fitToGraph(): void {
		if (positions.size === 0) return;
		const nodesWithPos = nodes.filter((node) => positions.has(node.id));
		if (nodesWithPos.length === 0) return;

		let minX = Number.POSITIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;

		for (const node of nodesWithPos) {
			const pos = positions.get(node.id)!;
			const radius = getNodeRadius(node) + 16;
			minX = Math.min(minX, pos.x - radius);
			minY = Math.min(minY, pos.y - radius);
			maxX = Math.max(maxX, pos.x + radius);
			maxY = Math.max(maxY, pos.y + radius);
		}

		const graphW = Math.max(maxX - minX, 1);
		const graphH = Math.max(maxY - minY, 1);
		const padding = 36;
		const availableW = Math.max(width - (padding * 2), 1);
		const availableH = Math.max(height - (padding * 2), 1);
		const nextZoom = clamp(Math.min(availableW / graphW, availableH / graphH), MIN_ZOOM, MAX_ZOOM);
		zoom = nextZoom;
		panX = ((width - graphW * zoom) / 2) - (minX * zoom);
		panY = ((height - graphH * zoom) / 2) - (minY * zoom);
	}

	function resetView(): void {
		hasUserAdjustedView = false;
		fitToGraph();
	}

	function resetLayout(): void {
		positions = computeLayout(nodes, edges, width, height);
		selectedNodeId = null;
		highlightedNodeId = null;
		focusedNodeId = null;
		hasUserAdjustedView = false;
		fitToGraph();
	}

	function handleWheel(event: WheelEvent): void {
		event.preventDefault();
		const deltaScale = Math.exp(-event.deltaY * 0.0012);
		applyZoomAtPoint(zoom * deltaScale, event.clientX, event.clientY);
	}

	function handlePointerDown(event: PointerEvent): void {
		const target = event.target as HTMLElement;
		if (target.closest('.graph-node') || target.closest('.node-detail') || target.closest('.graph-controls')) return;
		if (event.button !== 0) return;
		isPanning = true;
		panStartX = event.clientX;
		panStartY = event.clientY;
		panBaseX = panX;
		panBaseY = panY;
		svgEl?.setPointerCapture(event.pointerId);
	}

	function handlePointerMove(event: PointerEvent): void {
		if (!isPanning) return;
		panX = panBaseX + (event.clientX - panStartX);
		panY = panBaseY + (event.clientY - panStartY);
		hasUserAdjustedView = true;
	}

	function handlePointerUp(event: PointerEvent): void {
		if (!isPanning) return;
		isPanning = false;
		svgEl?.releasePointerCapture(event.pointerId);
	}

	function getNodeAriaLabel(node: GraphNode): string {
		const connectedCount = edges.filter((e) => e.from === node.id || e.to === node.id).length;
		return `${node.type} node: ${node.label}. ${connectedCount} connections. ${
			node.phase ? node.phase + ' phase.' : ''
		}`;
	}

	function getShortLabel(label: string): string {
		return label.length > 36 ? `${label.slice(0, 36)}...` : label;
	}

	function shouldRenderNodeLabel(nodeId: string): boolean {
		return (
			selectedNodeId === nodeId ||
			highlightedNodeId === nodeId ||
			focusedNodeId === nodeId ||
			pinnedNodeIds.includes(nodeId) ||
			pathNodeIds.includes(nodeId)
		);
	}

	$effect(() => {
		if (typeof window === 'undefined') return;
		const onWindowKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				selectedNodeId = null;
				highlightedNodeId = null;
			}
		};
		window.addEventListener('keydown', onWindowKeyDown);
		return () => window.removeEventListener('keydown', onWindowKeyDown);
	});
</script>

	<div
		class="graph-canvas-container"
		role="application"
		aria-label="Argument graph visualization"
	>
		<div class="graph-status-chip" aria-live="polite" aria-atomic="true">
			Zoom {Math.round(zoom * 100)}%
		</div>

		<div class="graph-controls" role="toolbar" aria-label="Graph viewport controls">
			<button type="button" class="graph-control-btn" onclick={zoomIn} aria-label="Zoom in">+</button>
			<button type="button" class="graph-control-btn" onclick={zoomOut} aria-label="Zoom out">-</button>
			<button type="button" class="graph-control-btn" onclick={resetView}>Fit</button>
			<button type="button" class="graph-control-btn" onclick={resetLayout}>Reset Layout</button>
			{#if onToggleFullscreen}
				<button type="button" class="graph-control-btn" onclick={onToggleFullscreen}>
					{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
			</button>
		{/if}
	</div>

	<svg
		bind:this={svgEl}
		{width}
		{height}
		class="graph-svg"
		role="img"
		aria-label="Interactive graph showing sources and claims"
		onwheel={handleWheel}
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerUp}
	>
		<title>Argument Graph</title>
		<desc>
			A visualization of {nodes.length} nodes and {edges.length} edges representing sources and claims.
			Use tab to navigate between nodes, enter to select, and escape to deselect.
		</desc>

		<rect width={width} height={height} fill="var(--color-bg)" />

		<g
			class="viewport-group"
			style:transform={"translate(" + panX + "px, " + panY + "px) scale(" + zoom + ")"}
			style:transform-origin="0 0"
		>
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

							<text
								y={radius + 18}
								class="node-label"
								class:is-visible={shouldRenderNodeLabel(node.id)}
								text-anchor="middle"
								font-family="var(--font-ui)"
								font-size="11"
								fill="var(--color-text)"
								pointer-events="none"
							>
								{getShortLabel(node.label)}
							</text>
						</g>
					{/if}
				{/each}
			</g>
		</g>
	</svg>

	{#if selectedNode && detailPosition}
		<div class="detail-backdrop" onclick={handleCloseDetail} aria-hidden="true"></div>
		<NodeDetail
			node={selectedNode}
			{edges}
			{nodes}
			position={detailPosition}
			onClose={handleCloseDetail}
			onJumpToReferences={handleJumpToReferences}
		/>
	{/if}
</div>

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
		touch-action: none;
		cursor: grab;
	}

	.graph-svg:active {
		cursor: grabbing;
	}

	.graph-controls {
		position: absolute;
		top: 10px;
		right: 10px;
		display: flex;
		gap: 6px;
		z-index: 80;
	}

	.graph-status-chip {
		position: absolute;
		top: 10px;
		left: 10px;
		z-index: 80;
		border: 1px solid var(--color-border);
		background: color-mix(in srgb, var(--color-surface) 90%, transparent);
		color: var(--color-text);
		border-radius: var(--radius-sm);
		padding: 5px 8px;
		font-family: var(--font-ui);
		font-size: var(--text-meta);
		letter-spacing: 0.04em;
	}

	.graph-control-btn {
		border: 1px solid var(--color-border);
		background: color-mix(in srgb, var(--color-surface) 88%, transparent);
		color: var(--color-text);
		border-radius: var(--radius-sm);
		padding: 5px 8px;
		font-family: var(--font-ui);
		font-size: var(--text-meta);
		letter-spacing: 0.04em;
		cursor: pointer;
	}

	.graph-control-btn:hover {
		border-color: var(--color-sage-border);
	}

	.node-label {
		opacity: 0;
		transition: opacity 120ms ease;
		user-select: none;
		paint-order: stroke;
		stroke: rgba(7, 8, 10, 0.96);
		stroke-width: 3px;
		font-weight: 500;
		letter-spacing: 0.02em;
	}

	.node-label.is-visible {
		opacity: 0.95;
	}

	.detail-backdrop {
		position: absolute;
		inset: 0;
		background: transparent;
		z-index: 90;
		user-select: none;
	}

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
