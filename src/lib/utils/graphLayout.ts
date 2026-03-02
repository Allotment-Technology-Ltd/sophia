import type { GraphNode, GraphEdge } from '$lib/types/api';

export interface LayoutPosition {
	x: number;
	y: number;
}

/**
 * Computes a simple orbital layout for graph nodes.
 * Sources positioned in outer ring, claims clustered by source in inner positions.
 */
export function computeLayout(
	nodes: GraphNode[],
	edges: GraphEdge[],
	width: number,
	height: number
): Map<string, LayoutPosition> {
	const positions = new Map<string, LayoutPosition>();
	const centerX = width / 2;
	const centerY = height / 2;
	const outerRadius = Math.min(width, height) * 0.35;
	const innerRadius = outerRadius * 0.6;

	// Separate sources and claims
	const sources = nodes.filter((n) => n.type === 'source');
	const claims = nodes.filter((n) => n.type === 'claim');

	// Position sources in outer ring
	sources.forEach((node, i) => {
		const angle = (i / sources.length) * Math.PI * 2 - Math.PI / 2;
		positions.set(node.id, {
			x: centerX + Math.cos(angle) * outerRadius,
			y: centerY + Math.sin(angle) * outerRadius
		});
	});

	// Position claims in inner cluster
	// Group by connected source for better layout
	const claimsBySource = new Map<string, GraphNode[]>();
	for (const claim of claims) {
		const sourceEdge = edges.find((e) => e.to === claim.id && e.type === 'contains');
		const sourceId = sourceEdge?.from || 'orphan';
		if (!claimsBySource.has(sourceId)) {
			claimsBySource.set(sourceId, []);
		}
		claimsBySource.get(sourceId)!.push(claim);
	}

	for (const [sourceId, sourceClaims] of claimsBySource) {
		const sourcePos = positions.get(sourceId);
		const baseAngle = sourcePos
			? Math.atan2(sourcePos.y - centerY, sourcePos.x - centerX)
			: 0;

		sourceClaims.forEach((claim, i) => {
			const offset = (i - sourceClaims.length / 2) * 0.3;
			const angle = baseAngle + offset;
			const radius = innerRadius + (Math.random() - 0.5) * 20; // slight jitter
			positions.set(claim.id, {
				x: centerX + Math.cos(angle) * radius,
				y: centerY + Math.sin(angle) * radius
			});
		});
	}

	return positions;
}
