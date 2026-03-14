export type GraphCanvasNodeShape =
  | 'circle'
  | 'square'
  | 'diamond'
  | 'hexagon'
  | 'rounded-rect';

export interface GraphCanvasNodeSemanticStyle {
  kind: string;
  shape: GraphCanvasNodeShape;
  fill: string;
  stroke: string;
  glyph?: string;
  radius?: number;
  state?: 'default' | 'verified' | 'unresolved' | 'contradicted' | 'synthesis';
}

export interface GraphCanvasEdgeSemanticStyle {
  kind: string;
  stroke: string;
  strokeWidth?: number;
  dasharray?: string;
  marker?: 'arrow-blue' | 'arrow-teal' | 'arrow-coral' | 'arrow-amber' | 'arrow-purple' | 'none';
  state?: 'default' | 'verified' | 'unresolved' | 'contradicted' | 'synthesis';
}

export function graphCanvasEdgeKey(edge: {
  from: string;
  to: string;
  type: string;
}): string {
  return `${edge.from}:${edge.type}:${edge.to}`;
}
