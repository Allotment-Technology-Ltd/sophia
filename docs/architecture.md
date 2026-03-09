# Architecture

**Last updated:** 2026-03-09
**Version:** 0.2.0 (Phase 3c deployed; Phase 3d in progress)

---

## Overview

SOPHIA is a SvelteKit full-stack application backed by a SurrealDB argument graph and deployed on GCP. The core is a **three-pass dialectical engine** that runs three sequential LLM calls (Analysis → Critique → Synthesis) against a typed philosophical knowledge graph (~7,500 claims, 25 sources). Output streams progressively to the browser via Server-Sent Events. All users are authenticated via Firebase Auth; query history and server-side cache are stored in Firestore.

---

## System diagram

```text
Browser (Firebase Auth — Google OAuth mandatory)
    │  Google ID token in Authorization header
    ▼
SvelteKit App  ──  Cloud Run (europe-west2, 0–3 instances, 512Mi)
    │
    ├─► hooks.server.ts
    │       Verify Firebase ID token on every /api/* request
    │       Attach uid to locals.user; reject 401 if missing/invalid
    │       Check Firestore rate limit (20 queries/day per uid)
    │
    ├─► /api/analyse  (POST { query })
    │       1. Check Firestore cache — if hit, replay stored SSE events
    │       2. Embed query: Vertex AI text-embedding-005 (768-dim)
    │       3. Retrieve context: SurrealDB vector search + graph traversal
    │       4. Run three-pass engine (streaming SSE to client)
    │              Pass 1 Analysis  ─── Vertex AI Gemini 2.5 Flash
    │              Pass 2 Critique  ─── (starts after Pass 1 ~30% complete)
    │              Pass 3 Synthesis ─── (starts after Pass 2 complete)
    │              Each pass: Google Search Grounding → real URLs per pass
    │              Each pass: inline sophia-meta block → structured claims
    │       5. Write result to Firestore cache + user history
    │
    ├─► /api/verify  (POST { query, synthesis })
    │       Optional fourth pass — cross-checks key claims against live search
    │       Returns five-tier confidence: High/Medium/Low/Interpretive/Unsupported
    │       Streams SSE — same event contract as /api/analyse
    │
    ├─► /api/history  (GET → list 50 most recent | DELETE { id })
    │       Firestore users/{uid}/queries — scoped to authenticated uid
    │
    ├─► SurrealDB  (GCE VM sophia-db, europe-west2-b, VPC-connected)
    │       Philosophical knowledge graph
    │       Tables: source, claim, argument, relation, ingestion_log
    │       Indexes: MTREE vector index on claim.embedding (768-dim, COSINE)
    │
    └─► Firestore  (europe-west2, serverless)
            users/{uid}/queries/{autoId}   — persistent history (30-day TTL)
            users/{uid}/rateLimits/daily   — rate-limit counter
            query_cache/{hash}             — server-side memoisation
```

---

## Key components

### Frontend

| File | Description |
| --- | --- |
| `src/routes/+page.svelte` | Main query interface. Three states: QUERY / LOADING / RESULTS. Svelte 5 runes. |
| `src/routes/+layout.svelte` | App shell. Auth guard, TopBar, SidePanel wiring, padding for fixed nav. |
| `src/routes/admin/` | Admin dashboard — SurrealDB + Firestore stats. Firebase Auth gated. |
| `src/lib/components/shell/TopBar.svelte` | Fixed 44px navigation bar. Auth state, context display. |
| `src/lib/components/panel/SidePanel.svelte` | Slide-in panel (380px desktop / full overlay mobile). Claims, Sources, History, Settings tabs. |
| `src/lib/components/visualization/GraphCanvas.svelte` | Argument graph circle visualisation. Infrastructure present; full "Map" tab not yet complete. |
| `src/styles/design-tokens.css` | All CSS custom properties (Design B dark theme). |

### Backend — server-side

| File | Description |
| --- | --- |
| `src/lib/server/engine.ts` | Three-pass dialectical engine. Entry: `runDialecticalEngine()`. Contains `MVP_DOMAIN_FILTER = 'ethics'` — remove this when Philosophy of Mind ingestion clears quality gates. |
| `src/lib/server/vertex.ts` | Vertex AI client. `getReasoningModel()` → Gemini 2.5 Flash. `getGroundingTool()` → Google Search Grounding. `embedQuery()` → `text-embedding-005`. |
| `src/lib/server/retrieval.ts` | Knowledge graph retrieval. `retrieveContext()` → embed → vector search → graph traversal → context block. |
| `src/lib/server/db.ts` | SurrealDB HTTP SQL client. Stateless, retries, typed errors. |
| `src/lib/server/rateLimit.ts` | Firestore-backed per-user rate limiting. Transactional counter; 429 on breach. |
| `src/lib/server/firebase-admin.ts` | Firebase Admin SDK initialisation; ID token verification. |
| `src/lib/server/graphProjection.ts` | Converts `RetrievalResult` to graph nodes/edges for the `graph_snapshot` SSE event. |
| `src/lib/server/prompts/` | LLM prompt templates: `analysis.ts`, `critique.ts`, `synthesis.ts`, `verification.ts`. |
| `src/routes/api/analyse/+server.ts` | SSE endpoint. Orchestrates cache check → retrieval → engine → Firestore write. |

### SSE event contract

All streaming endpoints (`/api/analyse`, `/api/verify`) emit this event set:

```typescript
{ type: 'pass_start',     pass: PassType }
{ type: 'pass_chunk',     pass: PassType, content: string }
{ type: 'pass_complete',  pass: PassType }
{ type: 'graph_snapshot', nodes: GraphNode[], edges: GraphEdge[] }
{ type: 'sources',        pass: PassType, sources: SourceRecord[] }
{ type: 'claims',         pass: PassType, claims: Claim[] }
{ type: 'relations',      pass: PassType, relations: Relation[] }
{ type: 'metadata',       total_input_tokens: number, total_output_tokens: number, duration_ms: number }
{ type: 'error',          message: string }

// PassType = 'analysis' | 'critique' | 'synthesis' | 'verification'
```

### Reactive stores (Svelte 5 runes)

| Store | Key state | Key actions |
| --- | --- | --- |
| `conversation.svelte.ts` | `messages`, `isLoading`, `currentPass`, `questionCount` | `submitQuery()`, `runVerification()`, `clear()` |
| `referencesStore` | `claims`, `relations`, `sources`, `groundingSources`, `isLive` | Updated by SSE events |
| `historyStore` | `items` | `syncFromServer()`, `addEntry()`, `getCachedResult()` |
| `graphStore` | `nodes`, `edges` | `reset()`, `addGroundingSources()` |
| `panelStore` | `open`, `activeTab` | `toggle()`, `openPanel()` |

---

## Ingestion pipeline

Runs offline (scripts/), not at query time. Produces the SurrealDB knowledge graph.

```text
Source URL
  │
  ├─ curate-source.ts   — URL reachability, PDF detection, duplicate check, token estimate
  ├─ fetch-source.ts    — Fetch HTML, strip boilerplate → data/sources/{slug}.txt
  ├─ pre-scan.ts        — Mandatory gate: cost estimate, blockers; exits non-zero on failure
  └─ ingest.ts          — 7-stage pipeline per source:
        Stage 1: Claim extraction     — Claude Sonnet (Anthropic SDK)
        Stage 2: Relation extraction  — Claude Sonnet
        Stage 3: Argument grouping    — Claude Sonnet
        Stage 4: Embedding            — Voyage AI (1024-dim) ← see note below
        Stage 5: Gemini validation    — Gemini cross-model QA (--validate flag)
        Stage 6: Score & filter       — Low-confidence claims quarantined
        Stage 7: Store                — SurrealDB (typed graph with edges)
```

**Embedding inconsistency (known issue, Phase 3d-A1):** The ethics corpus was ingested with Voyage AI embeddings (1024-dim). The runtime query path uses Vertex AI `text-embedding-005` (768-dim). Retrieval works across the dimension gap because both are normalised for cosine similarity, but a full re-embedding migration (`scripts/reembed-corpus.ts`) is required before expanding to new domains. The MTREE index dimension must also be updated (1024 → 768). This is the primary blocker for Phase 3e.

---

## Deployment

| Component | Detail |
| --- | --- |
| **App** | Cloud Run (europe-west2), auto-scales 0–3 instances, 512Mi RAM |
| **Database** | GCE VM `sophia-db` (europe-west2-b), SurrealDB on persistent disk |
| **Connectivity** | VPC connector `sophia-connector` — Cloud Run ↔ GCE internal IP (no public DB exposure) |
| **Auth** | Firebase Auth (Google Sign-In). ID tokens verified server-side via Firebase Admin SDK. |
| **History / Cache** | Firestore (europe-west2) — serverless, paired with Firebase Auth UIDs |
| **Secrets** | GCP Secret Manager — injected at container start |
| **CI/CD** | GitHub Actions → Cloud Run via Workload Identity Federation (keyless) |
| **IaC** | Pulumi (`infra/`) — `pulumi up --stack production` |

---

## Key design decisions

**Why SurrealDB?**
The argument graph requires multi-hop traversal and vector similarity in the same query. SurrealDB handles both natively without a separate vector database or ORM join complexity. A single SurrealQL query can embed, vector-search, and graph-traverse in one round trip.

**Why three passes?**
A single LLM call hedges towards consensus. Explicit role separation (Proponent / Sceptic / Synthesiser) forces genuine dialectical engagement. The Sceptic cannot synthesise; the Synthesiser must account for what the Sceptic said. This prevents the model from performing balance rather than reasoning through tension. See [three-pass-engine.md](three-pass-engine.md).

**Why Vertex AI + Google Search Grounding?**
Grounding provides real, verifiable web sources per pass — output is no longer indistinguishable from a raw LLM call. Keeping both the LLM and grounding on the same GCP platform simplifies auth (ADC, no external vendor API keys in the hot path) and reduces latency.

**Why Firebase Auth?**
Zero infrastructure overhead for auth. Pairs naturally with Firestore for per-user history using UIDs. Every user is authenticated — no anonymous API access, which simplifies rate limiting and audit.

**Why Firestore for history/cache?**
Serverless, free-tier sufficient for MVP. Per-user paths (`users/{uid}/...`) pair directly with Firebase Auth UIDs. The cache layer means repeat queries cost nothing — important for demo traffic where the same questions are asked repeatedly.

**Why an MVP domain filter?**
The knowledge graph covers 25 sources but currently only the ethics domain is populated. Exposing non-ethics queries to the full retrieval pipeline before other domains are ingested would return empty or misleading context. The filter (`MVP_DOMAIN_FILTER = 'ethics'` in `engine.ts`) is temporary and will be removed when Philosophy of Mind ingestion clears quality gates.

---

## Known technical constraints

| Constraint | Impact | Resolution |
| --- | --- | --- |
| Embedding dimension mismatch (Voyage AI 1024-dim vs. Vertex AI 768-dim) | Must re-embed corpus before domain expansion; MTREE index must be rebuilt | Phase 3d-A1: `reembed-corpus.ts` + index migration |
| Three sequential LLM calls | ~15–25s end-to-end latency per query | Inherent to dialectical architecture; disclosed to users; Critique starts at ~30% of Pass 1 to reduce perceived wait |
| MVP domain filter hardcoded in engine | Non-ethics queries get no knowledge graph context | Remove after Phase 3e quality gate passes |
| SurrealDB on single GCE VM | No HA; if VM goes down, queries degrade to no-graph mode | GCE persistent disk + graceful degradation; HA is a post-MVP concern |
| Phase 1 evaluation self-assessed | Preliminary results not statistically robust | Formal evaluation planned for Phase 6 |

---

## Reference documents

| Document | Purpose |
| --- | --- |
| [ROADMAP.md](../ROADMAP.md) | Phase plan and development priorities |
| [STATUS.md](../STATUS.md) | Current deployment health and feature status |
| [docs/argument-graph.md](argument-graph.md) | SurrealDB schema reference — tables, relation types, SurrealQL examples |
| [docs/three-pass-engine.md](three-pass-engine.md) | Engine design, per-pass contract, example output |
| [docs/evaluation-methodology.md](evaluation-methodology.md) | Evaluation rubric, Phase 1 results, limitations |
| [docs/runbooks/domain-expansion-runbook.md](runbooks/domain-expansion-runbook.md) | Operational guide for adding a new philosophical domain |
