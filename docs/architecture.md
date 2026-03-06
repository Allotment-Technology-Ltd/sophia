# SOPHIA — System Architecture

_Last updated: 2026-03-06. Reflects post-Phase-3c target architecture (MVP Pivot). See [ROADMAP.md](../ROADMAP.md) for current build status._

---

## Overview

SOPHIA is a SvelteKit application backed by a SurrealDB argument graph. The core differentiator is the **three-pass dialectical engine** (Analysis → Critique → Synthesis) combined with argument-aware retrieval from a typed philosophical knowledge graph (~7,500 claims, 27 sources). The engine runs on Vertex AI (Gemini 2.5 Pro) with Google Search grounding, output streams via SSE, and all users are authenticated via Firebase Auth.

---

## System Diagram (Target — Phase 3c)

```
User (browser, Firebase Auth mandatory)
    │  Google ID token in Authorization header
    ▼
SvelteKit App (Cloud Run, europe-west2)
    │
    ├─► Firebase Auth          — user identity, session management, admin gating
    │
    ├─► SurrealDB (GCE VM, VPC) — philosophical knowledge graph
    │       Vertex AI text-embedding-005 for query embedding
    │       → vector search + multi-hop graph traversal
    │       → structured context block injected into prompts
    │
    ├─► Gemini 2.5 Pro + Google Search Grounding (Vertex AI)
    │       Hybrid-parallel 3 passes: Analysis → [Critique after ~30%] → Synthesis
    │       Streaming text via SSE (pass_start / pass_chunk / pass_complete)
    │       Grounding sources emitted as SSE events (real URLs per pass)
    │       Inline sophia-meta block: structured claims (no separate LLM call)
    │
    ├─► Firestore
    │       users/{uid}/queries/{queryId}   — persistent cross-device history
    │       query_cache/{hash}              — server-side memoisation
    │       grounding_discoveries/{hash}    — auto-captured sources for corpus growth
    │       veracity_signals/{claimId}      — grounding vs graph confidence delta
    │
    └─► Admin Dashboard (/admin, Firebase Auth gated)
            SurrealDB stats (sources, claims, arguments)
            Firestore stats (queries, cache hit rate)
            Full operational visibility
```

---

## Key Components

### Frontend

| File | Description |
|------|-------------|
| `src/routes/+page.svelte` | Main query interface. Svelte 5 runes. Streams three-pass output. |
| `src/routes/+layout.svelte` | App shell. TopBar + panel wiring. |
| `src/routes/admin/` | Admin dashboard. Firebase Auth protected. |
| `src/lib/components/shell/TopBar.svelte` | Navigation bar (44px, Design B). |
| `src/lib/components/panel/SidePanel.svelte` | Right-side slide-in panel (380px desktop, full overlay mobile). |
| `src/lib/components/panel/TabStrip.svelte` | Panel tab navigation (Claims / Sources / History / Settings). |
| `src/lib/components/visualization/GraphCanvas.svelte` | Argument graph circle visualization. |
| `src/styles/design-tokens.css` | All CSS custom properties (Design B dark theme). |

### Backend — Server-Side

| File | Description |
|------|-------------|
| `src/lib/server/engine.ts` | Three-pass dialectical engine. Entry: `runDialecticalEngine()`. |
| `src/lib/server/vertex.ts` | Vertex AI client. `getReasoningModel()` → Gemini 2.5 Pro. |
| `src/lib/server/retrieval.ts` | Knowledge graph retrieval. `retrieveContext()` → embed → vector search → graph traversal. |
| `src/lib/server/embeddings.ts` | Vertex AI `text-embedding-005` (replaces Voyage AI). |
| `src/lib/server/db.ts` | SurrealDB HTTP SQL client. Stateless, retries, typed errors. |
| `src/lib/server/graphProjection.ts` | Converts `RetrievalResult` to graph nodes/edges for `graph_snapshot` SSE event. |
| `src/routes/api/analyse/+server.ts` | SSE endpoint. `POST { query }` → streams `pass_start / pass_chunk / pass_complete / graph_snapshot / sources / metadata / error`. |

### SSE Event Contract

```
{ type: 'pass_start',    pass: PassType }
{ type: 'pass_chunk',    pass: PassType, content: string }
{ type: 'pass_complete', pass: PassType }
{ type: 'graph_snapshot', nodes: GraphNode[], edges: GraphEdge[] }
{ type: 'sources',       pass: PassType, sources: SourceRecord[] }
{ type: 'claims',        pass: PassType, claims: Claim[] }
{ type: 'relations',     pass: PassType, relations: Relation[] }
{ type: 'metadata',      total_input_tokens, total_output_tokens, duration_ms }
{ type: 'error',         message: string }
```

where `PassType = 'analysis' | 'critique' | 'synthesis'`

---

## Ingestion Pipeline

The ingestion pipeline runs offline (scripts/), not at query time.

```
Source URL
  │
  ├─ fetch-source.ts      → fetch HTML, strip boilerplate → data/sources/{slug}.txt
  ├─ pre-scan.ts          → URL reachability + token estimate (blocks on failures)
  ├─ ingest.ts            → 7-stage pipeline per source:
  │     Stage 1: Claim extraction (Claude Sonnet via Anthropic SDK)
  │     Stage 2: Relation extraction (Claude)
  │     Stage 3: Argument grouping (Claude)
  │     Stage 4: Embedding (Voyage AI — kept for ingestion consistency)
  │     Stage 5: Gemini validation (cross-model QA, --validate flag)
  │     Stage 6: Score & filter low-confidence claims
  │     Stage 7: Store in SurrealDB (graph with typed edges)
  ├─ ingest-batch.ts      → batch runner with pipelined Phase A/B concurrency
  └─ check-status.ts      → query ingestion_log for live status
```

> **Note:** Runtime query embedding uses Vertex AI `text-embedding-005`. Ingestion embeddings use Voyage AI for corpus consistency. A one-time re-embedding migration is planned (see ROADMAP).

---

## Deployment

| Component | Detail |
|-----------|--------|
| **App** | Cloud Run (europe-west2), auto-scales 0–3 instances, 512Mi |
| **Database** | GCE VM `sophia-db` (europe-west2-b), SurrealDB on persistent disk |
| **Connectivity** | VPC connector `sophia-connector` — Cloud Run ↔ GCE internal IP |
| **Auth** | Firebase Auth (Google Sign-In). ID tokens verified server-side. |
| **History / Cache** | Firestore (europe-west2) — serverless, paired with Firebase Auth UIDs |
| **Secrets** | GCP Secret Manager — injected at container start |
| **CI/CD** | GitHub Actions → Cloud Run via Workload Identity Federation |
| **IaC** | Pulumi (`infra/`) — `pulumi up --stack production` |

---

## Key Design Decisions

**Why SurrealDB?** Graph + vector + document queries in a single query path. The argument graph requires multi-hop traversal and vector similarity in the same query — SurrealDB handles both natively without a separate vector database.

**Why three passes?** A single LLM call hedges towards consensus. Explicit role separation (Proponent / Sceptic / Synthesiser) forces genuine dialectical engagement. The Sceptic cannot synthesise; the Synthesiser must account for what the Sceptic said.

**Why Vertex AI + Google Search grounding?** Eliminates external vendor dependencies in the live query path. Grounding provides live, verified web sources per pass — output is no longer indistinguishable from a single raw LLM call.

**Why Firebase Auth?** Zero infrastructure overhead. Pairs naturally with Firestore for per-user history using UIDs. All users authenticated — no anonymous API access.

**Why Firestore for history?** Serverless, free tier sufficient for MVP, pairs with Firebase Auth UIDs for cross-device persistence. Replaces `localStorage`-only history.

---

## Reference Documents

| Document | Purpose |
|----------|---------|
| [ROADMAP.md](../ROADMAP.md) | **Single source of truth** — what is built, what is left |
| [docs/MVP-PIVOT-PLAN.md](MVP-PIVOT-PLAN.md) | Full pivot plan with Phase A–J implementation detail |
| [docs/AGENT-IMPLEMENTATION-PROMPT.md](AGENT-IMPLEMENTATION-PROMPT.md) | Agent onboarding guide for implementing the pivot |
| [docs/design/MASTER-IMPLEMENTATION-GUIDE.md](design/MASTER-IMPLEMENTATION-GUIDE.md) | Phase 3c UI implementation guide (canonical) |
| [docs/argument-graph.md](argument-graph.md) | SurrealDB schema reference |
| [docs/three-pass-engine.md](three-pass-engine.md) | Engine design and pass architecture |
| [docs/prompts-reference.md](prompts-reference.md) | All LLM prompt templates |
| [docs/evaluation-methodology.md](evaluation-methodology.md) | Evaluation rubric and test cases |
| [docs/runbooks.md](runbooks.md) | Operational commands and shortcuts |
