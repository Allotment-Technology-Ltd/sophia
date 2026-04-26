import { generateText } from 'ai';
import { z } from 'zod';
import type { ClaimType, ConstitutionalCheck, ConstitutionRule, RuleEvaluation } from '@restormel/contracts/constitution';
import { ConstitutionalCheckSchema, RuleEvaluationSchema } from '@restormel/contracts/constitution';
import type { ExtractedClaim, ExtractedRelation } from '$lib/types/verification';
import { resolveReasoningModelRoute, trackTokens } from '$lib/server/vertex';
import type { ProviderApiKeys } from '$lib/server/byok/types';
import {
  buildConstitutionEvalUserPrompt,
  CONSTITUTION_EVAL_SYSTEM_PROMPT
} from '$lib/server/prompts/constitution-eval';
import { EPISTEMIC_RULES } from './rules';

const RULE_INDEX = new Map(EPISTEMIC_RULES.map((rule) => [rule.id, rule]));
const LLM_RULE_IDS = new Set([
  'proportional_evidence',
  'alternative_hypotheses',
  'assumption_transparency',
  'uncertainty_signalling'
]);
const ACKNOWLEDGEMENT_RELATIONS = new Set(['qualifies', 'refines']);
const CAUSAL_MECHANISM_TYPES = new Set<ClaimType>(['causal', 'explanatory']);
const DESCRIPTIVE_TYPES = new Set<ClaimType>(['empirical', 'causal', 'predictive', 'explanatory']);
const SCOPE_RANK: Record<ExtractedClaim['scope'], number> = {
  narrow: 0,
  moderate: 1,
  broad: 2,
  universal: 3
};

const LlmRuleEvaluationSchema = z.object({
  rule_id: z.string().min(1),
  status: z.enum(['satisfied', 'violated', 'uncertain', 'not_applicable']),
  affected_claim_ids: z.array(z.string()).default([]),
  rationale: z.string().min(1),
  remediation: z.string().min(1).optional()
});

interface LlmEvaluationBatchResult {
  evaluations: RuleEvaluation[];
  inputTokens: number;
  outputTokens: number;
  llmCalled: boolean;
  llmFailed: boolean;
  provider?: string;
  modelId?: string;
  routeReason?: string | null;
}

export interface ConstitutionEvaluationTelemetry {
  constitution_input_tokens: number;
  constitution_output_tokens: number;
  constitution_llm_called: boolean;
  constitution_llm_failed: boolean;
  constitution_rule_violations: string[];
  constitution_provider?: string;
  constitution_model?: string;
  constitution_route_reason?: string | null;
}

export interface ConstitutionEvaluationResult {
  check: ConstitutionalCheck;
  telemetry: ConstitutionEvaluationTelemetry;
}

function getRule(ruleId: string): ConstitutionRule {
  const rule = RULE_INDEX.get(ruleId);
  if (!rule) {
    throw new Error(`Unknown epistemic rule: ${ruleId}`);
  }
  return rule;
}

function createEvaluation(
  rule: ConstitutionRule,
  status: RuleEvaluation['status'],
  affectedClaimIds: string[],
  rationale: string,
  remediation?: string
): RuleEvaluation {
  return RuleEvaluationSchema.parse({
    rule_id: rule.id,
    rule_name: rule.name,
    status,
    severity: rule.severity,
    affected_claim_ids: [...new Set(affectedClaimIds)],
    rationale,
    remediation
  });
}

function claimsById(claims: ExtractedClaim[]): Map<string, ExtractedClaim> {
  return new Map(claims.map((claim) => [claim.id, claim]));
}

function incomingSupporters(
  claimId: string,
  relations: ExtractedRelation[],
  byId: Map<string, ExtractedClaim>
): ExtractedClaim[] {
  return relations
    .filter((relation) => relation.relation_type === 'supports' && relation.to_claim_id === claimId)
    .map((relation) => byId.get(relation.from_claim_id))
    .filter((claim): claim is ExtractedClaim => Boolean(claim));
}

function hasCitation(claim: ExtractedClaim): boolean {
  if (claim.source_span?.trim()) return true;
  return typeof claim.source_span_start === 'number' && typeof claim.source_span_end === 'number';
}

function sourceKey(claim: ExtractedClaim): string {
  if (claim.source_span?.trim()) {
    return `span:${claim.source_span.trim().toLowerCase()}`;
  }

  if (typeof claim.source_span_start === 'number' && typeof claim.source_span_end === 'number') {
    return `offset:${claim.source_span_start}-${claim.source_span_end}`;
  }

  return 'unknown';
}

function extractJsonArray(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    return trimmed.slice(firstBracket, lastBracket + 1);
  }

  throw new Error('Could not find JSON array in LLM response');
}

function parseLlmEvaluations(text: string): z.infer<typeof LlmRuleEvaluationSchema>[] {
  const raw = JSON.parse(extractJsonArray(text));
  return z.array(LlmRuleEvaluationSchema).parse(raw);
}

function fallbackLlmEvaluations(rules: ConstitutionRule[], reason: string): RuleEvaluation[] {
  return rules.map((rule) =>
    createEvaluation(
      rule,
      'uncertain',
      [],
      `LLM constitutional evaluation unavailable: ${reason}`
    )
  );
}

function finalizeEvaluations(allEvaluations: RuleEvaluation[]): ConstitutionalCheck {
  const ordered = EPISTEMIC_RULES.map((rule) => {
    return (
      allEvaluations.find((evaluation) => evaluation.rule_id === rule.id) ??
      createEvaluation(rule, 'uncertain', [], 'Rule evaluation missing from constitution pipeline.')
    );
  });

  const satisfied = ordered.filter((evaluation) => evaluation.status === 'satisfied');
  const violated = ordered.filter((evaluation) => evaluation.status === 'violated');
  const uncertain = ordered.filter((evaluation) => evaluation.status === 'uncertain');
  const notApplicable = ordered.filter((evaluation) => evaluation.status === 'not_applicable');

  const criticalViolations = violated.filter((evaluation) => evaluation.severity === 'critical').length;
  const warningViolations = violated.filter((evaluation) => evaluation.severity === 'warning').length;
  const overallCompliance = criticalViolations > 0 ? 'fail' : warningViolations > 1 ? 'partial' : 'pass';

  return ConstitutionalCheckSchema.parse({
    rules_evaluated: ordered.length,
    satisfied,
    violated,
    uncertain,
    not_applicable: notApplicable,
    overall_compliance: overallCompliance
  });
}

function isRuleApplicable(rule: ConstitutionRule, claimType: ClaimType): boolean {
  return rule.applies_to.includes(claimType);
}

function buildDependencyGraph(relations: ExtractedRelation[]): Map<string, string[]> {
  const graph = new Map<string, string[]>();

  for (const relation of relations) {
    if (relation.relation_type !== 'depends_on') continue;
    const current = graph.get(relation.from_claim_id) ?? [];
    current.push(relation.to_claim_id);
    graph.set(relation.from_claim_id, current);
  }

  return graph;
}

function collectDependencies(
  rootClaimId: string,
  graph: Map<string, string[]>
): string[] {
  const visited = new Set<string>([rootClaimId]);
  const collected = new Set<string>();
  const queue: string[] = [...(graph.get(rootClaimId) ?? [])];

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) continue;
    if (visited.has(next)) continue;
    visited.add(next);
    collected.add(next);

    const children = graph.get(next);
    if (!children) {
      continue;
    }

    for (const child of children) {
      if (!visited.has(child)) {
        queue.push(child);
      }
    }
  }

  return [...collected];
}

function collectRule2Heuristics(claims: ExtractedClaim[], relations: ExtractedRelation[]): string[] {
  const rule = getRule('proportional_evidence');
  const byId = claimsById(claims);

  return claims
    .filter((claim) => isRuleApplicable(rule, claim.claim_type))
    .filter((claim) => claim.scope === 'broad' || claim.scope === 'universal')
    .filter((claim) => incomingSupporters(claim.id, relations, byId).length < 2)
    .map((claim) => claim.id);
}

async function evaluateLlmRules(
  claims: ExtractedClaim[],
  relations: ExtractedRelation[],
  originalText: string,
  options?: { providerApiKeys?: ProviderApiKeys }
): Promise<LlmEvaluationBatchResult> {
  const llmRules = EPISTEMIC_RULES.filter((rule) => LLM_RULE_IDS.has(rule.id));
  if (llmRules.length === 0) {
    return {
      evaluations: [],
      inputTokens: 0,
      outputTokens: 0,
      llmCalled: false,
      llmFailed: false
    };
  }

  const heuristics = {
    proportional_evidence_low_support_claim_ids: collectRule2Heuristics(claims, relations)
  };

  const prompt = buildConstitutionEvalUserPrompt(claims, relations, llmRules, originalText, heuristics);
  const route = await resolveReasoningModelRoute({
    pass: 'verification',
    depthMode: 'standard',
    providerApiKeys: options?.providerApiKeys,
    failureMode: 'error'
  });

  try {
    const result = await generateText({
      model: route.model,
      system: CONSTITUTION_EVAL_SYSTEM_PROMPT,
      prompt,
      maxOutputTokens: 1400
    });

    trackTokens(result.usage?.inputTokens ?? 0, result.usage?.outputTokens ?? 0);

    const parsed = parseLlmEvaluations(result.text);
    const byRuleId = new Map(parsed.map((evaluation) => [evaluation.rule_id, evaluation]));

    const evaluations = llmRules.map((rule) => {
      const raw = byRuleId.get(rule.id);
      if (!raw) {
        return createEvaluation(
          rule,
          'uncertain',
          [],
          'LLM response omitted this rule from the batch output.'
        );
      }

      return createEvaluation(
        rule,
        raw.status,
        raw.affected_claim_ids,
        raw.rationale,
        raw.status === 'violated'
          ? (raw.remediation ?? `Revise claims to satisfy ${rule.name.toLowerCase()}.`)
          : undefined
      );
    });

    return {
      evaluations,
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      llmCalled: true,
      llmFailed: false,
      provider: route.provider,
      modelId: route.modelId,
      routeReason: route.resolvedExplanation ?? null
    };
  } catch (error) {
    return {
      evaluations: fallbackLlmEvaluations(
        llmRules,
        error instanceof Error ? error.message : String(error)
      ),
      inputTokens: 0,
      outputTokens: 0,
      llmCalled: true,
      llmFailed: true,
      provider: route.provider,
      modelId: route.modelId,
      routeReason: route.resolvedExplanation ?? null
    };
  }
}

export function checkEvidenceRequirement(
  claims: ExtractedClaim[],
  relations: ExtractedRelation[]
): RuleEvaluation {
  const rule = getRule('evidence_requirement');
  const byId = claimsById(claims);
  const applicableClaims = claims.filter((claim) => isRuleApplicable(rule, claim.claim_type));

  if (applicableClaims.length === 0) {
    return createEvaluation(
      rule,
      'not_applicable',
      [],
      'No empirical, causal, or predictive claims were extracted.'
    );
  }

  const unsupported = applicableClaims
    .filter((claim) => incomingSupporters(claim.id, relations, byId).length === 0 && !hasCitation(claim))
    .map((claim) => claim.id);

  if (unsupported.length > 0) {
    return createEvaluation(
      rule,
      'violated',
      unsupported,
      'Some factual claims have neither supporting relations nor citation evidence.',
      'Add supporting evidence relations or explicit citation passages for each flagged claim.'
    );
  }

  return createEvaluation(
    rule,
    'satisfied',
    applicableClaims.map((claim) => claim.id),
    'All factual claims include support relations or citation evidence.'
  );
}

export function checkContradictionAwareness(
  claims: ExtractedClaim[],
  relations: ExtractedRelation[]
): RuleEvaluation {
  const rule = getRule('contradiction_awareness');
  const byId = claimsById(claims);

  const contradictions = relations.filter((relation) => {
    if (relation.relation_type !== 'contradicts') return false;

    const from = byId.get(relation.from_claim_id);
    const to = byId.get(relation.to_claim_id);
    if (!from || !to) return false;

    return isRuleApplicable(rule, from.claim_type) || isRuleApplicable(rule, to.claim_type);
  });

  if (contradictions.length === 0) {
    return createEvaluation(
      rule,
      'not_applicable',
      [],
      'No contradiction relations were extracted for applicable claim types.'
    );
  }

  const unaddressed = contradictions.filter((contradiction) => {
    return !relations.some((relation) => {
      if (!ACKNOWLEDGEMENT_RELATIONS.has(relation.relation_type)) return false;

      const sameDirection =
        relation.from_claim_id === contradiction.from_claim_id &&
        relation.to_claim_id === contradiction.to_claim_id;
      const reverseDirection =
        relation.from_claim_id === contradiction.to_claim_id &&
        relation.to_claim_id === contradiction.from_claim_id;

      return sameDirection || reverseDirection;
    });
  });

  if (unaddressed.length > 0) {
    const affected = unaddressed.flatMap((relation) => [relation.from_claim_id, relation.to_claim_id]);
    return createEvaluation(
      rule,
      'violated',
      affected,
      'Contradiction relations exist but are not reconciled or qualified in the argument graph.',
      'Explicitly address contradictory claims by qualifying, refining, or resolving the tension.'
    );
  }

  return createEvaluation(
    rule,
    'satisfied',
    contradictions.flatMap((relation) => [relation.from_claim_id, relation.to_claim_id]),
    'Detected contradictions are explicitly acknowledged through qualifying/refining links.'
  );
}

export function checkScopeDiscipline(
  claims: ExtractedClaim[],
  relations: ExtractedRelation[]
): RuleEvaluation {
  const rule = getRule('scope_discipline');
  const byId = claimsById(claims);
  const applicableClaims = claims.filter((claim) => isRuleApplicable(rule, claim.claim_type));

  if (applicableClaims.length === 0) {
    return createEvaluation(
      rule,
      'not_applicable',
      [],
      'No empirical, causal, or predictive claims were extracted.'
    );
  }

  const exceededScope: string[] = [];
  const insufficientSupport: string[] = [];

  for (const claim of applicableClaims) {
    const supporters = incomingSupporters(claim.id, relations, byId);
    if (supporters.length === 0) {
      insufficientSupport.push(claim.id);
      continue;
    }

    const maxSupportScope = Math.max(...supporters.map((supporter) => SCOPE_RANK[supporter.scope]));
    if (SCOPE_RANK[claim.scope] > maxSupportScope) {
      exceededScope.push(claim.id);
    }
  }

  if (exceededScope.length > 0) {
    return createEvaluation(
      rule,
      'violated',
      exceededScope,
      'At least one claim has broader scope than its supporting evidence.',
      'Narrow the scope of flagged claims or add broader evidence before making universal statements.'
    );
  }

  if (insufficientSupport.length > 0) {
    return createEvaluation(
      rule,
      'uncertain',
      insufficientSupport,
      'Some claims lack enough support to determine whether scope is disciplined.'
    );
  }

  return createEvaluation(
    rule,
    'satisfied',
    applicableClaims.map((claim) => claim.id),
    'Claim scope is consistent with the scope of supporting evidence.'
  );
}

export function checkCorrelationVsCausation(
  claims: ExtractedClaim[],
  relations: ExtractedRelation[]
): RuleEvaluation {
  const rule = getRule('correlation_vs_causation');
  const byId = claimsById(claims);
  const causalClaims = claims.filter((claim) => isRuleApplicable(rule, claim.claim_type));

  if (causalClaims.length === 0) {
    return createEvaluation(
      rule,
      'not_applicable',
      [],
      'No causal claims were extracted.'
    );
  }

  const violated: string[] = [];
  const insufficient: string[] = [];

  for (const claim of causalClaims) {
    const supporters = incomingSupporters(claim.id, relations, byId);
    if (supporters.length === 0) {
      insufficient.push(claim.id);
      continue;
    }

    const allSupportersEmpirical = supporters.every((supporter) => supporter.claim_type === 'empirical');
    const hasMechanismSupport = relations.some((relation) => {
      if (relation.to_claim_id !== claim.id) return false;
      if (relation.relation_type === 'contradicts') return false;

      const source = byId.get(relation.from_claim_id);
      if (!source) return false;
      return CAUSAL_MECHANISM_TYPES.has(source.claim_type);
    });

    if (allSupportersEmpirical && !hasMechanismSupport) {
      violated.push(claim.id);
    }
  }

  if (violated.length > 0) {
    return createEvaluation(
      rule,
      'violated',
      violated,
      'Some causal claims are supported only by correlational evidence without mechanism claims.',
      'Add causal mechanism claims or weaken causal wording to reflect correlational support.'
    );
  }

  if (insufficient.length > 0) {
    return createEvaluation(
      rule,
      'uncertain',
      insufficient,
      'Some causal claims lack enough structured support to assess correlation-vs-causation risk.'
    );
  }

  return createEvaluation(
    rule,
    'satisfied',
    causalClaims.map((claim) => claim.id),
    'Causal claims include mechanism-level support or non-correlational evidence.'
  );
}

export function checkNormativeBridge(
  claims: ExtractedClaim[],
  relations: ExtractedRelation[]
): RuleEvaluation {
  const rule = getRule('normative_bridge_requirement');
  const byId = claimsById(claims);
  const dependencyGraph = buildDependencyGraph(relations);
  const normativeClaims = claims.filter((claim) => isRuleApplicable(rule, claim.claim_type));

  if (normativeClaims.length === 0) {
    return createEvaluation(
      rule,
      'not_applicable',
      [],
      'No normative claims were extracted.'
    );
  }

  const violated: string[] = [];
  const uncertain: string[] = [];

  for (const claim of normativeClaims) {
    const directDependencies = dependencyGraph.get(claim.id) ?? [];
    if (directDependencies.length === 0) {
      uncertain.push(claim.id);
      continue;
    }

    const dependencyIds = collectDependencies(claim.id, dependencyGraph);
    const hasMissingNodes = dependencyIds.some((dependencyId) => !byId.has(dependencyId));
    const dependencyClaims = dependencyIds
      .map((dependencyId) => byId.get(dependencyId))
      .filter((c): c is ExtractedClaim => Boolean(c));

    if (dependencyClaims.length === 0 || hasMissingNodes) {
      uncertain.push(claim.id);
      continue;
    }

    const hasNormativePremise = dependencyClaims.some(
      (dependencyClaim) => dependencyClaim.claim_type === 'normative'
    );
    if (hasNormativePremise) {
      continue;
    }

    const onlyDescriptive = dependencyClaims.every((dependencyClaim) =>
      DESCRIPTIVE_TYPES.has(dependencyClaim.claim_type)
    );
    const hasEmpiricalOrCausal = dependencyClaims.some((dependencyClaim) =>
      dependencyClaim.claim_type === 'empirical' || dependencyClaim.claim_type === 'causal'
    );

    if (onlyDescriptive && hasEmpiricalOrCausal) {
      violated.push(claim.id);
    } else {
      uncertain.push(claim.id);
    }
  }

  if (violated.length > 0) {
    return createEvaluation(
      rule,
      'violated',
      violated,
      'Normative conclusions rely on descriptive premises without an explicit normative bridge.',
      'Add at least one explicit normative premise linking descriptive evidence to the normative conclusion.'
    );
  }

  if (uncertain.length > 0) {
    return createEvaluation(
      rule,
      'uncertain',
      uncertain,
      'Some normative claims do not expose enough dependency structure to verify a normative bridge.'
    );
  }

  return createEvaluation(
    rule,
    'satisfied',
    normativeClaims.map((claim) => claim.id),
    'Normative claims include explicit normative premises in their dependency chains.'
  );
}

export function checkSourceDiversity(
  claims: ExtractedClaim[],
  relations: ExtractedRelation[]
): RuleEvaluation {
  const rule = getRule('source_diversity');
  const byId = claimsById(claims);
  const targetClaims = claims.filter((claim) => {
    if (!isRuleApplicable(rule, claim.claim_type)) return false;
    return claim.scope === 'broad' || claim.scope === 'universal';
  });

  if (targetClaims.length === 0) {
    return createEvaluation(
      rule,
      'not_applicable',
      [],
      'No broad or universal empirical/causal/predictive claims were extracted.'
    );
  }

  const singleSourceClaims: string[] = [];
  const uncertainClaims: string[] = [];

  for (const claim of targetClaims) {
    const supporters = incomingSupporters(claim.id, relations, byId);
    if (supporters.length === 0) {
      uncertainClaims.push(claim.id);
      continue;
    }

    const uniqueSources = new Set(supporters.map((supporter) => sourceKey(supporter)));
    if (uniqueSources.size <= 1) {
      singleSourceClaims.push(claim.id);
    }
  }

  if (singleSourceClaims.length > 0) {
    return createEvaluation(
      rule,
      'violated',
      singleSourceClaims,
      'Broad claims are supported by only one identifiable source stream.',
      'Add independent supporting evidence from multiple distinct sources.'
    );
  }

  if (uncertainClaims.length > 0) {
    return createEvaluation(
      rule,
      'uncertain',
      uncertainClaims,
      'Some broad claims have no support links, so source diversity cannot be measured.'
    );
  }

  return createEvaluation(
    rule,
    'satisfied',
    targetClaims.map((claim) => claim.id),
    'Broad claims are supported by multiple distinct source streams.'
  );
}

export async function evaluateConstitution(
  claims: ExtractedClaim[],
  relations: ExtractedRelation[],
  originalText: string,
  options?: { providerApiKeys?: ProviderApiKeys }
): Promise<ConstitutionalCheck> {
  const result = await evaluateConstitutionWithTelemetry(claims, relations, originalText, options);
  return result.check;
}

export async function evaluateConstitutionWithTelemetry(
  claims: ExtractedClaim[],
  relations: ExtractedRelation[],
  originalText: string,
  options?: { providerApiKeys?: ProviderApiKeys }
): Promise<ConstitutionEvaluationResult> {
  const deterministicEvaluations: RuleEvaluation[] = [
    checkEvidenceRequirement(claims, relations),
    checkContradictionAwareness(claims, relations),
    checkScopeDiscipline(claims, relations),
    checkCorrelationVsCausation(claims, relations),
    checkNormativeBridge(claims, relations),
    checkSourceDiversity(claims, relations)
  ];

  const llmBatchResult = await evaluateLlmRules(claims, relations, originalText, options);
  const allEvaluations = [...deterministicEvaluations, ...llmBatchResult.evaluations];
  const check = finalizeEvaluations(allEvaluations);
  const constitutionRuleViolations = check.violated.map((evaluation) => evaluation.rule_id);

  return {
    check,
    telemetry: {
      constitution_input_tokens: llmBatchResult.inputTokens,
      constitution_output_tokens: llmBatchResult.outputTokens,
      constitution_llm_called: llmBatchResult.llmCalled,
      constitution_llm_failed: llmBatchResult.llmFailed,
      constitution_rule_violations: constitutionRuleViolations,
      constitution_provider: llmBatchResult.provider,
      constitution_model: llmBatchResult.modelId,
      constitution_route_reason: llmBatchResult.routeReason ?? null
    }
  };
}
