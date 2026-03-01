# SOPHIA: Structured Ontological & Philosophical Heuristic Intelligence Agent

**A structured-reasoning engine for philosophical analysis using a three-pass dialectical approach and argument graph retrieval.**

[![Deploy to Cloud Run](https://github.com/Allotment-Technology-Ltd/sophia/actions/workflows/deploy.yml/badge.svg)](https://github.com/Allotment-Technology-Ltd/sophia/actions/workflows/deploy.yml)

---

## Research Question

Can structured argument retrieval combined with dialectical prompting produce measurably more rigorous philosophical analyses than standard single-pass LLM responses?

SOPHIA tests this hypothesis by storing philosophical knowledge as an **argument graph** (claims linked by typed logical relations) and using a **three-pass dialectical engine** (Analysis → Critique → Synthesis) that mirrors genuine philosophical methodology. Phase 1 validation showed the structured approach outperformed single-pass on 8/10 test cases using a blinded rubric assessing argument quality, counterargument acknowledgement, and conclusion justification.

---

## Live Demo

**[https://sophia-210020077715.europe-west2.run.app](https://sophia-210020077715.europe-west2.run.app)**

Try: *"Is moral relativism defensible?"* or *"Assess the ethical assumptions behind the EU AI Act's risk classification system"*

---

## Architecture

### Three-Pass Dialectical Engine

Rather than a single LLM call, SOPHIA uses three sequential passes that mirror philosophical debate:

| Pass | Role | What it does |
|------|------|-------------|
| **Pass 1 — Analysis** | The Proponent | Constructs the strongest case(s) for each position, grounding claims in named traditions |
| **Pass 2 — Critique** | The Sceptic | Challenges premises, exposes hidden assumptions, raises counterarguments |
| **Pass 3 — Synthesis** | The Synthesiser | Integrates perspectives, maps genuine disagreements, reaches a justified conclusion |

Each pass receives: (a) the original query, (b) the argument-graph context retrieved for that query, and (c) the output of prior passes. This prevents the Synthesiser from glossing over genuine tensions that the Critic exposed.

See [docs/three-pass-engine.md](docs/three-pass-engine.md) for rationale and example output.

### Argument Graph

Philosophical knowledge is stored not as flat text chunks but as structured **claims** linked by **typed relations** in SurrealDB:

```
Claim: "Maximising aggregate utility can justify harming individuals"
  ← contradicts ← Claim: "Each person's interests must be treated as inviolable"
  ← responds_to ← Claim: "Rule utilitarianism avoids agent-specific violations"
  ← part_of     ← Argument: "The Rights Objection to Utilitarianism"
```

Typed relations include: `supports`, `contradicts`, `responds_to`, `depends_on`, `part_of`, `exemplifies`.

This matters because **vector search alone** would retrieve the most semantically similar claims — often the same position restated. Graph traversal assembles the *argumentative structure*: thesis + objection + reply, which is what philosophical reasoning requires.

See [docs/argument-graph.md](docs/argument-graph.md) for the full schema.

### Argument-Aware Retrieval Pipeline

```
Query
  │
  ├─ Embed query (Voyage AI)
  ├─ Vector search → top-K semantically similar claims
  ├─ Graph traversal → expand to related claims via typed edges
  ├─ Deduplicate + resolve inter-claim relations
  ├─ Fetch enclosing argument structures
  └─ Return assembled context block (claims + relations + arguments)
```

The assembled context is injected into all three passes. Each pass has a different prompt — the Proponent uses claims to ground positions, the Sceptic looks for contradictions, the Synthesiser tracks which objections were adequately answered.

See [docs/architecture.md](docs/architecture.md) for the system diagram.

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend + Backend | SvelteKit 2, Svelte 5, TypeScript | Full-stack with SSE streaming; Svelte 5 runes for reactive state |
| Database | SurrealDB v2 | Graph + vector + document queries in a single query path |
| AI Engine | Claude API (claude-sonnet-4-5) | Best reasoning quality for multi-step philosophical argumentation |
| Validation | Google Gemini 2.5 Flash | Cross-model validation during ingestion pipeline (bias diversification) |
| Embeddings | Voyage AI | High-quality semantic retrieval tuned for long-form text |
| Hosting | Google Cloud Run + GCE | Containerised app (Cloud Run) + persistent DB VM (GCE) |
| CI/CD | GitHub Actions + Workload Identity Federation | Keyless auth to GCP; secret-free pipeline |

---

## Current Status

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 1 | ✅ Complete | Three-pass engine validated: outperforms single-pass on 8/10 test cases |
| Phase 2 | ✅ Complete | SvelteKit app deployed with streaming three-pass analysis |
| Phase 3a | ✅ Complete | Ethics knowledge base (Wave 1): ingestion pipeline, argument graph, retrieval |
| Phase 3b | ✅ Complete | Production SurrealDB on GCE, ingestion quality validation |
| Phase 3c | 🔄 In progress | UI — references panel, design system |
| Phase 4 | 📋 Planned | Web search gap-filling (Pass 2 triggers search when it identifies factual gaps) |
| Phase 5 | 📋 Planned | Authentication, rate limiting, beta launch (50 users) |
| Phase 6 | 📋 Planned | Commercial features |

---

## Knowledge Base

**Phase 3a (complete):** Ethics corpus, Wave 1

- ~500+ claims extracted and validated
- ~400+ typed inter-claim relations
- 8 foundational sources ingested:
  - Stanford Encyclopedia of Philosophy: Utilitarianism, Deontological Ethics, Virtue Ethics
  - Mill: *Utilitarianism*; Kant: *Groundwork of the Metaphysics of Morals*
  - Singer: *Famine, Affluence, and Morality*
  - Ross: *The Right and the Good*; Aristotle: *Nicomachean Ethics* (excerpts)

**Waves 2–3 (Phase 3b/3c):** 21 additional sources covering consequentialism, rights theory, applied ethics, and meta-ethics. See `data/source-list-3a.json` for the full annotated list.

---

## Project Structure

```
src/
├── lib/
│   ├── server/
│   │   ├── engine.ts          # Three-pass dialectical engine
│   │   ├── retrieval.ts       # Argument-aware graph retrieval
│   │   ├── prompts/           # All AI prompt templates (analysis, critique, synthesis)
│   │   ├── anthropic.ts       # Claude API client + token tracking
│   │   ├── gemini.ts          # Gemini validation client
│   │   ├── embeddings.ts      # Voyage AI embedding client
│   │   └── db.ts              # SurrealDB client (singleton, lazy-init)
│   ├── components/            # Svelte 5 UI components
│   ├── stores/                # Svelte 5 rune stores
│   └── types/                 # TypeScript interfaces
├── routes/
│   ├── api/analyse/           # SSE streaming endpoint (POST)
│   └── admin/                 # Knowledge base monitoring dashboard
scripts/
├── ingest.ts                  # 7-pass source ingestion pipeline
├── fetch-source.ts            # Source fetcher (SEP, papers, books)
├── setup-schema.ts            # SurrealDB schema setup
├── verify-db.ts               # Database integrity checks
└── quality-report.ts          # Ingestion quality reporting
data/
├── source-list-3a.json        # Annotated list of Phase 3a sources
└── sources/                   # Raw source texts (not committed — see data/sources/README.md)
```

---

## Quick Start

### Prerequisites

- Node.js 20+, pnpm 9+
- SurrealDB v2 running locally (or remote connection)
- API keys: Anthropic, Google AI, Voyage AI (see `.env.example`)

### Local Development

```bash
# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys

# Run SurrealDB locally (separate terminal)
surreal start --bind 0.0.0.0:8000 --user root --pass your-pass

# Set up database schema (first time only)
pnpm tsx scripts/setup-schema.ts

# Start development server
pnpm dev
# → http://localhost:5173
```

### Ingest a Source

```bash
# Fetch a source text
pnpm tsx scripts/fetch-source.ts <url> <source_type>

# Ingest with validation
pnpm tsx scripts/ingest.ts <source-file> --validate
```

---

## Research Methodology

Phase 1 evaluation used a blinded rubric assessing:

1. **Argument structure** — Are premises made explicit? Is the reasoning valid?
2. **Counterargument acknowledgement** — Are the strongest objections engaged?
3. **Conclusion justification** — Is the conclusion proportionate to the evidence?
4. **Philosophical grounding** — Are claims anchored in named traditions?

The three-pass engine was compared against single-pass Claude Sonnet on identical queries. Results: 8/10 test cases rated higher for argument quality; 10/10 for counterargument coverage.

See [docs/evaluation-methodology.md](docs/evaluation-methodology.md) for the full rubric and test cases.

---

## Documentation

- [docs/architecture.md](docs/architecture.md) — System architecture and data flow
- [docs/three-pass-engine.md](docs/three-pass-engine.md) — Dialectical engine design with example output
- [docs/argument-graph.md](docs/argument-graph.md) — Knowledge graph schema and SurrealQL examples
- [docs/evaluation-methodology.md](docs/evaluation-methodology.md) — Evaluation rubric and Phase 1 results

---

## License

MIT — see [LICENSE](LICENSE).

All research methodology, evaluation results, argument graph schema, and dialectical prompt architecture are published as open source. The curated knowledge base contents (ingested philosophical texts) are derived from copyrighted sources and are not redistributed; only the schema and pipeline for reproducing it are published.

---

## Author

**Adam Hinton** — MA Philosophy (University of Exeter), PG student (The Open University), Senior Product Manager (NHS England, Cybersecurity Division)

Research interest: whether structured knowledge representation can improve the epistemological rigour of LLM-generated philosophical reasoning.

