# SOPHIA — System Architecture

## Overview

SOPHIA is a SvelteKit application backed by a SurrealDB argument graph, using the Anthropic Claude API for philosophical reasoning. The core differentiator is the three-pass dialectical engine combined with argument-aware retrieval from a typed knowledge graph.

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          User (Browser)                             │
└──────────────────────────────┬──────────────────────────────────────┘
                               │  HTTPS
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│              SvelteKit App (Google Cloud Run)                       │
│                                                                     │
│  ┌─────────────────┐    ┌──────────────────────────────────────┐   │
│  │  +page.svelte   │    │   POST /api/analyse (SSE stream)     │   │
│  │  (UI, Svelte 5) │◄───┤                                      │   │
│  └─────────────────┘    │   1. Parse query                     │   │
│                         │   2. Retrieve graph context          │   │
│                         │   3. Run 3-pass engine               │   │
│                         │   4. Stream chunks to client         │   │
│                         └──────────────┬─────────────────────-┘   │
└──────────────────────────────────────── │ ──────────────────────────┘
                                          │
                    ┌─────────────────────┼────────────────────┐
                    │                     │                    │
                    ▼                     ▼                    ▼
          ┌─────────────────┐  ┌──────────────────┐  ┌───────────────┐
          │   SurrealDB     │  │  Claude API       │  │  Voyage AI    │
          │   (GCE VM)      │  │  (Anthropic)      │  │  (Embeddings) │
          │                 │  │                   │  │               │
          │  Argument graph │  │  3 API calls per  │  │  Query embed  │
          │  Vector index   │  │  query (Analysis, │  │  for vector   │
          │  Graph traversal│  │  Critique,        │  │  search       │
          │                 │  │  Synthesis)       │  │               │
          └─────────────────┘  └──────────────────┘  └───────────────┘
```

## Components

### Frontend (`src/routes/+page.svelte`)

- Svelte 5 with runes (`$state`, `$derived`, `$effect`)
- Reads SSE stream from `/api/analyse`
- Displays three passes progressively as chunks arrive
- Shows pass labels (Analysis / Critique / Synthesis) with streaming text

### API Endpoint (`src/routes/api/analyse/+server.ts`)

- Accepts `POST { query: string, lens?: string }`
- Opens a `ReadableStream` for SSE
- Calls `runDialecticalEngine()` with SSE callbacks
- Sends `pass_start`, `pass_chunk`, `pass_complete`, `metadata`, `error` events

### Dialectical Engine (`src/lib/server/engine.ts`)

- Entry point: `runDialecticalEngine(query, callbacks, options)`
- Retrieves argument-graph context from SurrealDB
- Calls Claude API three times sequentially, accumulating pass outputs
- Each pass receives the context block + prior pass outputs
- Callbacks stream chunks back to the SSE endpoint in real time

### Retrieval (`src/lib/server/retrieval.ts`)

- Entry point: `retrieveContext(query)` → `RetrievalResult`
- Pipeline: embed → vector search → graph traversal → dedup → relation resolve → format
- Returns `claims[]`, `relations[]`, `arguments[]`
- Gracefully degrades to empty result if SurrealDB is unavailable

### Database (`src/lib/server/db.ts`)

- Singleton SurrealDB client, lazy-initialised on first query
- Connection pooling via the singleton pattern
- All queries use the `query()` wrapper which handles reconnection

### Prompts (`src/lib/server/prompts/`)

- `analysis.ts` — Proponent prompt: strongest case(s) for each position
- `critique.ts` — Sceptic prompt: objections, hidden assumptions, counterarguments
- `synthesis.ts` — Synthesiser prompt: integrate perspectives, map disagreements
- `extraction.ts` — Ingestion: extract claims from source text
- `relations.ts` — Ingestion: identify typed inter-claim relations
- `grouping.ts` — Ingestion: cluster claims into arguments
- `validation.ts` — Ingestion: Gemini cross-validation of extracted claims

### Admin Dashboard (`src/routes/admin/`)

- Knowledge base monitoring: claim counts, source coverage, ingestion status
- Not authenticated in development; protected in production

## Ingestion Pipeline

```
Source URL
  │
  ├─ fetch-source.ts    → fetch HTML/PDF, strip boilerplate, save .txt + .meta.json
  ├─ ingest.ts          → 7-pass pipeline:
  │     1. Load source text
  │     2. Extract claims (Claude)
  │     3. Extract inter-claim relations (Claude)
  │     4. Group claims into arguments (Claude)
  │     5. Validate with Gemini (cross-model QA)
  │     6. Score and filter low-confidence claims
  │     7. Embed claims (Voyage AI) and store in SurrealDB
  └─ verify-db.ts       → integrity checks
```

## Deployment

- **App**: Cloud Run (europe-west2), auto-scales 0–3 instances, 512Mi
- **Database**: GCE VM `sophia-db` (europe-west2-b), SurrealDB on persistent disk
- **Connectivity**: VPC connector `sophia-connector` for Cloud Run → GCE internal IP
- **Secrets**: GCP Secret Manager (API keys injected at container start)
- **Auth**: GitHub Actions → GCP via Workload Identity Federation (no long-lived keys)

## Key Design Decisions

**Why SurrealDB?** Graph + vector + document queries in a single query path, without needing separate vector and graph databases. The argument graph schema requires multi-hop graph traversal and vector similarity in the same query — SurrealDB handles both natively.

**Why three passes instead of one?** A single LLM call tends to hedge towards consensus. Explicit role separation (Proponent / Sceptic / Synthesiser) forces each pass to do its job without softening for politeness. The Critic cannot synthesise; the Synthesiser must account for what the Critic said.

**Why Voyage AI for embeddings?** Higher recall on long philosophical texts compared to OpenAI Ada in Phase 1 testing. The philosophy corpus uses technical vocabulary that benefits from domain-tuned embeddings.

**Why Gemini for ingestion validation?** Cross-model validation reduces model-specific bias in claim extraction. If Claude extracts a claim that Gemini rates as unsupported, that claim is flagged for review rather than automatically ingested.
