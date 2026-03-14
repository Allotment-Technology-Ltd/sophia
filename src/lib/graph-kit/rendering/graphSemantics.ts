import { graphCanvasEdgeKey, type GraphCanvasEdgeSemanticStyle, type GraphCanvasNodeSemanticStyle } from '$lib/components/visualization/semanticStyles';
import type { GraphKitEdge, GraphKitNode, GraphKitGraphViewModel } from '$lib/graph-kit/types';

function nodeStyleForKind(node: GraphKitNode): GraphCanvasNodeSemanticStyle {
  switch (node.kind) {
    case 'query':
      return {
        kind: node.kind,
        shape: 'rounded-rect',
        fill: 'var(--color-blue-bg)',
        stroke: 'var(--color-blue)',
        glyph: '?',
        radius: 15
      };
    case 'evidence':
      return {
        kind: node.kind,
        shape: 'square',
        fill: 'var(--color-teal-bg)',
        stroke: 'var(--color-teal)',
        glyph: 'E',
        radius: 12,
        state: 'verified'
      };
    case 'source':
      return {
        kind: node.kind,
        shape: 'rounded-rect',
        fill: 'color-mix(in srgb, var(--color-surface-raised) 82%, var(--color-teal-bg))',
        stroke: 'var(--color-teal)',
        glyph: 'S',
        radius: 18,
        state: 'verified'
      };
    case 'inference':
      return {
        kind: node.kind,
        shape: 'diamond',
        fill: 'var(--color-blue-bg)',
        stroke: 'var(--color-blue)',
        glyph: 'I',
        radius: 13
      };
    case 'conclusion':
      return {
        kind: node.kind,
        shape: 'hexagon',
        fill: 'var(--color-blue-bg)',
        stroke: 'var(--color-blue)',
        glyph: 'C',
        radius: 15
      };
    case 'contradiction':
      return {
        kind: node.kind,
        shape: 'diamond',
        fill: 'var(--color-coral-bg)',
        stroke: 'var(--color-coral)',
        glyph: '!',
        radius: 13,
        state: 'contradicted'
      };
    case 'synthesis':
      return {
        kind: node.kind,
        shape: 'hexagon',
        fill: 'var(--color-purple-bg)',
        stroke: 'var(--color-purple)',
        glyph: 'Sy',
        radius: 15,
        state: 'synthesis'
      };
    case 'claim':
    default:
      return {
        kind: node.kind,
        shape: 'circle',
        fill: 'color-mix(in srgb, var(--color-surface-raised) 74%, var(--color-teal-bg))',
        stroke: 'var(--color-teal)',
        glyph: 'C',
        radius: 12,
        state: node.status === 'verified' ? 'verified' : undefined
      };
  }
}

function edgeStyleForKind(edge: GraphKitEdge): GraphCanvasEdgeSemanticStyle {
  switch (edge.kind) {
    case 'supports':
      return {
        kind: edge.kind,
        stroke: 'var(--color-teal)',
        strokeWidth: 1.6,
        marker: 'arrow-teal',
        state: 'verified'
      };
    case 'contradicts':
      return {
        kind: edge.kind,
        stroke: 'var(--color-coral)',
        strokeWidth: 1.8,
        dasharray: '8 5',
        marker: 'arrow-coral',
        state: 'contradicted'
      };
    case 'derived-from':
      return {
        kind: edge.kind,
        stroke: 'var(--color-blue)',
        strokeWidth: 1.4,
        dasharray: '7 4',
        marker: 'arrow-blue'
      };
    case 'cites':
      return {
        kind: edge.kind,
        stroke: 'var(--color-teal)',
        strokeWidth: 1.2,
        dasharray: '3 4',
        marker: 'arrow-teal'
      };
    case 'retrieved-from':
      return {
        kind: edge.kind,
        stroke: 'var(--color-teal)',
        strokeWidth: 1.2,
        dasharray: '2 5',
        marker: 'arrow-teal'
      };
    case 'inferred-by':
      return {
        kind: edge.kind,
        stroke: 'var(--color-blue)',
        strokeWidth: 1.4,
        dasharray: '10 4 2 4',
        marker: 'arrow-blue'
      };
    case 'unresolved':
      return {
        kind: edge.kind,
        stroke: 'var(--color-amber)',
        strokeWidth: 1.4,
        dasharray: '4 5',
        marker: 'arrow-amber',
        state: 'unresolved'
      };
    case 'resolves':
      return {
        kind: edge.kind,
        stroke: 'var(--color-purple)',
        strokeWidth: 1.5,
        marker: 'arrow-purple',
        state: 'synthesis'
      };
    case 'contains':
      return {
        kind: edge.kind,
        stroke: 'var(--color-teal)',
        strokeWidth: 1.1,
        dasharray: '2 4',
        marker: 'none'
      };
    case 'responds-to':
      return {
        kind: edge.kind,
        stroke: 'var(--color-blue)',
        strokeWidth: 1.4,
        marker: 'arrow-blue'
      };
    case 'depends-on':
      return {
        kind: edge.kind,
        stroke: 'var(--color-amber)',
        strokeWidth: 1.4,
        marker: 'arrow-amber',
        state: 'unresolved'
      };
    case 'defines':
      return {
        kind: edge.kind,
        stroke: 'var(--color-blue)',
        strokeWidth: 1.2,
        dasharray: '6 4',
        marker: 'arrow-blue'
      };
    case 'qualifies':
      return {
        kind: edge.kind,
        stroke: 'var(--color-amber)',
        strokeWidth: 1.2,
        dasharray: '3 5',
        marker: 'arrow-amber',
        state: 'unresolved'
      };
    case 'assumes':
    default:
      return {
        kind: edge.kind,
        stroke: 'var(--color-dim)',
        strokeWidth: 1.1,
        dasharray: '4 6',
        marker: 'none'
      };
  }
}

export function buildGraphSemanticStyles(graph: GraphKitGraphViewModel): {
  nodeStyles: Record<string, GraphCanvasNodeSemanticStyle>;
  edgeStyles: Record<string, GraphCanvasEdgeSemanticStyle>;
} {
  const nodeStyles: Record<string, GraphCanvasNodeSemanticStyle> = {};
  const edgeStyles: Record<string, GraphCanvasEdgeSemanticStyle> = {};

  for (const node of graph.nodes) {
    nodeStyles[node.id] = nodeStyleForKind(node);
  }

  for (const edge of graph.edges) {
    edgeStyles[graphCanvasEdgeKey({
      from: edge.from,
      to: edge.to,
      type: edge.kind
    })] = edgeStyleForKind(edge);
  }

  return { nodeStyles, edgeStyles };
}
