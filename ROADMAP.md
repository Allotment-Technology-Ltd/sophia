# ROADMAP

**Last updated:** 2026-03-09
**Current version:** 0.2.0 — Phase 3c complete, Phase 3d complete, Phase 3e Wave 1 complete
**Related:** [STATUS.md](STATUS.md) · [CHANGELOG.md](CHANGELOG.md) · [docs/architecture.md](docs/architecture.md)

---

## Current phase: 3f — Philosophy of Mind, Wave 2

Phase 3e Wave 1 is complete. 9 PoM sources ingested (3,418 claims, 255 arguments, all tagged `philosophy_of_mind`). Pipeline hardening (3d) is complete. Active work: Phase 3f (Wave 2 — mind-body problem, personal identity, extended cognition) and Phase D (dynamic domain selection in engine).

---

## Completed

### Phase 1 — Engine validation (Jan 2026)

Three-pass dialectical engine prototyped and compared against single-pass on 10 philosophical queries using a blinded rubric. Result: 8/10 wins, largest gap in counterargument coverage. Evaluation was self-conducted (single evaluator); results treated as directional, not statistically significant.

### Phase 2 — Deployed prototype (Jan 2026)

SvelteKit app deployed to Cloud Run with SSE streaming of three-pass analysis.

### Phase 3a — Ethics knowledge base, Wave 1 (Feb 2026)

- SurrealDB on GCE (europe-west2); VPC-connected to Cloud Run
- 8 foundational ethics sources ingested (~500 claims): SEP entries for Utilitarianism, Deontological Ethics, and Virtue Ethics; Mill; Kant; Singer; Ross; Aristotle
- Argument-aware retrieval (vector search + graph traversal)

### Phase 3b — Ethics knowledge base, Waves 2 & 3 (Feb 2026)

- 17 additional sources ingested
- Total: 25/27 sources, ~7,500 claims (sources 5 & 8 skipped — pragmatic coverage; alternatives included)
- Gemini cross-validation enabled; spot-check accuracy >80%

### Phase 3c — MVP pivot (Mar 2026)

- **Engine:** Migrated from Claude to Vertex AI Gemini 2.5 Flash; Google Search Grounding added (per-pass web sources + optional verification pass)
- **Auth:** Firebase Auth enforced on all `/api/*` routes; Google OAuth mandatory
- **History/cache:** Firestore per-user history (30-day TTL) and server-side cache; cross-device sync
- **Rate limiting:** 20 queries/day per uid via Firestore transaction
- **UI:** References panel (knowledge base claims + web sources), History panel, argument graph infrastructure, follow-up hints, 3-question limit
- **Hallucination prevention:** Prompt hardening; unattributed claims prefixed; five-tier verification confidence system
- **Design system:** Dark-first, Cormorant Garamond / JetBrains Mono, CSS custom properties
- **Deployment:** Cloud Run revision `sophia-00077-256`; Pulumi IaC; health check + auth guard confirmed

---

## Completed (continued)

### Phase 3d — Domain expansion infrastructure (Mar 2026)

- **A1** Embedding standardisation: `ingest.ts` migrated to Vertex AI `text-embedding-005` (768-dim); MTREE index updated
- **A2** Idempotent pipeline: per-stage JSON checkpoints; `--force-stage <n>` CLI flag; resume on failure
- **A3** Pre-scan mandatory gate: `ingest-batch.ts` runs pre-scan before any API calls; $2.00/source cost ceiling
- **A4** Schema domain validation: `ASSERT` constraints on `claim.domain` (pre-existing)
- **A5** Automated source curation: `scripts/curate-source.ts` — URL reachability, PDF detection, duplicate detection, token size, blocklist
- **Supporting:** `--domain` override CLI flag; `--source-list` multi-list support; `docs/runbooks/domain-expansion-runbook.md`

### Phase 3e — Philosophy of Mind, Wave 1 (Mar 2026)

- **9 sources ingested** (10 attempted; 1 skipped as title duplicate): SEP Consciousness, Chalmers "Facing Up to the Hard Problem", SEP Qualia, SEP Physicalism, SEP Functionalism, Turing 1950, SEP Chinese Room, SEP Philosophy of AI, SEP Turing Test
- **3,418 claims**, **1,443 relations**, **255 arguments** — all tagged `philosophy_of_mind`
- **Total cost:** ~$10.48 across 9 sources (~$1.16 avg/source)
- **Known issues:** Idempotent resume used for source 109 (Vertex AI 429 on first embed pass); slug collision between sources 101/102 (both titled "Consciousness" — SEP version ingested once as expected)

---

## In progress

### Phase 3f — Philosophy of Mind, Wave 2

**Depends on:** Phase 3e quality gate
**Scope:** 15–20 sources covering mind-body problem, personal identity, extended cognition (Descartes, Smart, Fodor, Kim, Parfit, Clark & Chalmers)

### Phase 4 — Knowledge graph visualisation

**Depends on:** Phase 3c deployment
**Status:** Design agreed; `GraphCanvas` component and `graphStore` infrastructure already exist

A dedicated "Map" tab in the results view — a force-directed graph showing:

- **Knowledge base** claims retrieved for the query (amber nodes)
- **AI reasoning** claims from each pass (sage / copper / blue nodes)
- **Web verification** sources (diamond nodes)
- Typed edges between all three layers

This is the single feature that makes argument provenance visible and differentiates SOPHIA most clearly from a standard AI assistant.

### Phase 5 — Analytics and cost tracking

- Per-user query analytics to BigQuery
- API cost tracking (Vertex AI, Cloud Run) per user
- Admin dashboard with cost and usage breakdowns
- Enhanced rate limiting (per-minute + per-day tiers)

### Phase 6 — Multi-turn conversation + formal evaluation

**Multi-turn:** Replace the current 3-question limit with a full conversation model. Conversation history maintained across queries within a session; context-aware follow-ups; session persistence in Firestore.

**Formal evaluation:** The Phase 1 results (n=10, single evaluator) are preliminary. Phase 6 targets a rigorous comparative study:

- 50+ test cases across 5+ philosophical domains
- Three independent evaluators (two philosophy graduates, one AI researcher)
- Inter-rater reliability (Cohen's kappa)
- Baseline comparisons: SOPHIA vs. single-pass Gemini, single-pass GPT-4, human philosophy tutor
- Separation of graph-context vs. dialectical-structure contributions to quality

### Phase 7 — Domain expansion beyond philosophy

Additional knowledge domains in priority order:

- Law and policy ethics (AI regulation, jurisprudence)
- Bioethics and medicine
- Technology and information ethics
- Economics and capitalism ethics

Each domain follows the same ingestion pipeline with domain-specific quality gates.

### Phase 8 — Public API and commercial features

- Public API with API key authentication
- Usage-based billing via Stripe
- Premium tier: batch analysis, longer sessions, export
- Documentation and client SDK

---

## What this roadmap does not include

- Research breakthroughs. SOPHIA is an engineering project testing a hypothesis about structured reasoning. Whether the hypothesis holds at scale is an open empirical question.
- AGI-adjacent claims. The system is a retrieval + prompting architecture on top of existing foundation models.
- Fixed dates. Phases are sequenced by dependency, not calendar. Phase 3d must complete before 3e; Phase 6 evaluation requires sufficient domain coverage to be meaningful.

---

## Metrics

| Metric | Target | Current |
| --- | --- | --- |
| Query latency p95 | < 3s to first token | ~2.5s (informal) |
| Sources ingested | 27 (ethics) + 9 (PoM W1) | 25 ethics + 9 PoM = 34 |
| Claims in graph | > 10,000 (post-PoM W2) | ~3,418 (PoM W1, fresh DB) |
| Domains covered (live) | Ethics + PoM | PoM ingested; engine routing TBD |
| Evaluation: formal study | Phase 6 | Not done |
| Uptime | 99.5% | Not monitored |

---

## See also

- [STATUS.md](STATUS.md) — deployment health and immediate priorities
- [docs/architecture.md](docs/architecture.md) — system design and components
- [docs/evaluation-methodology.md](docs/evaluation-methodology.md) — evaluation rubric and Phase 1 results
- [docs/runbooks/domain-expansion-runbook.md](docs/runbooks/domain-expansion-runbook.md) — operational guide for domain ingestion
