import type { GraphEdge, GraphNode } from '@restormel/contracts';

export interface LayoutPosition {
  x: number;
  y: number;
}

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

  const sources = nodes.filter((node) => node.type === 'source');
  const claims = nodes.filter((node) => node.type === 'claim');

  sources.forEach((node, index) => {
    const angle = (index / sources.length) * Math.PI * 2 - Math.PI / 2;
    positions.set(node.id, {
      x: centerX + Math.cos(angle) * outerRadius,
      y: centerY + Math.sin(angle) * outerRadius
    });
  });

  const claimsBySource = new Map<string, GraphNode[]>();
  for (const claim of claims) {
    const sourceEdge = edges.find((edge) => edge.to === claim.id && edge.type === 'contains');
    const sourceId = sourceEdge?.from || 'orphan';
    if (!claimsBySource.has(sourceId)) claimsBySource.set(sourceId, []);
    claimsBySource.get(sourceId)?.push(claim);
  }

  for (const [sourceId, sourceClaims] of claimsBySource) {
    const sourcePos = positions.get(sourceId);
    const baseAngle = sourcePos
      ? Math.atan2(sourcePos.y - centerY, sourcePos.x - centerX)
      : 0;

    sourceClaims.forEach((claim, index) => {
      const offset = (index - sourceClaims.length / 2) * 0.3;
      const angle = baseAngle + offset;
      const radius = innerRadius + claim.id.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % 20 - 10;
      positions.set(claim.id, {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius
      });
    });
  }

  return positions;
}
