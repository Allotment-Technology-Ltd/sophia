---
status: active
owner: engineering
source_of_truth: true
last_reviewed: 2026-04-10
---

# Graph, RAG, and ingestion — unified architecture overview

This document consolidates how the SOPHIA reference app wires together **knowledge storage**, **argument-aware retrieval**, **graph visualization**, and **durable ingestion**. Use it as a baseline when exploring agentic RAG, neuro-symbolic directions, or Restormel platform extraction.

For product positioning and doc boundaries, see [architecture.md](./architecture.md) and [current-state.md](./current-state.md).

---

## 1. System shape (what talks to what)

```text
Browser (SvelteKit)
  → Reasoning APIs (`/api/analyse`, `/api/verify`, …)
  → SurrealDB — argument graph (claims, relations, arguments, sources, embeddings, ingestion_log)
  → Firestore / Neon — account state, and (when DATABASE_URL is set) operational documents + ingest orchestration
  → Provider APIs — LLM calls, embeddings (e.g. Voyage), optional Vertex
```

- **Symbolic / graph layer:** SurrealDB holds the typed philosophical graph (see [Argument Graph Schema](../reference/architecture/argument-graph.md)).
- **Orchestration durability:** When `DATABASE_URL` is configured, Neon (Postgres) backs **ingest run state**, **multi-URL ingestion jobs**, staging partials, and related operator surfaces — see `src/lib/server/neon/datastore.ts` (`isNeonIngestPersistenceEnabled`).

---

## 2. Retrieval: navigating the graph for RAG

Server-side retrieval is implemented in `src/lib/server/retrieval.ts`. The documented pipeline is:

1. **Embed** the user query (Voyage).
2. **Vector search** for top-K similar claims (Surreal vector / KNN-style usage).
3. **Graph traversal** from each seed claim along typed edges (e.g. `depends_on`, `supports`, `contradicts`, `responds_to`, …).
4. **Dedupe**, **resolve inter-claim relations**, **load argument structure** (conclusion + key premises).

Hybrid / lexical helpers and **seed-set construction** (`src/lib/server/seedSetConstructor.ts`) shape *which* neighborhoods enter the context — viewpoint coverage and inspectability, not only raw similarity.

**Important behavior:** Retrieval is written to **degrade gracefully** (empty result on failure) so the multi-pass reasoning engine can still run when the graph or embeddings are unavailable.

---

## 3. From retrieval result to on-screen graph (projection)

`src/lib/server/engine.ts` calls `projectRetrievalToGraph(retrievalResult)` from `src/lib/server/graphProjection.ts`.

That function delegates to **`projectGraph`** from `@restormel/graph-reasoning-extensions/projection`, turning a `RetrievalResult` into a **portable graph snapshot** (`GraphNode` / `GraphEdge` + meta) aligned with Restormel contracts. This is the main **bridge** between *database-backed symbolic retrieval* and *Restormel graph semantics* used in the UI and tooling.

---

## 4. Visualization and “querying” the graph in the product

### 4.1 Rendering stack

- **`@restormel/ui-graph-svelte`** — `GraphCanvas`, pan/zoom, selection, semantic styling hooks.
- **`@restormel/graph-core`** — workspace/focus/filter primitives (neighborhood scope, path focus, kind filters).
- **SOPHIA graph kit** — `src/lib/graph-kit/` adapts SOPHIA sessions into `GraphKitWorkspaceData`, applies filters, trace stepping, and inspector payloads.

`GraphWorkspace.svelte` composes the canvas with toolbar, trace panel, and inspector; it uses:

- **Workspace state** (`src/lib/graph-kit/state/workspace.ts`) — selection path focus, readability warnings, kind toggles.
- **Focus / neighborhood** (`src/lib/graph-kit/state/focus.ts`) — `collectNeighborhoodScope`, `isolateGraphToScope` from graph-core.
- **Query / filter** (`src/lib/graph-kit/state/query.ts`) — `filterWorkspaceData`, inspector builders, trace filtering.

Semantic colors and edge/node styling live in `src/lib/graph-kit/rendering/graphSemantics.ts`.

### 4.2 Where it appears in the app

- **`/map/workspace`** — primary standalone graph workspace (`src/routes/map/workspace/+page.svelte`).
- **`/map`** — entry that can open the workspace (`src/routes/map/+page.svelte`).
- **`/dev/graph-portability`** — Restormel package smoke / parity surface.

### 4.3 What “querying” means here

There is **no ad-hoc Cypher/SurrealQL editor** in the main product path for end users. Instead:

- **Retrieval** is the server-side graph+vector query.
- The **UI** filters and focuses the **projected snapshot** (node/edge kinds, neighborhood depth, trace-linked focus, search string in the workspace).

For **raw schema and example SurrealQL**, use the reference doc [argument-graph.md](../reference/architecture/argument-graph.md).

---

## 5. Durable ingestion pipeline

### 5.1 Stages (knowledge → Surreal)

The main CLI pipeline is `scripts/ingest.ts`: **Extract → Relate → Group → Embed → Validate → Store**, with progress and resumability tracked in SurrealDB’s **`ingestion_log`** (see file header comments). The canonical LLM stage definitions and fallbacks for the production profile are in `src/lib/ingestionCanonicalPipeline.ts`.

Operational scripts in `package.json` include `ingest:safe`, `ingest:nightly`, wave/batch helpers, and DB setup (`setup-schema`, vector audit, etc.).

### 5.2 Durability in Neon (when enabled)

If `DATABASE_URL` is set:

- **`ingest_runs`** — persisted runs spawned from admin ingest flows, with snapshots/logs (`src/lib/server/ingestRuns.ts`, `src/lib/server/db/ingestRunRepository.ts`).
- **`ingestion_jobs` / `ingestion_job_items` / `ingestion_job_events`** — multi-URL jobs; items spawn child runs (`src/lib/server/ingestionJobs.ts`).
- **Poller** — `scripts/ingestion-job-poller.ts` ticks running jobs (intended for GCP Cloud Run or similar long-lived workers).
- **Supporting tables** — e.g. ingest staging partials, LLM stage health, optional concurrency gates (`src/lib/server/db/schema.ts`).

Neon holds **orchestration and staging**; **authoritative graph content** for reasoning remains in Surreal after a successful store phase.

### 5.3 Safe / prod-oriented scripts

- `scripts/run-ingestion-safe.ts` — validates source identity and supports controlled local-then-migrate vs direct-prod modes (see script header and args).

### 5.4 Trace contracts (reasoning, not ingestion store)

`@restormel/contracts` includes trace-ingestion shapes; SOPHIA maps reasoning events toward normalized run traces for the graph workspace. See [restormel-trace-ingestion-compatibility-note.md](../restormel/04-delivery/restormel-trace-ingestion-compatibility-note.md) for scope and limits (snapshot-first timeline vs full event replay).

---

## 6. Restormel packages (platform boundary)

Published npm packages used in this repo (see root `package.json`) include:

| Package | Role |
|--------|------|
| `@restormel/graph-core` | Graph view model / workspace contract v0 |
| `@restormel/ui-graph-svelte` | `GraphCanvas` and UI |
| `@restormel/graph-reasoning-extensions` | Projection, compare, evaluation helpers |
| `@restormel/contracts` | API/trace/reasoning DTOs |
| `@restormel/observability` | Trace normalization helpers |

Source-of-truth for extracted packages is the Restormel Keys monorepo (see `docs/restormel/phase1-restormel-engineering-spec.md`).

---

## 7. Pointers for deeper reading

| Topic | Document |
|--------|----------|
| Live architecture summary | [architecture.md](./architecture.md) |
| Product / repo positioning | [current-state.md](./current-state.md) |
| Surreal schema & example queries | [argument-graph.md](../reference/architecture/argument-graph.md) |
| Retrieval vs GraphRAG producer roles | [restormel-retrieval-graphrag-producer-note.md](../restormel/04-delivery/restormel-retrieval-graphrag-producer-note.md) |
| Trace ↔ reasoning-object seam | [restormel-trace-ingestion-compatibility-note.md](../restormel/04-delivery/restormel-trace-ingestion-compatibility-note.md) |
| GCP / Neon / Surreal deployment constraints | [gcp-exit-unified-migration-review.md](./gcp-exit-unified-migration-review.md) |

---

## 8. Implications for agentic RAG / neuro-symbolic exploration

**Already in place:** a **symbolic graph** with **vector seeds** and **multi-hop traversal**, **projection** to a portable graph snapshot, and a **workspace UI** for inspection — plus a **resumable ingestion** path into Surreal and **Neon-backed** job/run durability for operators.

**Typical extension axes (not prescriptive):** richer planner loops on top of retrieval, explicit rule or ontology layers, verification hooks, or deeper trace/replay — each can attach at retrieval, projection, or contract boundaries above without collapsing them into one monolith.
