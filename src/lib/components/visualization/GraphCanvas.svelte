<script lang="ts">
	import type { GraphNode, GraphEdge, GraphGhostNode, GraphGhostEdge } from '@restormel/contracts/api';
	import { computeLayout, type LayoutPosition } from '@restormel/graph-core/layout';
	import { formatTraceTag, getNodeTraceLabel } from '@restormel/graph-core/trace';
	import {
		graphCanvasEdgeKey,
		type GraphCanvasEdgeSemanticStyle,
		type GraphCanvasNodeSemanticStyle
	} from './semanticStyles';
	import NodeDetail from './NodeDetail.svelte';

	interface Props {
		nodes: GraphNode[];
		edges: GraphEdge[];
		ghostNodes?: GraphGhostNode[];
		ghostEdges?: GraphGhostEdge[];
		showGhostLayer?: boolean;
		showInlineDetail?: boolean;
		showStatusChip?: boolean;
		showViewportControls?: boolean;
		viewportCommand?: { type: 'fit' | 'reset-layout'; nonce: number } | null;
		nodeSemanticStyles?: Record<string, GraphCanvasNodeSemanticStyle>;
		edgeSemanticStyles?: Record<string, GraphCanvasEdgeSemanticStyle>;
		width?: number;
		height?: number;
		isFullscreen?: boolean;
		onToggleFullscreen?: () => void;
		pinnedNodeIds?: string[];
		pathNodeIds?: string[];
		pathEdges?: Array<{ from: string; to: string }>;
		focusNodeIds?: string[];
		focusEdgeIds?: string[];
		dimOutOfScope?: boolean;
		selectedNodeId?: string | null;
		onSelectedNodeChange?: (nodeId: string | null) => void;
		onNodeSelect?: (nodeId: string) => void;
		onJumpToReferences?: (nodeId: string) => void;
	}

	let {
		nodes = [],
		edges = [],
		ghostNodes = [],
		ghostEdges = [],
		showGhostLayer = true,
		showInlineDetail = true,
		showStatusChip = true,
		showViewportControls = true,
		viewportCommand = null,
		nodeSemanticStyles = {},
		edgeSemanticStyles = {},
		width = 800,
		height = 600,
		isFullscreen = false,
		onToggleFullscreen,
		pinnedNodeIds = [],
		pathNodeIds = [],
		pathEdges = [],
		focusNodeIds = [],
		focusEdgeIds = [],
		dimOutOfScope = false,
		selectedNodeId: selectedNodeIdProp = undefined,
		onSelectedNodeChange,
		onNodeSelect,
		onJumpToReferences
	}: Props = $props();

	const MIN_ZOOM = 0.45;
	const MAX_ZOOM = 2.6;

	let highlightedNodeId = $state<string | null>(null);
	let highlightedGhostNodeId = $state<string | null>(null);
	let localSelectedNodeId = $state<string | null>(null);
	let focusedNodeId = $state<string | null>(null);
	type EdgeSelection = { edge: GraphEdge | GraphGhostEdge; isGhost: boolean };
	let hoveredEdge = $state<EdgeSelection | null>(null);
	let selectedEdge = $state<EdgeSelection | null>(null);
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
	let handledViewportCommandNonce = $state<number | null>(null);

	$effect(() => {
		if (nodes.length === 0) {
			positions = new Map();
			return;
		}

		const nextPositions = computeLayout(nodes, edges, width, height);
		if (showGhostLayer && ghostNodes.length > 0) {
			const anchored = new Map<string, GraphGhostNode[]>();
			const unanchored: GraphGhostNode[] = [];
			for (const ghost of ghostNodes) {
				if (ghost.anchorNodeId && nextPositions.has(ghost.anchorNodeId)) {
					if (!anchored.has(ghost.anchorNodeId)) anchored.set(ghost.anchorNodeId, []);
					anchored.get(ghost.anchorNodeId)?.push(ghost);
				} else {
					unanchored.push(ghost);
				}
			}

			for (const [anchorId, group] of anchored.entries()) {
				const anchor = nextPositions.get(anchorId);
				if (!anchor) continue;
				group.forEach((ghost, index) => {
					const angle = ((index % 8) / 8) * Math.PI * 2 - Math.PI / 2;
					const ring = Math.floor(index / 8);
					const radius = 40 + ring * 16;
					nextPositions.set(ghost.id, {
						x: anchor.x + Math.cos(angle) * radius,
						y: anchor.y + Math.sin(angle) * radius
					});
				});
			}

			if (unanchored.length > 0) {
				const centerX = width / 2;
				const centerY = height / 2;
				const radius = Math.min(width, height) * 0.42;
				unanchored.forEach((ghost, index) => {
					const angle = (index / Math.max(unanchored.length, 1)) * Math.PI * 2 - Math.PI / 2;
					nextPositions.set(ghost.id, {
						x: centerX + Math.cos(angle) * radius,
						y: centerY + Math.sin(angle) * radius
					});
				});
			}
		}

		positions = nextPositions;
	});

	const selectedNodeId = $derived(
		selectedNodeIdProp !== undefined ? selectedNodeIdProp : localSelectedNodeId
	);

	const selectedNode = $derived(
		selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null
	);

	const selectedPosition = $derived(
		selectedNodeId && positions.has(selectedNodeId)
			? positions.get(selectedNodeId)!
			: null
	);

	const activeEdge = $derived(selectedEdge ?? hoveredEdge);

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

	const edgeDetailPosition = $derived.by(() => {
		if (!activeEdge) return null;
		const fromPos = positions.get(activeEdge.edge.from);
		const toPos = positions.get(activeEdge.edge.to);
		if (!fromPos || !toPos) return null;
		const midX = ((fromPos.x + toPos.x) / 2) * zoom + panX;
		const midY = ((fromPos.y + toPos.y) / 2) * zoom + panY;
		return {
			x: Math.min(Math.max(midX, 160), width - 160),
			y: Math.min(Math.max(midY, 64), height - 64)
		};
	});

	const activeEdgeConfidence = $derived(activeEdge ? getEdgeConfidence(activeEdge.edge) : null);
	const activeEdgeReasonCode = $derived(activeEdge ? getEdgeReasonCode(activeEdge.edge) : null);
	const activeEdgeRationale = $derived(activeEdge ? getEdgeRationaleSource(activeEdge.edge) : null);

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

	$effect(() => {
		if (showGhostLayer) return;
		if (selectedEdge?.isGhost) selectedEdge = null;
		if (hoveredEdge?.isGhost) hoveredEdge = null;
		highlightedGhostNodeId = null;
	});

	function clamp(value: number, min: number, max: number): number {
		return Math.min(Math.max(value, min), max);
	}

	function getNodeRadius(node: GraphNode): number {
		return nodeSemanticStyles[node.id]?.radius ?? (node.type === 'source' ? 20 : 12);
	}

	function getNodeColor(node: GraphNode): string {
		const semanticStyle = nodeSemanticStyles[node.id];
		if (semanticStyle) return semanticStyle.fill;
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
		const semanticStyle = nodeSemanticStyles[node.id];
		if (selectedNodeId === node.id) return 'var(--color-blue)';
		if (highlightedNodeId === node.id) return 'var(--color-blue)';
		if (pathNodeIds.includes(node.id)) return 'var(--color-blue)';
		if (semanticStyle?.state === 'verified') return 'var(--color-teal)';
		if (semanticStyle?.state === 'unresolved') return 'var(--color-amber)';
		if (semanticStyle?.state === 'contradicted') return 'var(--color-coral)';
		if (semanticStyle?.state === 'synthesis') return 'var(--color-purple)';
		return semanticStyle?.stroke ?? getNodeColor(node);
	}

	function getNodeSemanticShape(node: GraphNode): GraphCanvasNodeSemanticStyle['shape'] {
		return nodeSemanticStyles[node.id]?.shape ?? 'circle';
	}

	function getNodeGlyph(node: GraphNode): string | null {
		return nodeSemanticStyles[node.id]?.glyph ?? null;
	}

	function shouldDimNode(nodeId: string): boolean {
		if (dimOutOfScope && focusNodeIds.length > 0) return !focusNodeIds.includes(nodeId);
		if (pathNodeIds.length > 0) return !pathNodeIds.includes(nodeId);
		if (!selectedNodeId) return false;
		return !isNodeHighlighted(nodeId);
	}

	function getNodeOpacity(nodeId: string): number {
		if (shouldDimNode(nodeId)) return 0.24;
		if (selectedNodeId === nodeId) return 1;
		if (highlightedNodeId === nodeId) return 0.98;
		if (pathNodeIds.includes(nodeId)) return 1;
		return 0.88;
	}

	function getNodeRingColor(node: GraphNode): string {
		if (pathNodeIds.includes(node.id)) return 'var(--color-blue)';
		if (selectedNodeId === node.id) return 'var(--color-blue)';
		return getNodeStrokeColor(node);
	}

	function getEdgeSemanticStyle(edge: GraphEdge): GraphCanvasEdgeSemanticStyle | null {
		return edgeSemanticStyles[graphCanvasEdgeKey(edge)] ?? null;
	}

	function getGhostEdgeMarker(edge: GraphGhostEdge): string | undefined {
		if (selectedNodeId && (edge.from === selectedNodeId || edge.to === selectedNodeId)) {
			return 'url(#arrowblue)';
		}
		return undefined;
	}

	function getEdgeStroke(edge: GraphEdge): string {
		const semanticStyle = getEdgeSemanticStyle(edge);
		if (isEdgeSelected(edge) || isEdgeHighlighted(edge)) return 'var(--color-blue)';
		if (
			pathEdges.some(
				(pathEdge) =>
					(pathEdge.from === edge.from && pathEdge.to === edge.to) ||
					(pathEdge.from === edge.to && pathEdge.to === edge.from)
			)
		) {
			return 'var(--color-blue)';
		}
		return semanticStyle?.stroke ?? 'var(--color-dim)';
	}

	function getEdgeStrokeWidth(edge: GraphEdge): number {
		const semanticStyle = getEdgeSemanticStyle(edge);
		if (isEdgeSelected(edge)) return 2.4;
		if (isEdgeHighlighted(edge)) return 2;
		if (
			pathEdges.some(
				(pathEdge) =>
					(pathEdge.from === edge.from && pathEdge.to === edge.to) ||
					(pathEdge.from === edge.to && pathEdge.to === edge.from)
			)
		) {
			return 2.2;
		}
		return semanticStyle?.strokeWidth ?? 1;
	}

	function getEdgeDasharray(edge: GraphEdge): string | undefined {
		return getEdgeSemanticStyle(edge)?.dasharray;
	}

	function getEdgeMarker(edge: GraphEdge): string | undefined {
		const semanticStyle = getEdgeSemanticStyle(edge);
		if (isEdgeSelected(edge) || isEdgeHighlighted(edge)) return 'url(#arrow-blue)';
		if (
			pathEdges.some(
				(pathEdge) =>
					(pathEdge.from === edge.from && pathEdge.to === edge.to) ||
					(pathEdge.from === edge.to && pathEdge.to === edge.from)
			)
		) {
			return 'url(#arrow-blue)';
		}
		if (!semanticStyle?.marker || semanticStyle.marker === 'none') return undefined;
		return `url(#${semanticStyle.marker.replace('-', '')})`;
	}

	function shouldDimEdge(edge: GraphEdge): boolean {
		if (dimOutOfScope && focusEdgeIds.length > 0) {
			return !focusEdgeIds.includes(graphCanvasEdgeKey(edge));
		}
		if (pathEdges.length > 0) {
			return !pathEdges.some(
				(pathEdge) =>
					(pathEdge.from === edge.from && pathEdge.to === edge.to) ||
					(pathEdge.from === edge.to && pathEdge.to === edge.from)
			);
		}
		if (!selectedNodeId) return false;
		return !(edge.from === selectedNodeId || edge.to === selectedNodeId);
	}

	function getEdgeOpacity(edge: GraphEdge): number {
		if (shouldDimEdge(edge)) return 0.12;
		if (isEdgeSelected(edge)) return 0.96;
		if (isEdgeHighlighted(edge)) return 0.86;
		return 0.58;
	}

	function getDiamondPoints(radius: number): string {
		return `0,-${radius} ${radius},0 0,${radius} -${radius},0`;
	}

	function getHexagonPoints(radius: number): string {
		const x = radius * 0.9;
		const y = radius * 0.52;
		return `${-x},0 ${-radius * 0.45},-${radius} ${radius * 0.45},-${radius} ${x},0 ${radius * 0.45},${radius} ${-radius * 0.45},${radius}`;
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
		if (hoveredEdge?.isGhost === false && hoveredEdge.edge.from === edge.from && hoveredEdge.edge.to === edge.to && hoveredEdge.edge.type === edge.type) {
			return true;
		}
		return highlightedEdges.some((e) => e.from === edge.from && e.to === edge.to);
	}

	function isGhostEdgeHighlighted(edge: GraphGhostEdge): boolean {
		if (!showGhostLayer) return false;
		if (selectedNodeId && (edge.from === selectedNodeId || edge.to === selectedNodeId)) return true;
		if (highlightedNodeId && (edge.from === highlightedNodeId || edge.to === highlightedNodeId)) return true;
		if (selectedEdge?.isGhost === true && 'id' in selectedEdge.edge && selectedEdge.edge.id === edge.id) return true;
		return hoveredEdge?.isGhost === true && 'id' in hoveredEdge.edge && hoveredEdge.edge.id === edge.id;
	}

	function isEdgeSelected(edge: GraphEdge): boolean {
		if (
			selectedEdge?.isGhost === false &&
			selectedEdge.edge.from === edge.from &&
			selectedEdge.edge.to === edge.to &&
			selectedEdge.edge.type === edge.type
		) {
			return true;
		}
		return selectedEdges.some((e) => e.from === edge.from && e.to === edge.to);
	}

	function handleEdgeMouseEnter(edge: GraphEdge | GraphGhostEdge, isGhost: boolean): void {
		hoveredEdge = { edge, isGhost };
	}

	function handleEdgeMouseLeave(): void {
		hoveredEdge = null;
	}

	function handleEdgeClick(edge: GraphEdge | GraphGhostEdge, isGhost: boolean): void {
		if (
			selectedEdge &&
			selectedEdge.isGhost === isGhost &&
			selectedEdge.edge.from === edge.from &&
			selectedEdge.edge.to === edge.to &&
			selectedEdge.edge.type === edge.type &&
			(('id' in selectedEdge.edge ? selectedEdge.edge.id : '') === ('id' in edge ? edge.id : ''))
		) {
			selectedEdge = null;
			return;
		}
		selectedEdge = { edge, isGhost };
	}

	function setSelectedNodeId(nextNodeId: string | null): void {
		if (selectedNodeIdProp === undefined) {
			localSelectedNodeId = nextNodeId;
		}
		onSelectedNodeChange?.(nextNodeId);
		if (nextNodeId) {
			onNodeSelect?.(nextNodeId);
		}
	}

	function handleEdgeKeyDown(event: KeyboardEvent, edge: GraphEdge | GraphGhostEdge, isGhost: boolean): void {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			handleEdgeClick(edge, isGhost);
		}
		if (event.key === 'Escape') {
			clearSelectedEdge();
		}
	}

	function clearSelectedEdge(): void {
		selectedEdge = null;
	}

	function getEdgePassOrigin(edge: GraphEdge | GraphGhostEdge): string {
		return edge.pass_origin ?? ('phaseOrigin' in edge ? edge.phaseOrigin ?? 'retrieval' : 'retrieval');
	}

	function getEdgeConfidence(edge: GraphEdge | GraphGhostEdge): number | null {
		if (typeof edge.relation_confidence === 'number') return edge.relation_confidence;
		if ('evidence_strength' in edge && typeof edge.evidence_strength === 'number') return edge.evidence_strength;
		if ('weight' in edge && typeof edge.weight === 'number') return edge.weight;
		return null;
	}

	function getEdgeRationaleSource(edge: GraphEdge | GraphGhostEdge): string | null {
		if ('rationale_source' in edge && edge.rationale_source) return edge.rationale_source;
		if ('evidence_sources' in edge && edge.evidence_sources && edge.evidence_sources.length > 0) {
			return edge.evidence_sources[0];
		}
		if ('relation_rationale' in edge && edge.relation_rationale) return edge.relation_rationale;
		return null;
	}

	function getEdgeReasonCode(edge: GraphEdge | GraphGhostEdge): string | null {
		return 'reasonCode' in edge ? edge.reasonCode : null;
	}

	function handleNodeClick(nodeId: string) {
		if (selectedNodeId === nodeId) return;
		selectedEdge = null;
		setSelectedNodeId(nodeId);
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
			setSelectedNodeId(null);
			highlightedNodeId = null;
			selectedEdge = null;
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
		setSelectedNodeId(null);
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
		setSelectedNodeId(null);
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
		if (
			target.closest('.graph-node') ||
			target.closest('.graph-edge') ||
			target.closest('.ghost-edge') ||
			target.closest('.ghost-node') ||
			target.closest('.node-detail') ||
			target.closest('.edge-detail') ||
			target.closest('.graph-controls')
		) {
			return;
		}
		if (event.button !== 0) return;
		selectedEdge = null;
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
				setSelectedNodeId(null);
				highlightedNodeId = null;
				selectedEdge = null;
			}
		};
		window.addEventListener('keydown', onWindowKeyDown);
		return () => window.removeEventListener('keydown', onWindowKeyDown);
	});

	$effect(() => {
		if (!viewportCommand) return;
		if (viewportCommand.nonce === handledViewportCommandNonce) return;
		handledViewportCommandNonce = viewportCommand.nonce;
		if (viewportCommand.type === 'fit') {
			resetView();
			return;
		}
		if (viewportCommand.type === 'reset-layout') {
			resetLayout();
		}
	});
</script>

	<div
		class="graph-canvas-container"
		role="application"
		aria-label="Argument graph visualization"
	>
		{#if showStatusChip}
			<div class="graph-status-chip" aria-live="polite" aria-atomic="true">
				Zoom {Math.round(zoom * 100)}%
			</div>
		{/if}

		{#if showViewportControls}
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
		{/if}

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

		<defs>
			<marker id="arrowblue" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
				<path d="M0,0 L8,4 L0,8 Z" fill="var(--color-blue)" />
			</marker>
			<marker id="arrowteal" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
				<path d="M0,0 L8,4 L0,8 Z" fill="var(--color-teal)" />
			</marker>
			<marker id="arrowcoral" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
				<path d="M0,0 L8,4 L0,8 Z" fill="var(--color-coral)" />
			</marker>
			<marker id="arrowamber" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
				<path d="M0,0 L8,4 L0,8 Z" fill="var(--color-amber)" />
			</marker>
			<marker id="arrowpurple" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
				<path d="M0,0 L8,4 L0,8 Z" fill="var(--color-purple)" />
			</marker>
		</defs>

		<rect width={width} height={height} fill="var(--color-bg)" />

		<g
			class="viewport-group"
			style:transform={"translate(" + panX + "px, " + panY + "px) scale(" + zoom + ")"}
			style:transform-origin="0 0"
		>
			{#if showGhostLayer && ghostEdges.length > 0}
				<g class="ghost-edges-group" aria-label="Rejected traversal edges">
					{#each ghostEdges as edge, i}
						{#if positions.has(edge.from) && positions.has(edge.to)}
							{@const fromPos = positions.get(edge.from)!}
							{@const toPos = positions.get(edge.to)!}
							{@const isHighlighted = isGhostEdgeHighlighted(edge)}
							<line
								x1={fromPos.x}
								y1={fromPos.y}
								x2={toPos.x}
								y2={toPos.y}
								class="ghost-edge"
								class:highlighted={isHighlighted}
								stroke="var(--color-dim)"
								stroke-width={isHighlighted ? 1.8 : 1.1}
								opacity={isHighlighted ? 0.52 : 0.22}
								stroke-dasharray="6 5"
								marker-end={getGhostEdgeMarker(edge)}
								aria-label="{edge.type} rejected relation ({edge.reasonCode})"
								role="button"
								tabindex="0"
								onmouseenter={() => handleEdgeMouseEnter(edge, true)}
								onmouseleave={handleEdgeMouseLeave}
								onclick={() => handleEdgeClick(edge, true)}
								onkeydown={(event) => handleEdgeKeyDown(event, edge, true)}
								style:animation-delay="{i * 18}ms"
							/>
						{/if}
					{/each}
				</g>
			{/if}

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
							stroke={getEdgeStroke(edge)}
							stroke-width={getEdgeStrokeWidth(edge)}
							stroke-dasharray={getEdgeDasharray(edge)}
							marker-end={getEdgeMarker(edge)}
							opacity={getEdgeOpacity(edge)}
							aria-label="{edge.type} relation"
							role="button"
							tabindex="0"
							onmouseenter={() => handleEdgeMouseEnter(edge, false)}
							onmouseleave={handleEdgeMouseLeave}
							onclick={() => handleEdgeClick(edge, false)}
							onkeydown={(event) => handleEdgeKeyDown(event, edge, false)}
							style:animation-delay="{i * 20}ms"
						/>
					{/if}
				{/each}
			</g>

			{#if showGhostLayer && ghostNodes.length > 0}
				<g class="ghost-nodes-group" aria-label="Rejected traversal nodes">
					{#each ghostNodes as ghost, i}
						{#if positions.has(ghost.id)}
							{@const pos = positions.get(ghost.id)!}
							{@const isHighlighted = highlightedGhostNodeId === ghost.id}
							<g
								class="ghost-node"
								transform="translate({pos.x}, {pos.y})"
								role="presentation"
								onmouseenter={() => highlightedGhostNodeId = ghost.id}
								onmouseleave={() => highlightedGhostNodeId = null}
								style:animation-delay="{i * 25}ms"
							>
								<circle
									r="8"
									fill="var(--color-bg)"
									stroke="var(--color-dim)"
									stroke-width={isHighlighted ? 1.6 : 1.2}
									opacity={isHighlighted ? 0.66 : 0.4}
								/>
								{#if isHighlighted}
									<text
										y="18"
										class="ghost-node-label"
										text-anchor="middle"
										font-family="var(--font-ui)"
										font-size="9"
										fill="var(--color-dim)"
										pointer-events="none"
									>
										{getShortLabel(ghost.label)}
									</text>
									<text
										y="30"
										class="ghost-node-label"
										text-anchor="middle"
										font-family="var(--font-ui)"
										font-size="8"
										fill="var(--color-dim)"
										pointer-events="none"
									>
										{formatTraceTag(ghost.reasonCode)}
									</text>
								{/if}
							</g>
						{/if}
					{/each}
				</g>
			{/if}

			<g class="nodes-group" aria-label="Graph nodes">
				{#each nodes as node, i}
					{#if positions.has(node.id)}
						{@const pos = positions.get(node.id)!}
						{@const radius = getNodeRadius(node)}
						{@const shape = getNodeSemanticShape(node)}
						{@const glyph = getNodeGlyph(node)}
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
									stroke={getNodeRingColor(node)}
									stroke-width="2"
									opacity="0.6"
								/>
							{/if}

							{#if isHighlighted && !isSelected}
								<circle
									class="node-highlight-ring"
									r={radius + 4}
									fill="none"
									stroke="var(--color-blue)"
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

							{#if shape === 'circle'}
								<circle
									r={radius}
									fill={getNodeColor(node)}
									stroke={getNodeStrokeColor(node)}
									stroke-width="2"
									opacity={getNodeOpacity(node.id)}
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
							{:else if shape === 'square'}
								<rect
									x={-radius}
									y={-radius}
									width={radius * 2}
									height={radius * 2}
									fill={getNodeColor(node)}
									stroke={getNodeStrokeColor(node)}
									stroke-width="2"
									opacity={getNodeOpacity(node.id)}
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
							{:else if shape === 'diamond'}
								<polygon
									points={getDiamondPoints(radius)}
									fill={getNodeColor(node)}
									stroke={getNodeStrokeColor(node)}
									stroke-width="2"
									opacity={getNodeOpacity(node.id)}
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
							{:else if shape === 'hexagon'}
								<polygon
									points={getHexagonPoints(radius)}
									fill={getNodeColor(node)}
									stroke={getNodeStrokeColor(node)}
									stroke-width="2"
									opacity={getNodeOpacity(node.id)}
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
							{:else}
								<rect
									x={-(radius * 1.3)}
									y={-(radius * 0.82)}
									width={radius * 2.6}
									height={radius * 1.64}
									rx={Math.max(6, radius * 0.42)}
									ry={Math.max(6, radius * 0.42)}
									fill={getNodeColor(node)}
									stroke={getNodeStrokeColor(node)}
									stroke-width="2"
									opacity={getNodeOpacity(node.id)}
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
							{/if}

							{#if glyph}
								<text
									y="4"
									class="node-glyph"
									text-anchor="middle"
									font-family="var(--font-ui)"
									font-size={glyph.length > 1 ? 8 : 10}
									fill="var(--color-text)"
									pointer-events="none"
								>
									{glyph}
								</text>
							{/if}

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
							{#if shouldRenderNodeLabel(node.id) && getNodeTraceLabel(node)}
								<text
									y={radius + 31}
									class="node-trace-label"
									text-anchor="middle"
									font-family="var(--font-ui)"
									font-size="9"
									fill="var(--color-dim)"
									pointer-events="none"
								>
									{getNodeTraceLabel(node)}
								</text>
							{/if}
						</g>
					{/if}
				{/each}
			</g>
		</g>
	</svg>

	{#if showInlineDetail && selectedNode && detailPosition}
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

	{#if activeEdge && edgeDetailPosition}
		<div
			class="edge-detail"
			style:left="{edgeDetailPosition.x}px"
			style:top="{edgeDetailPosition.y}px"
		>
			<p class="edge-detail-title">
				{activeEdge.edge.type}
				{#if activeEdge.isGhost}
					<span class="edge-detail-badge">rejected</span>
				{/if}
			</p>
			<div class="edge-chip-row">
				<span class="edge-chip">pass {formatTraceTag(getEdgePassOrigin(activeEdge.edge))}</span>
				{#if activeEdgeConfidence !== null}
					<span class="edge-chip">confidence {(activeEdgeConfidence * 100).toFixed(0)}%</span>
				{/if}
				{#if activeEdgeReasonCode}
					<span class="edge-chip is-reason">{formatTraceTag(activeEdgeReasonCode)}</span>
				{/if}
			</div>
			{#if activeEdgeRationale}
				<p class="edge-detail-line">source: {activeEdgeRationale}</p>
			{/if}
			{#if selectedEdge}
				<button type="button" class="edge-detail-close" onclick={clearSelectedEdge}>Close</button>
			{/if}
		</div>
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

	.graph-edge,
	.ghost-edge {
		cursor: pointer;
		transition: opacity 120ms ease, stroke-width 120ms ease, stroke 120ms ease;
		stroke-linecap: round;
	}

	.ghost-edge {
		stroke-linecap: round;
	}

	.ghost-node {
		cursor: default;
	}

	.ghost-node-label {
		paint-order: stroke;
		stroke: rgba(7, 8, 10, 0.95);
		stroke-width: 2px;
		text-transform: lowercase;
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

	.node-glyph {
		font-weight: 600;
		letter-spacing: 0.02em;
		paint-order: stroke;
		stroke: rgba(7, 8, 10, 0.9);
		stroke-width: 2px;
		text-transform: uppercase;
	}

	.node-label.is-visible {
		opacity: 0.95;
	}

	.node-trace-label {
		opacity: 0.92;
		user-select: none;
		paint-order: stroke;
		stroke: rgba(7, 8, 10, 0.96);
		stroke-width: 2px;
		letter-spacing: 0.02em;
		text-transform: lowercase;
	}

	.detail-backdrop {
		position: absolute;
		inset: 0;
		background: transparent;
		z-index: 90;
		user-select: none;
	}

	.edge-detail {
		position: absolute;
		transform: translate(-50%, -110%);
		z-index: 92;
		border: 1px solid var(--color-border);
		background: color-mix(in srgb, var(--color-surface) 96%, transparent);
		border-radius: var(--radius-sm);
		padding: 8px 10px;
		min-width: 210px;
		max-width: min(320px, 42vw);
		box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.edge-detail-title {
		margin: 0;
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.edge-detail-badge {
		border: 1px solid var(--color-border);
		border-radius: 999px;
		padding: 1px 6px;
		font-size: 0.62rem;
		color: var(--color-muted);
	}

	.edge-chip-row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.edge-chip {
		border: 1px solid var(--color-border);
		border-radius: 999px;
		padding: 2px 8px;
		font-family: var(--font-ui);
		font-size: 0.66rem;
		color: var(--color-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.edge-chip.is-reason {
		border-color: var(--color-copper-border);
		color: var(--color-copper);
	}

	.edge-detail-line {
		margin: 0;
		font-family: var(--font-ui);
		font-size: 0.74rem;
		color: var(--color-muted);
		line-height: 1.35;
	}

	.edge-detail-close {
		align-self: flex-start;
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text);
		border-radius: var(--radius-sm);
		padding: 3px 8px;
		font-family: var(--font-ui);
		font-size: 0.66rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		cursor: pointer;
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
