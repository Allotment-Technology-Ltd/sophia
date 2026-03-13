---
status: active
owner: adam
source_of_truth: true
last_reviewed: 2026-03-13
---

> Active Restormel platform source of truth for this topic.

# Restormel Canonical Schema Specification

## Purpose
Define the canonical data contracts that make the Restormel ecosystem interoperable across packages, APIs, site playgrounds, and the SOPHIA reference application.

The goal is to ensure that every product speaks the same language.

---

## Design principles
- Human-readable JSON first
- Strongly typed TypeScript contracts
- Validation through zod
- Product-agnostic naming
- Extensible metadata without breaking core shape
- Stable identifiers for nodes, edges, runs, and sources

---

# 1. Graph schema

## `GraphDocument`
The canonical graph payload.

```ts
export type GraphDocument = {
  schemaVersion: string
  id: string
  title?: string
  createdAt?: string
  source?: string
  metadata?: Record<string, unknown>
  nodes: GraphNode[]
  edges: GraphEdge[]
}
```

## `GraphNode`

```ts
export type GraphNode = {
  id: string
  kind: string
  label: string
  summary?: string
  status?: 'active' | 'derived' | 'candidate' | 'rejected' | 'archived'
  metadata?: Record<string, unknown>
  sourceRefs?: SourceRef[]
  scores?: {
    confidence?: number
    relevance?: number
    centrality?: number
    novelty?: number
  }
  tags?: string[]
}
```

## `GraphEdge`

```ts
export type GraphEdge = {
  id: string
  source: string
  target: string
  kind: string
  directed?: boolean
  weight?: number
  confidence?: number
  provenance?: SourceRef[]
  metadata?: Record<string, unknown>
}
```

## Recommended node kinds
- `query`
- `source`
- `document`
- `chunk`
- `claim`
- `argument`
- `evidence`
- `entity`
- `concept`
- `answer`
- `objection`
- `reply`
- `synthesis`

## Recommended edge kinds
- `supports`
- `contradicts`
- `depends_on`
- `responds_to`
- `derived_from`
- `retrieved_from`
- `mentions`
- `belongs_to`
- `cites`
- `expands`
- `answers`

---

# 2. Source schema

## `SourceRef`

```ts
export type SourceRef = {
  id: string
  label?: string
  uri?: string
  passageId?: string
  startOffset?: number
  endOffset?: number
  metadata?: Record<string, unknown>
}
```

## `SourceRecord`

```ts
export type SourceRecord = {
  id: string
  title?: string
  uri?: string
  kind?: 'web' | 'pdf' | 'note' | 'doc' | 'dataset' | 'manual' | 'other'
  checksum?: string
  metadata?: Record<string, unknown>
}
```

---

# 3. Retrieval schema

## `RetrievalTrace`

```ts
export type RetrievalTrace = {
  schemaVersion: string
  runId: string
  query: string
  startedAt?: string
  completedAt?: string
  mode?: 'quick' | 'standard' | 'deep'
  domain?: string
  steps: RetrievalStep[]
  candidates?: RetrievalCandidate[]
  seeds?: RetrievalSeed[]
  expansions?: RetrievalExpansion[]
  contextPack?: ContextPack
  graph?: GraphDocument
  metrics?: RetrievalMetrics
}
```

## `RetrievalStep`

```ts
export type RetrievalStep = {
  id: string
  kind:
    | 'query_normalized'
    | 'lexical_search'
    | 'dense_search'
    | 'candidate_merge'
    | 'rerank'
    | 'seed_select'
    | 'graph_expand'
    | 'context_pack_build'
    | 'prune'
  label: string
  startedAt?: string
  completedAt?: string
  metadata?: Record<string, unknown>
}
```

## `RetrievalCandidate`

```ts
export type RetrievalCandidate = {
  id: string
  label?: string
  sourceId?: string
  kind?: string
  scores?: {
    dense?: number
    lexical?: number
    rerank?: number
    final?: number
  }
  selected?: boolean
  rejectedReason?: string
  metadata?: Record<string, unknown>
}
```

## `RetrievalSeed`

```ts
export type RetrievalSeed = {
  id: string
  candidateId: string
  rationale?: string
  selectedAt?: string
}
```

## `RetrievalExpansion`

```ts
export type RetrievalExpansion = {
  id: string
  fromNodeId: string
  toNodeId: string
  edgeKind?: string
  hop: number
  accepted: boolean
  rationale?: string
}
```

## `RetrievalMetrics`

```ts
export type RetrievalMetrics = {
  candidateCount?: number
  seedCount?: number
  expansionCount?: number
  graphNodeCount?: number
  graphEdgeCount?: number
  durationMs?: number
}
```

---

# 4. Context pack schema

## `ContextPack`

```ts
export type ContextPack = {
  id: string
  mode?: 'shared' | 'analysis' | 'critique' | 'synthesis' | 'verification'
  query: string
  items: ContextItem[]
  metadata?: Record<string, unknown>
}
```

## `ContextItem`

```ts
export type ContextItem = {
  id: string
  kind: 'claim' | 'source' | 'document' | 'evidence' | 'argument' | 'summary'
  label?: string
  content: string
  sourceRefs?: SourceRef[]
  scores?: {
    relevance?: number
    confidence?: number
  }
  metadata?: Record<string, unknown>
}
```

---

# 5. Reasoning schema

## `ReasoningTrace`

```ts
export type ReasoningTrace = {
  schemaVersion: string
  runId: string
  query: string
  mode?: 'quick' | 'standard' | 'deep'
  startedAt?: string
  completedAt?: string
  events: ReasoningEvent[]
  passes?: PassResult[]
  graphSnapshots?: GraphDocument[]
  metrics?: ReasoningMetrics
}
```

## `ReasoningEvent`

```ts
export type ReasoningEvent =
  | { type: 'run_start'; runId: string; timestamp?: string }
  | { type: 'pass_start'; pass: PassType; timestamp?: string }
  | { type: 'pass_chunk'; pass: PassType; content: string; timestamp?: string }
  | { type: 'pass_complete'; pass: PassType; timestamp?: string }
  | { type: 'claims'; pass: PassType; claims: ClaimRecord[]; timestamp?: string }
  | { type: 'relations'; pass: PassType; relations: RelationRecord[]; timestamp?: string }
  | { type: 'sources'; pass: PassType; sources: SourceRecord[]; timestamp?: string }
  | { type: 'graph_snapshot'; graph: GraphDocument; timestamp?: string }
  | { type: 'metadata'; usage?: TokenUsage; durationMs?: number; timestamp?: string }
  | { type: 'warning'; message: string; timestamp?: string }
  | { type: 'error'; message: string; timestamp?: string }
```

## `PassType`

```ts
export type PassType = 'analysis' | 'critique' | 'synthesis' | 'verification'
```

## `PassResult`

```ts
export type PassResult = {
  pass: PassType
  content: string
  claims?: ClaimRecord[]
  relations?: RelationRecord[]
  sources?: SourceRecord[]
  metadata?: Record<string, unknown>
}
```

## `ClaimRecord`

```ts
export type ClaimRecord = {
  id: string
  text: string
  stance?: 'pro' | 'con' | 'neutral' | 'derived'
  confidence?: number
  sourceRefs?: SourceRef[]
  metadata?: Record<string, unknown>
}
```

## `RelationRecord`

```ts
export type RelationRecord = {
  id: string
  sourceClaimId: string
  targetClaimId: string
  kind: string
  confidence?: number
  metadata?: Record<string, unknown>
}
```

## `ReasoningMetrics`

```ts
export type ReasoningMetrics = {
  durationMs?: number
  provider?: string
  model?: string
  tokenUsage?: TokenUsage
}
```

## `TokenUsage`

```ts
export type TokenUsage = {
  input?: number
  output?: number
  total?: number
}
```

---

# 6. Provider schema

## `ProviderConfig`

```ts
export type ProviderConfig = {
  provider: string
  model: string
  mode?: 'hosted' | 'byok'
  region?: string
  metadata?: Record<string, unknown>
}
```

## `ModelDescriptor`

```ts
export type ModelDescriptor = {
  id: string
  provider: string
  label: string
  capabilities?: string[]
  maxContext?: number
  supportsStreaming?: boolean
  supportsJsonMode?: boolean
}
```

---

# 7. Project schema

## `ProjectConfig`

```ts
export type ProjectConfig = {
  id: string
  name: string
  defaultProvider?: ProviderConfig
  graphSchemaVersion?: string
  retrievalMode?: 'vector' | 'hybrid' | 'graphrag'
  metadata?: Record<string, unknown>
}
```

---

# 8. Interop rules

## Rule 1
Every product must accept and emit `schemaVersion`.

## Rule 2
Every run must have a stable `runId`.

## Rule 3
Every graph snapshot must be representable as `GraphDocument`.

## Rule 4
Any streaming event must be convertible into a final `ReasoningTrace`.

## Rule 5
Retrieval systems must return a trace, not just a final context list.

---

# 9. Validation strategy
- zod schemas live in `@restormel/contracts`
- JSON schema generation should be automated for docs and API reference
- schema examples should be included in docs and playground fixtures
- breaking changes require schema version bump and migration note

---

# 10. First implementation priorities
1. freeze `GraphDocument`
2. freeze `ReasoningEvent`
3. freeze `RetrievalTrace`
4. add zod validators
5. add example payload fixtures for docs, tests, and playground use
