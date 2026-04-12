---
status: reference
owner: adam
source_of_truth: false
last_reviewed: 2026-03-13
---

> Contribution guidance only. Current product and architecture truth for the public repo lives under `docs/sophia/`. The full Restormel and operations doc pack is maintained under `docs/local/` on maintainer machines — see `docs/LOCAL_DOCS.md`.

# Contributing to SOPHIA

SOPHIA is an open-source research project. Contributions are welcome across three tracks: the reasoning engine, the knowledge graph, and the application layer. This document explains how to set up a local environment and how each contribution track works.

---

## Local setup

### Prerequisites

- Node.js 20+, pnpm 9+
- SurrealDB v2 (`surreal start`)
- A GCP project with Vertex AI API enabled (for embeddings and the Gemini-powered engine)
- A Firebase project with Authentication and Firestore enabled
- Optional: Anthropic API key (only needed to run the ingestion pipeline)

### Environment

```bash
git clone https://github.com/Allotment-Technology-Ltd/sophia.git
cd sophia
pnpm install
cp .env.example .env
```

Required variables in `.env`:

```text
# SurrealDB
SURREAL_URL=http://localhost:8000
SURREAL_USER=root
SURREAL_PASS=your-pass

# GCP (Vertex AI — LLM + embeddings)
GOOGLE_VERTEX_PROJECT=your-gcp-project-id
GOOGLE_VERTEX_LOCATION=europe-west2   # or us-central1

# Firebase (Auth + Firestore)
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_API_KEY=...
FIREBASE_AUTH_DOMAIN=...

# Ingestion pipeline only (not needed to run the app)
ANTHROPIC_API_KEY=sk-ant-...
VOYAGE_AI_API_KEY=...
```

### Run

```bash
# Start SurrealDB
surreal start --bind 0.0.0.0:8000 --user root --pass your-pass

# Create schema (first time only, safe to re-run)
pnpm tsx scripts/setup-schema.ts

# Start dev server
pnpm dev
# → http://localhost:5173
```

Without a populated SurrealDB graph the engine runs without knowledge-graph context — reasoning quality degrades but the system stays functional. This is sufficient for UI or engine development.

### Type checking and tests

```bash
pnpm check          # svelte-check + tsc
pnpm test           # vitest unit tests
pnpm test:e2e       # Playwright E2E (requires SOPHIA_TEST_TOKEN)
```

---

## Contribution tracks

### 1. Reasoning engine

The engine (`src/lib/server/engine.ts`) and its prompts (`src/lib/server/prompts/`) are the core of the project. Useful contributions here include:

- **Prompt improvements** — better role separation, tighter counterargument instructions, improved synthesis hedging calibration. The current weakness is that Pass 3 (Synthesis) sometimes over-hedges when the Critique is very strong. If you have the maintainer doc pack, see `docs/local/archive/experiments/phase-1-evaluation-methodology.md` for the scoring rubric; otherwise rely on `src/lib/server/engine.test.ts` and reviewer judgment.
- **Verification pass** — the fourth pass (`/api/verify`) is functional but its prompt can be refined. Five confidence tiers currently; calibration against ground truth is not yet done.
- **New retrieval strategies** — `src/lib/server/retrieval.ts`. The current pipeline is: embed → top-K vector search → graph expand → deduplicate. Alternative traversal strategies (e.g. argument-centric retrieval, relation-type filtering) are worth exploring.
- **Engine tests** — `src/lib/server/engine.test.ts` has unit coverage for parsing helpers. Integration tests covering the full retrieval → engine → SSE path are missing.

When making prompt changes, run the engine unit tests and any evaluation harness you maintain locally; methodology notes live in the maintainer archive path above when `docs/local/` is populated.

### 2. Knowledge graph

Adding philosophical domains is the highest-leverage contribution for expanding SOPHIA's coverage. The full operational process is documented in `docs/local/reference/operations/runbooks/domain-expansion-runbook.md` when the maintainer doc pack is present ([`docs/LOCAL_DOCS.md`](docs/LOCAL_DOCS.md)). Summary:

1. Create a source list (`data/source-list-{domain}.json`) using the existing files as a template.
2. Run `scripts/curate-source.ts` on each source to check reachability, detect PDFs, and get a token estimate.
3. Run `scripts/pre-scan.ts` — this is a mandatory gate; no ingestion without a clean pre-scan.
4. Run `scripts/ingest-batch.ts --validate` — the `--validate` flag enables Gemini cross-validation.
5. Run `scripts/quality-report.ts` and `scripts/spot-check.ts`. All four acceptance criteria must pass: 0% orphan claims, >80% argument coverage, >80% spot-check accuracy, <5% low-confidence claims.

**Current constraint:** before ingesting any new domain, the ethics corpus must be re-embedded to Vertex AI `text-embedding-005` (Phase 3d-A1). See [STATUS.md](STATUS.md) for details.

Source selection criteria:

- Prefer HTML over PDF (the ingestion pipeline blocks PDF sources — find an HTML equivalent)
- Prefer Stanford Encyclopedia of Philosophy and Internet Encyclopedia of Philosophy entries for broad coverage
- Canonical primary texts are more valuable than secondary commentary
- Do not ingest Wikipedia, Britannica, or similar encyclopaedia sources (blocked by `curate-source.ts`)

### 3. Application layer

The frontend is SvelteKit 2 with Svelte 5 runes. Key conventions:

- **Svelte 5 runes throughout** — `$state`, `$derived`, `$derived.by`, `$effect`, `$props`, `$bindable`. No legacy `$:` reactive declarations.
- **CSS custom properties only** — never hardcode hex values in component or page CSS. All colours are in `src/styles/design-tokens.css`.
- **Focus styling** — `:focus-visible` with `outline` only; no `box-shadow` for focus rings.
- **Motion** — all animations must have a `prefers-reduced-motion` fallback that suppresses them.
- **Accessibility** — new interactive components need `aria-label`, `role`, and `aria-live` attributes where appropriate. Run `axe-core` against any new UI component.

New components go in `src/lib/components/`. Follow the existing naming and props conventions (see existing components for patterns).

---

## Code standards

- TypeScript throughout — no `any` without a comment explaining why
- No raw hex values in `.svelte` files — use CSS custom properties
- Server-side code in `src/lib/server/` only — never import server modules in client-side components
- Zod for all external data validation (SSE event parsing, API responses, ingestion outputs)
- Errors should be typed — see existing `TypedError` patterns in `db.ts`

---

## Pull request process

1. Open an issue first for anything substantial (new domain, engine change, major UI feature). This avoids duplicated work and lets us confirm the direction before implementation.
2. Branch from `main` for engine/UI work; branch from `domain-expansion` for knowledge graph additions.
3. Include a test for any changed logic in the engine or ingestion pipeline.
4. Update the relevant documentation in the same PR (schema changes → `docs/local/reference/architecture/argument-graph.md` when present; prompt changes → `docs/local/reference/architecture/prompts-reference.md`; phase completions → `ROADMAP.md` + `STATUS.md`).
5. PRs adding a new knowledge domain must include the quality-report output showing all four acceptance criteria passing.

---

## What we are not looking for

- Changes to the evaluation rubric without accompanying evaluation results
- Adding third-party AI SDKs to the query runtime path (the Vertex AI dependency is intentional)
- Removing the Firebase Auth requirement from the API (rate limiting depends on it)
- Docs-only PRs that don't fix a real gap (open an issue instead)
