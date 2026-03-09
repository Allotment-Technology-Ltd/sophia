# SOPHIA

**A structured philosophical reasoning engine combining a typed argument graph with a three-pass dialectical LLM pipeline.**

[![Deploy to Cloud Run](https://github.com/Allotment-Technology-Ltd/sophia/actions/workflows/deploy.yml/badge.svg)](https://github.com/Allotment-Technology-Ltd/sophia/actions/workflows/deploy.yml)

**[Live demo →](https://sophia-210020077715.europe-west2.run.app)** *(Google account required)*

Try: *"Is moral relativism defensible?"* or *"Can consequentialism justify torture in ticking-bomb cases?"*

---

## What it is

SOPHIA is a research prototype testing whether structured knowledge representation and dialectical prompt architecture can produce measurably more rigorous philosophical reasoning than standard single-pass LLM outputs.

The system stores philosophical knowledge not as flat text chunks but as a **typed argument graph** — claims linked by logical relations (`supports`, `contradicts`, `responds_to`, `depends_on`). When a query arrives, the engine retrieves the relevant argumentative structure via vector search + graph traversal, then runs **three sequential LLM passes** that mirror genuine philosophical debate: a Proponent builds the case, a Sceptic attacks it, a Synthesiser integrates the result.

A preliminary evaluation (n=10, single blinded evaluator — see [limitations](#evaluation)) showed the structured approach outperformed single-pass on 8/10 test cases, with the largest gains in counterargument coverage and philosophical grounding.

---

## The problem

Single-pass LLM responses to contested philosophical questions hedge towards consensus. Asked "Is moral relativism defensible?", a typical response lists arguments for and against, then concludes "it depends on your perspective." That answer is epistemically safe but philosophically empty — it doesn't identify which objections are decisive, where genuine disagreement lies, or what the most defensible position actually is.

SOPHIA tests whether forcing explicit role separation — Proponent cannot synthesise; Sceptic cannot build an alternative; Synthesiser must account for what the Sceptic said — produces outputs that engage with philosophical tension rather than performing balance around it.

---

## Architecture

### Three-pass dialectical engine

| Pass | Role | Receives | Does |
| --- | --- | --- | --- |
| **Analysis** | The Proponent | Query + graph context | Builds the strongest case(s), grounds claims in named traditions, states premises explicitly |
| **Critique** | The Sceptic | Query + graph context + Pass 1 | Attacks hidden assumptions, raises strongest counterarguments, questions the framing |
| **Synthesis** | The Synthesiser | Query + graph context + Pass 1 + Pass 2 | Tracks which objections are decisive, reaches a qualified conclusion with stated confidence |

Each pass streams progressively via SSE. The Synthesiser cannot paper over what the Sceptic exposed.

### Argument graph

Knowledge is stored in SurrealDB as typed nodes and edges:

```
Claim: "Maximising aggregate utility can justify harming individuals"
  ← contradicts ← Claim: "Each person's rights function as a side-constraint on utility maximisation"
  ← responds_to ← Claim: "Rule utilitarianism avoids agent-specific violations"
  ← part_of     ← Argument: "The Rights Objection to Utilitarianism"
```

Vector search alone would retrieve the most semantically similar claims — often the same position restated. Graph traversal assembles the argumentative structure: thesis + objection + reply, which is what philosophical reasoning requires.

### Retrieval pipeline

```
Query
  │
  ├─ Embed (Vertex AI text-embedding-005)
  ├─ Vector search → top-K semantically similar claims
  ├─ Graph traversal → expand to related claims via typed edges
  ├─ Resolve inter-claim relations + fetch enclosing argument structures
  └─ Inject assembled context block into all three passes
```

### Verification pass

After synthesis, users can optionally trigger a fourth pass that cross-checks key claims against live Google Search results (via Vertex AI Search Grounding). Flagged claims receive one of five confidence tiers: `High / Medium / Low / Interpretive / Unsupported`.

---

## Current state

| Capability | Status |
| --- | --- |
| Three-pass dialectical engine | **Working** — Vertex AI Gemini 2.5 Flash, streaming SSE |
| Google Search grounding (per-pass + verification) | **Working** — live web sources cited per pass |
| Ethics knowledge graph | **Working** — ~7,500 claims, 25 sources, deployed in SurrealDB |
| Argument-aware retrieval | **Working** — vector search + multi-hop graph traversal |
| Firebase Auth (Google OAuth) | **Working** — mandatory for all query access |
| Per-user history + cache | **Working** — Firestore, 30-day TTL, cross-device |
| Rate limiting | **Working** — 20 queries/day per user |
| Web UI | **Working** — SvelteKit, dark-first design, mobile-responsive |
| Argument graph visualisation | **Partial** — infrastructure exists; full "Map" tab not yet complete |
| Domain coverage | **Ethics only** — a `MVP_DOMAIN_FILTER` constrains the live query path to the ethics corpus; Philosophy of Mind expansion is in progress on the `domain-expansion` branch |
| Formal evaluation | **Not yet done** — Phase 1 results are preliminary (see below) |
| Public API | **Not built** |

---

## Tech stack

| Layer | Technology | Notes |
| --- | --- | --- |
| Frontend + Backend | SvelteKit 2, Svelte 5, TypeScript | Full-stack with SSE streaming; Svelte 5 runes throughout |
| Database | SurrealDB v2 | Graph + vector + document in one query path |
| AI — query runtime | Vertex AI Gemini 2.5 Flash + Google Search Grounding | Three-pass engine; grounding provides per-pass web sources |
| AI — ingestion pipeline | Anthropic Claude Sonnet (claim + relation extraction); Gemini (cross-validation) | Runs offline, not at query time |
| Embeddings | Vertex AI text-embedding-005 | Query-time retrieval; ingestion corpus uses Voyage AI (migration planned — see [architecture](docs/architecture.md)) |
| Auth | Firebase Auth (Google Sign-In) | ID tokens verified server-side |
| History / Cache | Firestore | Per-user, serverless, pairs with Firebase UIDs |
| Hosting | Google Cloud Run + GCE | Containerised app + persistent DB VM |
| CI/CD | GitHub Actions + Workload Identity Federation | Keyless GCP auth |
| IaC | Pulumi (`infra/`) | `pulumi up --stack production` |

---

## Evaluation

**Phase 1 (preliminary):** 10 philosophical queries, blinded comparison between SOPHIA three-pass and single-pass Gemini on identical queries, scored on a four-dimension rubric (argument structure, counterargument coverage, conclusion justification, philosophical grounding).

Results: SOPHIA 8/10, draw 1/10, loss 1/10. Largest gap in counterargument coverage (SOPHIA avg 4.4 vs. 3.2).

**Critical caveats:** n=10 is not statistically meaningful. The evaluator was the author (confirmed bias). Both systems used the same base model, so the advantage may reflect dialectical structure, graph context, or both — these have not been separated. Formal evaluation planned for a later phase (50+ queries, multiple independent evaluators, inter-rater reliability). See [docs/evaluation-methodology.md](docs/evaluation-methodology.md) for the full rubric, test cases, and limitations.

---

## Quick start

### Prerequisites

- Node.js 20+, pnpm 9+
- SurrealDB v2 (local or remote)
- GCP project with Vertex AI enabled (for query-time embedding and LLM calls)
- Anthropic API key (for ingestion pipeline only — not needed to run the app)
- Firebase project (Auth + Firestore)
- See `.env.example` for the full list of required variables

### Run locally

```bash
pnpm install

cp .env.example .env
# Edit .env — minimum required: SURREAL_URL, SURREAL_USER, SURREAL_PASS,
#   GOOGLE_VERTEX_PROJECT, FIREBASE_PROJECT_ID, and Firebase client keys

# Run SurrealDB (separate terminal)
surreal start --bind 0.0.0.0:8000 --user root --pass your-pass

# Create schema (first time only)
pnpm tsx scripts/setup-schema.ts

pnpm dev
# → http://localhost:5173
```

Note: without a populated SurrealDB knowledge graph, the engine will run without graph context — reasoning quality degrades but the system stays functional.

### Ingest the ethics corpus

```bash
# Fetch a source
pnpm tsx scripts/fetch-source.ts --source-list data/source-list-3a.json --wave 1

# Pre-scan (cost estimate + blocker check)
pnpm tsx scripts/pre-scan.ts --source-list data/source-list-3a.json --wave 1

# Ingest with Gemini cross-validation
pnpm tsx scripts/ingest-batch.ts --source-list data/source-list-3a.json --wave 1 --validate
```

See [docs/runbooks/domain-expansion-runbook.md](docs/runbooks/domain-expansion-runbook.md) for the full operational guide.

---

## Project structure

```text
src/
├── lib/
│   ├── server/
│   │   ├── engine.ts          # Three-pass dialectical engine (entry: runDialecticalEngine)
│   │   ├── retrieval.ts       # Argument-aware retrieval (embed → vector search → graph traversal)
│   │   ├── vertex.ts          # Vertex AI client (Gemini + embeddings + grounding)
│   │   ├── db.ts              # SurrealDB HTTP client (stateless, retries, typed errors)
│   │   ├── rateLimit.ts       # Firestore-backed per-user rate limiting
│   │   └── prompts/           # LLM prompt templates (analysis, critique, synthesis, verification)
│   ├── components/            # Svelte 5 UI components
│   ├── stores/                # Svelte 5 rune-based reactive stores
│   └── types/                 # TypeScript interfaces
├── routes/
│   ├── api/analyse/           # SSE streaming endpoint — POST { query }
│   ├── api/verify/            # SSE verification endpoint — POST { query, synthesis }
│   ├── api/history/           # Firestore history — GET (list) / DELETE (by doc ID)
│   └── admin/                 # Admin dashboard (Firebase Auth gated)
scripts/
├── ingest.ts                  # 7-stage source ingestion pipeline
├── ingest-batch.ts            # Batch runner with pipelined concurrency
├── fetch-source.ts            # Source fetcher (HTML → cleaned plain text)
├── pre-scan.ts                # Pre-ingestion gate (reachability, cost estimate, blockers)
├── curate-source.ts           # Automated source curation checks
├── setup-schema.ts            # SurrealDB schema + indexes (idempotent)
├── quality-report.ts          # Post-ingestion quality metrics
└── spot-check.ts              # Sampled accuracy verification
data/
├── source-list-3a.json        # Ethics corpus source list (25 sources, annotated)
├── source-list-pom.json       # Philosophy of Mind source list (in preparation)
└── sources/                   # Raw source texts (not committed; fetch via fetch-source.ts)
infra/                         # Pulumi IaC (Cloud Run, GCE, VPC, IAM)
tests/
├── unit/                      # Vitest unit tests (engine parsing, rate limiting)
└── e2e/                       # Playwright E2E tests (requires SOPHIA_TEST_TOKEN)
```

---

## Documentation

| Document | Purpose |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | System diagram, components, data flow, deployment, design decisions |
| [docs/three-pass-engine.md](docs/three-pass-engine.md) | Engine rationale, per-pass contract, example output |
| [docs/argument-graph.md](docs/argument-graph.md) | SurrealDB schema, relation types, SurrealQL examples |
| [docs/evaluation-methodology.md](docs/evaluation-methodology.md) | Evaluation rubric, Phase 1 results, limitations, planned formal study |
| [docs/runbooks/domain-expansion-runbook.md](docs/runbooks/domain-expansion-runbook.md) | Operational guide for adding a new philosophical domain |
| [ROADMAP.md](ROADMAP.md) | Development phases and priorities |
| [STATUS.md](STATUS.md) | Current deployment health and feature status |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |

---

## License

MIT — see [LICENSE](LICENSE).

The curated knowledge base contents are derived from copyrighted sources and are not redistributed. The schema, ingestion pipeline, retrieval architecture, prompt templates, and evaluation methodology are published as open source.

---

## Author

**Adam Boon** — MA Philosophy (The Open University), Senior Product Manager (NHS England)

Research interest: whether structured knowledge representation can improve the epistemological rigour of LLM-generated philosophical reasoning.
