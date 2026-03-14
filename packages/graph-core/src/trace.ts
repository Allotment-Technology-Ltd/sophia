import type { GraphNode } from '@restormel/contracts';

export function getNodeTraceTags(node: GraphNode): string[] {
  const tags: string[] = [];
  if (node.isSeed) tags.push('seed');
  else if (node.isTraversed) tags.push('traversed');
  if (node.pass_origin) tags.push(node.pass_origin);
  if (node.conflict_status && node.conflict_status !== 'none') tags.push(node.conflict_status);
  if (node.unresolved_tension_id) tags.push('tension');
  if (node.provenance_id) tags.push('provenanced');
  return tags;
}

export function getNodeTraceLabel(node: GraphNode, maxTags = 4): string {
  return getNodeTraceTags(node).slice(0, maxTags).join(' · ');
}

export function formatTraceTag(tag: string): string {
  return tag.replaceAll('_', ' ');
}
