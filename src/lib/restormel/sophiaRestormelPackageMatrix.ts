/**
 * Central import surface for Restormel “dogfood” in Sophia: ensures CI resolves every
 * first-party and workspace @restormel/* dependency. See `/dev/restormel-packages`.
 */
import { AAIFRequestSchema } from '@restormel/aaif';
import { buildPassSpecificContextPacks } from '@restormel/context-packs';
import { emptyGraphData } from '@restormel/graphrag-core';
import { evaluateReasoningGraph } from '@restormel/graph-reasoning-extensions/evaluation';
import { defaultProviders, type CostEstimateResult } from '@restormel/keys';
import { isReasoningProvider } from '@restormel/providers';
import { parseReasoningEventBlock, sampleSophiaReasoningEvents, serializeReasoningEvent } from '@restormel/observability';
import { projectWorkingMemory } from '@restormel/state';
import { RelationBundleSchema } from '@restormel/reasoning-core';

const demoPolicy = { maxCellsPerScope: 8, maxApproxTokensPerScope: 4000 };

const demoCost: CostEstimateResult = {
  modelId: 'gpt-4o',
  providerId: 'openai',
  inputPerMillion: 2.5,
  outputPerMillion: 10,
  unit: 'token'
};

/** Exercised in vitest: every import above must resolve. */
export function runRestormelPackageMatrixSmoke(): {
  contextPacksBlocks: number;
  graphRagNodeCount: number;
  aaifParsed: boolean;
  keysProviders: number;
  graphEvalOk: boolean;
  observabilityRoundTrip: boolean;
  stateProjected: boolean;
  providerGate: boolean;
  reasoningSchema: boolean;
} {
  const packs = buildPassSpecificContextPacks(
    {
      claims: [],
      relations: [],
      arguments: [],
      seed_claim_ids: []
    },
    { depthMode: 'standard' }
  );
  const g = emptyGraphData();
  const aaif = AAIFRequestSchema.safeParse({
    input: 'hello',
    task: 'chat',
    user: { id: 'u1', plan: 'test' }
  });
  const evalResult = evaluateReasoningGraph({
    graph: { nodes: [], edges: [], missingData: [] },
    outputs: []
  });
  const e0 = sampleSophiaReasoningEvents[0];
  const ser = serializeReasoningEvent(e0);
  const round = parseReasoningEventBlock(ser);
  const wm = projectWorkingMemory([], demoPolicy);
  const p = isReasoningProvider('openai');
  const r = RelationBundleSchema.safeParse({
    claimId: 'c1',
    relations: [{ type: 'supports', target: 'c2', label: 'supports' }]
  });

  return {
    contextPacksBlocks: [packs.analysis, packs.critique, packs.synthesis].filter((x) => x?.block).length,
    graphRagNodeCount: g.nodes.length,
    aaifParsed: aaif.success,
    keysProviders: defaultProviders.length,
    graphEvalOk: Array.isArray(evalResult.findings),
    observabilityRoundTrip: JSON.stringify(round) === JSON.stringify(e0),
    stateProjected: typeof wm.last_sequence === 'number',
    providerGate: p === true,
    reasoningSchema: r.success
  };
}

export const demoKeysCostForDevPage: CostEstimateResult = demoCost;
