# Argument-Native Platform Roadmap

_Date: March 12, 2026_

## Key Principle

Treat this as a platform rewrite in layers, not a single AI upgrade. The order matters because argument mining remains difficult in practice, cross-dataset transfer is still weak, and GraphRAG-style methods only pay off when the extracted structure is trustworthy. That is consistent with current benchmarks and official GraphRAG guidance.

## North Star

By the end state, SOPHIA should answer philosophical questions from an argument-native substrate:

`source -> argumentative passage -> claim -> typed relation -> balanced retrieval pack -> analysis / critique / synthesis`

and not from generic chunk retrieval. Microsoft’s GraphRAG docs explicitly position structured, hierarchical retrieval as superior to naive snippet search for complex reasoning, while argument-mining benchmarks show that relation identification and transfer remain hard enough that you need disciplined staging, confidence gating, and evaluation from day one.

## Delivery Shape

Run this as a 4-phase programme across roughly 2 quarters, with a thin enabling phase up front and a hardening phase at the end.

## Phase 0: Foundations and Control Plane

Duration: 2 weeks

Goal: create the delivery rails before changing core behaviour.

### What Ships

- Canonical data contracts for `Source`, `Passage`, `Claim`, `Relation`, `ContextPack`, `TraceRun`
- Provenance standard: every claim and edge must reference source span, extractor version, confidence, verification state
- Gold-set evaluation harness with 50–100 philosophy questions across ethics, political philosophy, metaphysics, mind, epistemology
- Baseline metrics on current SOPHIA:
  - answer quality
  - citation correctness
  - citation faithfulness proxy
  - retrieval diversity
  - objection/reply coverage
  - latency and cost

### Owners

- Tech lead
- Applied ML lead
- Backend lead
- Product/research lead

### Exit Criteria

- Schemas frozen
- Baseline dashboard live
- Test corpus agreed
- Current system benchmarked

### Why First

Without this, the team will confuse more graph objects with better reasoning. ALCE and RAGAs exist precisely because citation quality and retrieval quality need explicit measurement, and recent work on RAG attributions shows correctness is not the same as faithfulness.

## Phase 1: Ingestion Integrity

Duration: 6–8 weeks

Goal: make ingestion trustworthy enough that retrieval has something real to work with.

This is the highest-priority phase. ARIES shows argument relation identification is still challenging and not strongly transferable, so Phase 1 should optimise for precision, provenance, and debuggability, not coverage heroics.

### Stage 1.1: Argumentative Segmentation

#### Build

- Structural parser for PDF/HTML/EPUB/manual text
- Passage segmentation by argumentative unit, not token windows
- Passage role classifier:
  - thesis
  - premise
  - objection
  - reply
  - definition
  - distinction
  - example
  - interpretive commentary

Implementation note: start with an LLM-assisted pipeline plus deterministic structural heuristics. Do not aim for fully end-to-end elegance yet.

#### Ship

- Passage objects with spans, summaries, section metadata, embedding, role label, confidence

#### Exit Criteria

- 85%+ span integrity on held-out source parsing
- Human evaluators judge passage boundaries usable on at least 80% of sampled texts
- Less than 10% catastrophic split errors on objection/reply pairs

### Stage 1.2: Claim Extraction and Typing

#### Build

- 1–N claims per passage
- Claim typing:
  - source-grounded
  - interpretive
  - synthetic
  - user-generated
- Domain tags:
  - domain
  - subdomain
  - thinker
  - tradition
  - era
  - normative/descriptive/metaphilosophical/empirical

#### Ship

- Claim store with provenance, confidence, attribution, concept tags, contested-term flags

#### Exit Criteria

- 90%+ of promoted claims have source span attached
- 80%+ of sampled claims judged faithful to source
- Fewer than 5% unverifiable promoted claims

### Stage 1.3: Conservative Relation Extraction

#### Build

Only six edge types initially:

- supports
- contradicts
- responds_to
- depends_on
- defines
- qualifies

No fancy ontology yet.

#### Ship

- Relation objects with explicit/inferred flag and evidence pointers

#### Exit Criteria

- Precision target beats recall target
- Low-confidence relations routed to review queue
- No unproven `related_to` garbage edges in trusted graph

### Stage 1.4: Review Queue and Promotion Workflow

#### Build

States:

- candidate
- accepted
- rejected
- merged
- needs_review

#### Ship

- Reviewer UI or at minimum internal moderation tooling
- Merge/dedup flow that distinguishes exact duplicate, paraphrase duplicate, broader/narrower, related-not-duplicate

#### Exit Criteria

- Trusted graph separated from staging graph
- Promotion rules enforced
- Audit trail complete

### Phase 1 Milestone

At the end of Phase 1, SOPHIA has a trusted argumentative substrate for a narrow but important corpus, ideally one curated slice first:

- Rawls
- Mill
- Kant
- Aristotle
- Nagel
- Parfit
- SEP and IEP entries in selected domains

Start narrow because philosophy quality beats corpus size at this stage. Recent LLM argument-mining papers show promise, but also current limitations, which is another reason not to expand corpus too early.

Phase 1 closeout status (2026-03-12): complete. Baseline locked in [phase1-closeout-baseline-2026-03-12.md](./phase1-closeout-baseline-2026-03-12.md).

## Phase 2: Retrieval Robustness

Duration: 4–6 weeks

Goal: replace semantic nearest neighbours with balanced philosophical context assembly.

This phase should follow, not precede, ingestion. Hybrid retrieval remains best practice across modern IR stacks, and official GraphRAG guidance also supports different query modes for different reasoning tasks rather than one universal retrieval blob.

### Stage 2.1: Query Understanding

#### Build

Query decomposition service that extracts:

- domain
- subdomain
- task type
- named philosophers
- comparison vs explanation vs evaluation vs synthesis
- normative vs interpretive vs descriptive
- needed role mix

#### Ship

- `QueryPlan` object stored in trace

#### Exit Criteria

- Good routing accuracy on internal benchmark
- Fewer off-domain retrieval failures

### Stage 2.2: Hybrid Candidate Generation

#### Build

- dense retrieval over passages/claims
- lexical retrieval for exact philosophical terms
- metadata filtering
- optional GraphRAG-style local/global split for corpus-level questions

#### Ship

- fused top-K candidate set

Implementation note: keep it simple:

- BM25 or equivalent
- dense retriever
- reranker
- RRF fusion

That is the production-friendly baseline.

#### Exit Criteria

- recall improvement over vector-only baseline
- improved exact-term retrieval for phrases like public reason, epistemic injustice, non-identity problem

### Stage 2.3: Seed Diversification and Stance Balancing

#### Build

- MMR for candidate diversity
- stance/role balancing quotas:
  - support
  - objection
  - reply
  - definition/distinction

#### Ship

- seed set constructor with balance stats

#### Exit Criteria

- lower redundancy in retrieved sets
- measurable increase in objection/reply presence
- no mono-perspective top-K packs on benchmark queries

### Stage 2.4: Pass-Specific Context Packs

#### Build

Three separate retrieval products:

- analysis pack
- critique pack
- synthesis pack

#### Ship

- context pack builder with token budgeting and provenance preservation

#### Exit Criteria

- answers show clearer role separation
- critique pass stops rephrasing analysis pass
- synthesis pass includes reply chains and unresolved tensions

### Phase 2 Milestone

At the end of Phase 2, SOPHIA should already feel materially better to users, even before any deeper graph traversal:

- fewer shallow answers
- more balanced responses
- better exact term handling
- clearer provenance

## Phase 3: Dialectical Graph Intelligence

Duration: 4–5 weeks

Goal: move from good retrieval to philosophically shaped reasoning.

This is where SOPHIA becomes distinct in-market.

### Stage 3.1: Closure Logic

#### Build

For each major thesis, retrieval should try to include:

- one objection
- one reply to that objection

#### Ship

- closure-enforcement layer in retrieval assembler

#### Exit Criteria

- majority of benchmark answers contain complete thesis-objection-reply units where the corpus supports them

### Stage 3.2: Controlled Graph Expansion

#### Build

- 1–3 hop traversal
- hop decay
- edge priors
- confidence thresholds
- domain-aware expansion

#### Ship

- beam traversal only on trusted edges

#### Exit Criteria

- quality gain without drift
- graph traversal improves answer completeness more than it harms precision

### Stage 3.3: Philosophical Map and Trace UI

#### Build

Visible trace for each answer:

- query decomposition
- seeds chosen
- expansions used
- pruning decisions
- balance stats
- closure stats
- provenance confidence

#### Ship

- user-facing or internal debug trace
- map tab upgrade

#### Exit Criteria

- support team and researchers can explain answer assembly
- graph failures are debuggable in minutes, not hours

### Why This Phase Matters

GraphRAG’s official docs and Microsoft project updates show that structured query modes, dynamic community selection, and local/global hybrid reasoning are practical, not just theoretical. SOPHIA’s version should adapt that idea from entity/community graphs to claim/dialectic graphs.

## Phase 4: Hardening and Frontier Bets

Duration: 3–4 weeks for hardening, then ongoing

Goal: turn a strong prototype into a market-leading product.

### Stage 4.1: Attribution Hardening

#### Build

- statement-level citation attachment
- citation-faithfulness checks
- provenance violation alarms
- answer blocking or downgrade on low-grounding outputs

#### Exit Criteria

- citation correctness up
- faithfulness proxy up
- fewer polished-but-unjustified claims

### Stage 4.2: Corpus Expansion

#### Build

Expand only after Phase 1–3 metrics hold on the initial corpus.

Expansion order:

- canonical texts in chosen domains
- SEP/IEP
- secondary literature
- modern papers and essays
- user/private corpora

### Stage 4.3: Frontier Experiments Worth Running

These are the bleeding-edge ideas that are realistic enough to explore, not science projects.

#### A. Key-Point Layer for Debate Compression

A KPA-style summarisation layer over claim clusters to surface dominant positions and avoid paraphrase clutter. IBM’s Project Debater and KPA work are still among the strongest practical reference points for large-scale argument summarisation.

#### B. Claim-First GraphRAG

Use GraphRAG concepts, but index claims and relations, not just entities and communities. That is likely the most important strategic adaptation for SOPHIA.

#### C. Dialectic Retrieval Policies

Productionise different retrieval policies for:

- exegesis
- adversarial critique
- comparison
- reconciliation
- user-position challenge

#### D. BenchmarkQED-Style Evaluation Discipline

Microsoft now explicitly surfaces BenchmarkQED alongside GraphRAG; SOPHIA should mirror that mindset with its own philosophy benchmark suite.

## What Each Team Should Do

### Applied ML

- segmentation
- claim extraction
- relation extraction
- reranking
- role classification
- evaluation set annotation

### Backend / Platform

- schemas
- graph store
- index orchestration
- provenance storage
- trace logging
- promotion workflows

### Product / Research

- gold questions
- domain coverage priorities
- reviewer rubric
- market-differentiating UX around maps and trace

### Design

- provenance UI
- map UI
- answer trace
- confidence signalling

## Release Plan

### Release 1: Trustworthy Ingestion Alpha

When: end of Phase 1

What users notice: fewer hallucinated interpretations, better source traceability

### Release 2: Dialectical Retrieval Beta

When: end of Phase 2

What users notice: more balanced answers, stronger objections, clearer distinctions

### Release 3: Argument-Native SOPHIA v1

When: end of Phase 3

What users notice: genuinely philosophical structure in answers, not just eloquence

### Release 4: Market Leader Hardening

When: end of Phase 4

What users notice: trust, transparency, and repeatable depth
