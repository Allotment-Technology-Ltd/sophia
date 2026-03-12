import type { RetrievalResult } from './retrieval';

export type ContextPackPass = 'analysis' | 'critique' | 'synthesis';
export type ContextPackRole = 'support' | 'objection' | 'reply' | 'definition_distinction';

export interface ContextPackStats {
  token_budget: number;
  estimated_tokens: number;
  truncated: boolean;
  claim_count: number;
  relation_count: number;
  argument_count: number;
  role_counts: Record<ContextPackRole, number>;
  reply_chain_count: number;
  unresolved_tension_count: number;
}

export interface ContextPack {
  pass: ContextPackPass;
  block: string;
  stats: ContextPackStats;
}

export interface PassSpecificContextPacks {
  analysis: ContextPack;
  critique: ContextPack;
  synthesis: ContextPack;
}

interface BuildContextPacksOptions {
  depthMode?: 'quick' | 'standard' | 'deep';
}

interface SelectedPack {
  claimIndices: number[];
  relationIndices: number[];
  argumentIndices: number[];
  roleCounts: Record<ContextPackRole, number>;
}

const EMPTY_ROLE_COUNTS: Record<ContextPackRole, number> = {
  support: 0,
  objection: 0,
  reply: 0,
  definition_distinction: 0
};

const PASS_TOKEN_BUDGET: Record<BuildContextPacksOptions['depthMode'] extends never ? never : 'quick' | 'standard' | 'deep', Record<ContextPackPass, number>> = {
  quick: { analysis: 550, critique: 520, synthesis: 620 },
  standard: { analysis: 900, critique: 860, synthesis: 1040 },
  deep: { analysis: 1300, critique: 1250, synthesis: 1500 }
};

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function roleForClaim(claimType: string, claimText: string): ContextPackRole {
  const type = claimType.toLowerCase();
  const text = claimText.toLowerCase();
  if (type === 'objection') return 'objection';
  if (type === 'response' || type === 'reply') return 'reply';
  if (type === 'definition' || text.includes('distinction')) return 'definition_distinction';
  return 'support';
}

function scoreClaimForPass(
  pass: ContextPackPass,
  role: ContextPackRole,
  confidence: number,
  isSeed: boolean,
  inContradiction: boolean,
  inReplyRelation: boolean
): number {
  let score = confidence + (isSeed ? 0.12 : 0);
  if (pass === 'analysis') {
    if (role === 'support') score += 0.18;
    if (role === 'definition_distinction') score += 0.14;
  }
  if (pass === 'critique') {
    if (role === 'objection') score += 0.3;
    if (role === 'reply') score += 0.18;
    if (inContradiction) score += 0.12;
  }
  if (pass === 'synthesis') {
    if (role === 'reply') score += 0.24;
    if (role === 'objection') score += 0.2;
    if (inContradiction) score += 0.16;
    if (inReplyRelation) score += 0.1;
  }
  return score;
}

function targetRoleWeights(pass: ContextPackPass): Record<ContextPackRole, number> {
  if (pass === 'analysis') {
    return {
      support: 0.52,
      objection: 0.12,
      reply: 0.12,
      definition_distinction: 0.24
    };
  }
  if (pass === 'critique') {
    return {
      support: 0.2,
      objection: 0.38,
      reply: 0.24,
      definition_distinction: 0.18
    };
  }
  return {
    support: 0.26,
    objection: 0.26,
    reply: 0.28,
    definition_distinction: 0.2
  };
}

function relationPriority(pass: ContextPackPass, relationType: string): number {
  if (pass === 'analysis') {
    if (relationType === 'supports') return 4;
    if (relationType === 'depends_on') return 3;
    if (relationType === 'defines' || relationType === 'qualifies') return 2;
    if (relationType === 'contradicts') return 1;
    return 0;
  }
  if (pass === 'critique') {
    if (relationType === 'contradicts') return 4;
    if (relationType === 'responds_to') return 3;
    if (relationType === 'qualifies') return 2;
    return 1;
  }
  if (relationType === 'responds_to') return 4;
  if (relationType === 'contradicts') return 3;
  if (relationType === 'supports') return 2;
  return 1;
}

function computeRoleCountsFromClaims(
  retrieval: RetrievalResult,
  claimIndices: number[]
): Record<ContextPackRole, number> {
  const counts = { ...EMPTY_ROLE_COUNTS };
  for (const idx of claimIndices) {
    const claim = retrieval.claims[idx];
    if (!claim) continue;
    counts[roleForClaim(claim.claim_type, claim.text)] += 1;
  }
  return counts;
}

function computeRoleTargets(
  weights: Record<ContextPackRole, number>,
  total: number,
  poolCounts: Record<ContextPackRole, number>
): Record<ContextPackRole, number> {
  const targets: Record<ContextPackRole, number> = { ...EMPTY_ROLE_COUNTS };
  if (total <= 0) return targets;

  const roles: ContextPackRole[] = ['support', 'objection', 'reply', 'definition_distinction'];
  const fractions: Array<{ role: ContextPackRole; frac: number }> = [];
  let used = 0;
  for (const role of roles) {
    const exact = weights[role] * total;
    const floor = Math.floor(exact);
    targets[role] = Math.min(floor, poolCounts[role]);
    used += targets[role];
    fractions.push({ role, frac: exact - floor });
  }

  fractions.sort((a, b) => b.frac - a.frac);
  while (used < total) {
    let bumped = false;
    for (const { role } of fractions) {
      if (targets[role] < poolCounts[role]) {
        targets[role] += 1;
        used += 1;
        bumped = true;
        if (used >= total) break;
      }
    }
    if (!bumped) break;
  }

  return targets;
}

function selectForPass(
  pass: ContextPackPass,
  retrieval: RetrievalResult,
  maxClaims: number
): SelectedPack {
  const seedIds = new Set(retrieval.seed_claim_ids);
  const contradictionEndpoints = new Set<number>();
  const replyEndpoints = new Set<number>();
  for (const relation of retrieval.relations) {
    if (relation.relation_type === 'contradicts') {
      contradictionEndpoints.add(relation.from_index);
      contradictionEndpoints.add(relation.to_index);
    }
    if (relation.relation_type === 'responds_to') {
      replyEndpoints.add(relation.from_index);
      replyEndpoints.add(relation.to_index);
    }
  }

  const poolRoleCounts = { ...EMPTY_ROLE_COUNTS };
  const scored = retrieval.claims.map((claim, idx) => {
    const role = roleForClaim(claim.claim_type, claim.text);
    poolRoleCounts[role] += 1;
    const score = scoreClaimForPass(
      pass,
      role,
      claim.confidence ?? 0,
      seedIds.has(claim.id),
      contradictionEndpoints.has(idx),
      replyEndpoints.has(idx)
    );
    return { idx, role, score };
  });
  scored.sort((a, b) => b.score - a.score);

  const targetCount = Math.min(maxClaims, scored.length);
  const roleTargets = computeRoleTargets(targetRoleWeights(pass), targetCount, poolRoleCounts);
  const selectedIndices: number[] = [];
  const selectedSet = new Set<number>();
  const roleCounts = { ...EMPTY_ROLE_COUNTS };

  for (const role of ['support', 'objection', 'reply', 'definition_distinction'] as const) {
    if (roleTargets[role] <= 0) continue;
    for (const item of scored) {
      if (item.role !== role || selectedSet.has(item.idx)) continue;
      selectedSet.add(item.idx);
      selectedIndices.push(item.idx);
      roleCounts[role] += 1;
      if (roleCounts[role] >= roleTargets[role]) break;
      if (selectedIndices.length >= targetCount) break;
    }
    if (selectedIndices.length >= targetCount) break;
  }

  if (selectedIndices.length < targetCount) {
    for (const item of scored) {
      if (selectedSet.has(item.idx)) continue;
      selectedSet.add(item.idx);
      selectedIndices.push(item.idx);
      roleCounts[item.role] += 1;
      if (selectedIndices.length >= targetCount) break;
    }
  }

  const selectedIndexSet = new Set(selectedIndices);
  const relationIndices = retrieval.relations
    .map((relation, idx) => ({ relation, idx }))
    .filter(({ relation }) => selectedIndexSet.has(relation.from_index) && selectedIndexSet.has(relation.to_index))
    .sort((a, b) => relationPriority(pass, b.relation.relation_type) - relationPriority(pass, a.relation.relation_type))
    .slice(0, pass === 'synthesis' ? 24 : 18)
    .map((item) => item.idx);

  const argumentIndices = retrieval.arguments
    .map((arg, idx) => ({
      idx,
      score: (arg.key_premises?.length ?? 0) + (arg.conclusion_text ? 1 : 0)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, pass === 'synthesis' ? 4 : 3)
    .map((item) => item.idx);

  return {
    claimIndices: selectedIndices,
    relationIndices,
    argumentIndices,
    roleCounts
  };
}

function buildPackBlock(
  pass: ContextPackPass,
  retrieval: RetrievalResult,
  selected: SelectedPack,
  tokenBudget: number
): { text: string; estimatedTokens: number; truncated: boolean; kept: SelectedPack } {
  let kept = selected;

  const render = (current: SelectedPack): string => {
    const lines: string[] = [];
    const claimIdMap = new Map<number, string>();

    lines.push(`=== ${pass.toUpperCase()} CONTEXT PACK ===`);
    lines.push(`Approx token budget: ${tokenBudget}`);
    lines.push('');
    lines.push('All claims include provenance (source title and claim ID).');
    lines.push('');

    current.claimIndices.forEach((claimIdx, order) => {
      const claim = retrieval.claims[claimIdx];
      const claimId = `c:${String(order + 1).padStart(3, '0')}`;
      claimIdMap.set(claimIdx, claimId);
      const role = roleForClaim(claim.claim_type, claim.text).replace('_', '/');
      lines.push(`CLAIM [${claimId}] (${role}, source: "${claim.source_title}")`);
      lines.push(`"${claim.text}"`);
      lines.push('');
    });

    if (current.relationIndices.length > 0) {
      lines.push('RELATIONS:');
      for (const relationIdx of current.relationIndices) {
        const relation = retrieval.relations[relationIdx];
        const fromId = claimIdMap.get(relation.from_index);
        const toId = claimIdMap.get(relation.to_index);
        if (!fromId || !toId) continue;
        const relType = relation.relation_type.toUpperCase().replace(/_/g, ' ');
        lines.push(`- [${fromId}] ${relType} [${toId}]`);
      }
      lines.push('');
    }

    if (current.argumentIndices.length > 0) {
      lines.push('ARGUMENTS:');
      for (const argIdx of current.argumentIndices) {
        const arg = retrieval.arguments[argIdx];
        lines.push(`- ${arg.name}${arg.tradition ? ` (${arg.tradition})` : ''}`);
        lines.push(`  ${arg.summary}`);
      }
      lines.push('');
    }

    if (pass === 'synthesis') {
      const relationSet = new Set(current.relationIndices);
      const tensionPairs: Array<{ from: number; to: number }> = [];
      for (const idx of relationSet) {
        const rel = retrieval.relations[idx];
        if (rel.relation_type === 'contradicts') {
          tensionPairs.push({ from: rel.from_index, to: rel.to_index });
        }
      }
      const replyPairs = new Set<string>();
      for (const idx of relationSet) {
        const rel = retrieval.relations[idx];
        if (rel.relation_type !== 'responds_to') continue;
        const leftRole = roleForClaim(
          retrieval.claims[rel.from_index].claim_type,
          retrieval.claims[rel.from_index].text
        );
        const rightRole = roleForClaim(
          retrieval.claims[rel.to_index].claim_type,
          retrieval.claims[rel.to_index].text
        );
        if (
          (leftRole === 'reply' && rightRole === 'objection') ||
          (leftRole === 'objection' && rightRole === 'reply')
        ) {
          replyPairs.add(`${Math.min(rel.from_index, rel.to_index)}|${Math.max(rel.from_index, rel.to_index)}`);
        }
      }
      const unresolved = tensionPairs.filter((pair) => {
        const key = `${Math.min(pair.from, pair.to)}|${Math.max(pair.from, pair.to)}`;
        return !replyPairs.has(key);
      });
      lines.push('SYNTHESIS SIGNALS:');
      lines.push(`- Reply chains: ${replyPairs.size}`);
      lines.push(`- Unresolved tensions: ${unresolved.length}`);
      lines.push('');
    }

    return lines.join('\n');
  };

  let text = render(kept);
  let estimatedTokens = estimateTokens(text);
  let truncated = false;

  while (estimatedTokens > tokenBudget && kept.claimIndices.length > 3) {
    truncated = true;
    const reducedClaimIndices = kept.claimIndices.slice(0, -1);
    const reducedIndexSet = new Set(reducedClaimIndices);
    const reducedRelationIndices = kept.relationIndices.filter((idx) => {
      const rel = retrieval.relations[idx];
      return reducedIndexSet.has(rel.from_index) && reducedIndexSet.has(rel.to_index);
    });

    kept = {
      ...kept,
      claimIndices: reducedClaimIndices,
      relationIndices: reducedRelationIndices,
      roleCounts: computeRoleCountsFromClaims(retrieval, reducedClaimIndices)
    };
    text = render(kept);
    estimatedTokens = estimateTokens(text);
  }

  return { text, estimatedTokens, truncated, kept };
}

function replyAndTensionCounts(retrieval: RetrievalResult, relationIndices: number[]): { replyChains: number; unresolvedTensions: number } {
  const selected = relationIndices.map((idx) => retrieval.relations[idx]);
  const replyPairs = new Set<string>();
  const contradictions: Array<{ from: number; to: number }> = [];

  for (const rel of selected) {
    if (rel.relation_type === 'contradicts') {
      contradictions.push({ from: rel.from_index, to: rel.to_index });
    }
    if (rel.relation_type === 'responds_to') {
      const a = retrieval.claims[rel.from_index];
      const b = retrieval.claims[rel.to_index];
      const aRole = roleForClaim(a.claim_type, a.text);
      const bRole = roleForClaim(b.claim_type, b.text);
      if (
        (aRole === 'reply' && bRole === 'objection') ||
        (aRole === 'objection' && bRole === 'reply')
      ) {
        replyPairs.add(`${Math.min(rel.from_index, rel.to_index)}|${Math.max(rel.from_index, rel.to_index)}`);
      }
    }
  }

  const unresolved = contradictions.filter((pair) => {
    const key = `${Math.min(pair.from, pair.to)}|${Math.max(pair.from, pair.to)}`;
    return !replyPairs.has(key);
  });

  return { replyChains: replyPairs.size, unresolvedTensions: unresolved.length };
}

function buildEmptyPack(pass: ContextPackPass, tokenBudget: number): ContextPack {
  return {
    pass,
    block: 'No knowledge base context available for this query.',
    stats: {
      token_budget: tokenBudget,
      estimated_tokens: estimateTokens('No knowledge base context available for this query.'),
      truncated: false,
      claim_count: 0,
      relation_count: 0,
      argument_count: 0,
      role_counts: { ...EMPTY_ROLE_COUNTS },
      reply_chain_count: 0,
      unresolved_tension_count: 0
    }
  };
}

function buildPackForPass(
  pass: ContextPackPass,
  retrieval: RetrievalResult,
  tokenBudget: number
): ContextPack {
  if (!retrieval.claims || retrieval.claims.length === 0) return buildEmptyPack(pass, tokenBudget);

  const selected = selectForPass(pass, retrieval, pass === 'synthesis' ? 14 : 12);
  const rendered = buildPackBlock(pass, retrieval, selected, tokenBudget);
  const tensionCounts = replyAndTensionCounts(retrieval, rendered.kept.relationIndices);

  return {
    pass,
    block: rendered.text,
    stats: {
      token_budget: tokenBudget,
      estimated_tokens: rendered.estimatedTokens,
      truncated: rendered.truncated,
      claim_count: rendered.kept.claimIndices.length,
      relation_count: rendered.kept.relationIndices.length,
      argument_count: rendered.kept.argumentIndices.length,
      role_counts: rendered.kept.roleCounts,
      reply_chain_count: tensionCounts.replyChains,
      unresolved_tension_count: tensionCounts.unresolvedTensions
    }
  };
}

export function buildPassSpecificContextPacks(
  retrieval: RetrievalResult,
  options: BuildContextPacksOptions = {}
): PassSpecificContextPacks {
  const depthMode = options.depthMode ?? 'standard';
  return {
    analysis: buildPackForPass('analysis', retrieval, PASS_TOKEN_BUDGET[depthMode].analysis),
    critique: buildPackForPass('critique', retrieval, PASS_TOKEN_BUDGET[depthMode].critique),
    synthesis: buildPackForPass('synthesis', retrieval, PASS_TOKEN_BUDGET[depthMode].synthesis)
  };
}
