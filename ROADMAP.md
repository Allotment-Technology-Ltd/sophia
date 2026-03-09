# ROADMAP

**Last updated:** 2026-03-09
**Current version:** 0.2.0 — Phase 3e complete, Phase 3f in progress
**Related:** [STATUS.md](STATUS.md) · [CHANGELOG.md](CHANGELOG.md) · [docs/architecture.md](docs/architecture.md)

---

## Strategic direction

SOPHIA is repositioning from a philosophical reasoning engine into a **reasoning quality layer for AI systems** — a tool that evaluates whether arguments are logically sound, not just factually accurate. Hallucination detectors check facts. Bias detectors check fairness. SOPHIA checks *reasoning quality*: whether conclusions follow from premises, whether the strongest objections are engaged, whether scope matches evidence.

Philosophy is the wedge. The philosophical engine demonstrates the methodology and builds the knowledge base. The reasoning quality API — Phase 5 — generalises that methodology to any domain: legal documents, policy briefs, regulatory submissions, AI-generated answers.

This repositioning opens three revenue paths in parallel: consumer subscriptions (Phase 7), a developer API (Phase 5+), and enterprise pilots in legal/compliance/AI governance (Phase 8).

---

## Completed

### Phase 1 — Engine validation (Jan 2026)

Three-pass dialectical engine prototyped and compared against single-pass on 10 philosophical queries using a blinded rubric. Result: 8/10 wins, largest gap in counterargument coverage. Evaluation was self-conducted (single evaluator); results treated as directional, not statistically significant.

### Phase 2 — Deployed prototype (Jan 2026)

SvelteKit app deployed to Cloud Run with SSE streaming of three-pass analysis.

### Phase 3a — Ethics knowledge base, Wave 1 (Feb 2026)

SurrealDB on GCE (europe-west2); 8 foundational ethics sources ingested (~500 claims); argument-aware retrieval operational.

### Phase 3b — Ethics knowledge base, Waves 2 & 3 (Feb 2026)

17 additional sources ingested. Total: 25/27 sources, ~7,500 claims (sources 5 & 8 skipped — SEP alternatives included; see CHANGELOG).

### Phase 3c — MVP pivot (Mar 2026)

- **Engine:** Migrated to Vertex AI Gemini 2.5 Flash; Google Search Grounding added
- **Auth:** Firebase Auth enforced on all `/api/*` routes
- **History/cache:** Firestore per-user history (30-day TTL) and cache
- **Rate limiting:** 20 queries/day per uid
- **UI:** References panel, History panel, argument graph infrastructure, follow-up hints, 3-question limit, hallucination prevention prompt hardening
- **Design system:** Dark-first, Cormorant Garamond / JetBrains Mono
- **Deployment:** Cloud Run revision `sophia-00077-256`
- **Lens support:** Backend `lens` parameter accepted by engine and `/api/analyse` endpoint

### Phase 3d — Domain expansion infrastructure (Mar 2026)

- Embedding standardised to Vertex AI `text-embedding-005` (768-dim); MTREE index updated
- Idempotent pipeline: per-stage JSON checkpoints; `--force-stage <n>` CLI flag; resume on failure
- Pre-scan mandatory gate: `ingest-batch.ts` exits non-zero on blockers; $2.00/source cost ceiling
- Automated source curation: `scripts/curate-source.ts` — URL reachability, PDF detection, duplicate detection, token size, domain blocklist
- `MVP_DOMAIN_FILTER` removed from `engine.ts` — retrieval is now fully domain-agnostic
- `docs/runbooks/domain-expansion-runbook.md` canonical operational guide published

### Phase 3e — Philosophy of Mind, Wave 1 (Mar 2026)

- **9 sources ingested** from `data/source-list-pom.json`: SEP Consciousness, Chalmers "Facing Up to the Hard Problem", SEP Qualia, SEP Physicalism, SEP Functionalism, Turing 1950, SEP Chinese Room, SEP Philosophy of AI, SEP Turing Test
- **3,418 claims**, **1,443 relations**, **255 arguments** — all tagged `philosophy_of_mind`
- Total ingestion cost: ~$10.48 (~$1.16/source)
- Engine retrieval validated: ≥3 PoM claims returned on 5 test queries

---

## In progress

### Phase 3f — Philosophy of Mind, Wave 2

**Branch:** `domain-expansion`
**Scope:** 15–20 sources — mind-body problem, personal identity, extended cognition

Planned sources: Descartes (*Meditations* excerpts), Smart (1959), Fodor (1974), Kim (1992); Parfit (*Reasons and Persons* Part III), Locke (excerpts), Olson (SEP Personal Identity); Clark & Chalmers (1998), Hutchins.

**Quality gate before merge:**

- 0% orphan claims
- >80% argument coverage
- >80% spot-check attribution accuracy
- ≥3 knowledge graph claims returned on 5 PoM Wave 2 test queries

---

## Upcoming phases

### Phase 4 — Launch and validate (target: 4 weeks)

**Objective:** Get the existing philosophical engine in front of real users and submit the ARIA grant application. This phase is about validation and non-dilutive funding.

**Pre-launch hardening:**

- [ ] Complete accessibility audit — axe-core scan + WCAG 2.2 AA review of new components
- [ ] Error injection tests (Firestore down, SurrealDB timeout, Gemini rate limit)
- [ ] Privacy policy and terms of service pages
- [ ] Meta tags, OpenGraph, favicon for social sharing
- [ ] Analytics instrumentation (see below)
- [ ] Re-attempt sources 5 & 8 ingestion or confirm substitutes adequate

**ARIA grant application — deadline 24 March 2026:**

- [ ] Draft ARIA Scaling Trust Phase 1 application
- Position: "Structured reasoning evaluation for trustworthy AI systems"
- Budget target: £100K–300K for 12–18 months
- Emphasise: open-source epistemic constitution, reasoning quality metrics, philosophical knowledge graph as a demonstration domain

**Soft launch (week 2–3):**

- [ ] Share with 10 philosophy / AI contacts (personal network)
- [ ] Hacker News Show HN post
- [ ] Post to r/philosophy, r/philosophyofAI
- [ ] Twitter/X thread on the three-pass dialectical approach

**Parallel grant applications:**

| Application | Deadline | Amount | Fit |
| --- | --- | --- | --- |
| ARIA Scaling Trust | 24 Mar 2026 | £100K–300K | ★★★★★ |
| Long-Term Future Fund (LTFF) | Rolling | $20K–200K | ★★★★ |
| Emergent Ventures | Rolling | $1K–50K | ★★★★ |
| Manifund | Immediate | Variable | ★★★★ |
| Survival & Flourishing Fund | 22 Apr 2026 | $50K–500K | ★★★★ |
| Schmidt Sciences Trustworthy AI | 17 May 2026 | Up to $5M | ★★★ |
| Innovate UK Sovereign AI | Rolling | £50K–120K | ★★★★ |

**Analytics instrumentation:**

- [ ] Log all queries (anonymised) to Firestore `analytics/` collection
- [ ] Track: query length, completion rate, follow-up rate, pass durations, claims retrieved, grounding sources
- [ ] Admin analytics view at `/admin/analytics`

**Kill criteria (if not met by week 4):**

- Fewer than 10 users complete an analysis → reassess positioning
- Average time-on-page < 30 seconds → UX problem
- Zero return users in 30 days → product-market fit issue

### Phase 4a — Two-speed link ingestion + citation formalization (proposed)

**Objective:** Expand analysis scope via user-directed links without harming interactive latency, and improve scholarly output discipline.

Key deliverables:

- [ ] Consumer `/api/analyse` request additions: `resource_mode`, `user_links`, `queue_for_nightly_ingest`
- [ ] Fast runtime path: lightweight link intake only; no full ingestion in request path
- [ ] Deferred queue for opted-in links: include both user-provided and grounding links from the run
- [ ] Nightly Cloud Run Job + Cloud Scheduler trigger at `02:00 UTC`
- [ ] Tiered allowlist policy:
  - Trusted domains auto-approved
  - Non-trusted domains routed to manual review
- [ ] Harvard-style references in Synthesis + Verification outputs (in-text + references section)
- [ ] Observability: queue backlog, nightly failure rate, ingestion throughput, citation compliance spot-checks

Gating metrics:

- [ ] Runtime latency budget maintained for `/api/analyse`
- [ ] Nightly failure rate within threshold for 7 consecutive runs
- [ ] Pending review queue kept under ops SLA target
- [ ] No contract break for `/api/v1/verify` request schema

### Phase 5 — Reasoning API foundation (target: 6 weeks after Phase 4)

**Objective:** Extract the core reasoning capabilities into a domain-agnostic API. The same three-pass engine that does philosophical analysis becomes a general-purpose reasoning evaluation service. This is the critical architectural move that opens the enterprise and developer markets.

The API accepts any text (a legal argument, a policy document, an AI-generated answer) and returns:

- Extracted atomic claims with types and confidence
- Typed logical relations between claims
- Reasoning quality scores across 6 dimensions
- Epistemic constitution compliance (Phase 6)

Key deliverables:

- [x] Domain-agnostic claim extraction (`src/lib/server/extraction.ts`) — extended claim types: empirical, causal, explanatory, normative, predictive, definitional, procedural
- [x] Reasoning quality scoring (`src/lib/server/reasoningEval.ts`) — 6 dimensions: logical structure, evidence grounding, counterargument coverage, scope calibration, assumption transparency, internal consistency
- [x] `POST /api/v1/verify` — API-key authenticated (not Firebase Auth); streaming + JSON modes; `X-Request-Id`, `X-Processing-Time-Ms` headers
- [x] `POST /api/v1/keys` + `GET /api/v1/keys` — API key management (admin-gated via Firebase Auth)
- [x] Developer waitlist page and API documentation

**Architecture:** `/api/v1/*` routes share the engine and Vertex AI client but use domain-agnostic prompts. Consumer `/api/analyse` is unchanged.

### Phase 6 — Epistemic constitution (target: 4 weeks after Phase 5)

**Objective:** Implement a small, typed, executable set of epistemic rules that evaluate whether reasoning meets basic standards of intellectual rigour. This is the core moat — not the LLM, not the data, but the *specification* of what sound reasoning looks like.

10 starter rules covering: evidence requirement, proportional evidence, contradiction awareness, alternative hypotheses, scope discipline, assumption transparency, correlation vs causation, uncertainty signalling, normative bridge requirement, source diversity.

Each rule has: deterministic checks (graph-traversal, no LLM cost) for structurally detectable violations; LLM-backed checks for qualitative evaluation (batched into a single call); explicit `satisfied / violated / uncertain / not_applicable` status; remediation guidance on violation.

Key deliverables:

- [ ] `src/lib/types/constitution.ts` — rule and evaluation type definitions
- [ ] `src/lib/server/constitution/rules.ts` — 10 typed, executable rules
- [ ] `src/lib/server/constitution/evaluator.ts` — hybrid deterministic + LLM evaluator
- [ ] Integration into `/api/v1/verify` response
- [ ] Unit tests covering all 4 deterministic rules with crafted claim/relation fixtures
- [ ] Grant output: open-source `@sophia/epistemic-constitution` npm package (MIT)

### Phase 6.5 — Dogfooding and pipeline convergence (target: 1–2 weeks after Phase 6)

**Objective:** Ensure SOPHIA "eats its own dog food" by using the same constitution-aware verification pipeline internally across API and product surfaces, without introducing in-process HTTP hop overhead.

**Principles:**

- No server-side self-calls to `/api/v1/verify`; share orchestration via an internal module
- One canonical verification pipeline implementation; route handlers become thin adapters
- Feature-flagged rollout into consumer flow to manage latency/cost risk

Key deliverables:

- [ ] Extract a shared verification orchestrator module (e.g., `src/lib/server/verification/pipeline.ts`) that runs:
  - Domain-agnostic reasoning
  - Claim extraction
  - Reasoning quality scoring
  - Constitution evaluation
- [ ] Refactor `POST /api/v1/verify` to call the shared orchestrator (preserve current API schema and SSE behavior)
- [ ] Add optional constitution step to consumer analysis flow behind `ENABLE_CONSTITUTION_IN_ANALYSE` (default off)
- [ ] Add parity tests asserting internal pipeline output parity with `/api/v1/verify` JSON mode for the same input
- [ ] Add telemetry:
  - constitution eval latency
  - extra token cost
  - violation-rate distribution by rule id
- [ ] Rollout plan:
  - 0% (off) -> internal testing
  - 10% traffic flag-on
  - 50% if p95 and cost budgets hold
  - 100% after one week stable

**Exit criteria:**

- Single source of truth for verification orchestration
- No regression in `/api/v1/verify` contract
- Consumer flow can surface constitution output when flag is enabled
- Observability dashboard shows latency and cost deltas clearly

### Agent prompt — Phase 6.5a (shared pipeline extraction)

```text
Unify SOPHIA verification orchestration into one internal service module.

CONTEXT:
- /api/v1/verify currently orchestrates reasoning -> extraction -> reasoning quality -> constitution.
- /api/analyse uses the dialectical engine directly and does not yet consume constitution output.

GOAL:
Create a shared pipeline module so both routes can reuse the same logic, while keeping route contracts unchanged.

DO:
1) Create src/lib/server/verification/pipeline.ts exporting:
   - runVerificationPipeline(input: VerificationRequest | { text: string, question?: string, answer?: string }, options)
   - return structured object containing claims, relations, reasoning_quality, constitutional_check, pass_outputs, metadata.
2) Move orchestration logic out of /api/v1/verify into this module.
3) Keep /api/v1/verify as a thin adapter for:
   - auth
   - request parsing
   - JSON/SSE transport formatting
4) Ensure zero contract drift in existing /api/v1/verify response fields and headers.
5) Add focused tests for pipeline success path and failure propagation.

CONSTRAINTS:
- Do not call /api/v1/verify over HTTP from server code.
- Do not modify consumer UI in this task.
```

### Agent prompt — Phase 6.5b (consumer dogfood integration behind flag)

```text
Integrate constitution-aware verification into consumer analysis flow behind a feature flag.

CONTEXT:
- Shared pipeline exists (Phase 6.5a).
- Consumer endpoint /api/analyse currently streams pass events from runDialecticalEngine.

GOAL:
Allow consumer flow to optionally compute and emit constitution output without breaking existing UX.

DO:
1) Add env flag ENABLE_CONSTITUTION_IN_ANALYSE (default false).
2) When flag is true, run constitution evaluation after claim extraction/analysis completion.
3) Emit a new SSE event:
   - type: "constitution_check"
   - payload: constitutional_check
4) Preserve existing event ordering and backward compatibility.
5) Add tests for:
   - flag off: no constitution event
   - flag on: constitution event emitted with valid shape
6) Add lightweight timing metric capture for constitution step.

CONSTRAINTS:
- Keep first-token latency unchanged for the core analysis stream.
- No API-key auth changes.
```

### Agent prompt — Phase 6.5c (parity + observability hardening)

```text
Add parity checks and observability for constitution dogfooding rollout.

GOAL:
Prove that internal dogfood path and /api/v1/verify remain behaviorally aligned and operationally safe.

DO:
1) Add parity test fixtures:
   - same input through shared pipeline
   - same input through /api/v1/verify JSON path (handler-level test)
   - assert claim IDs, relation counts, rule statuses, and overall_compliance align.
2) Add structured logs/metrics fields:
   - constitution_duration_ms
   - constitution_input_tokens
   - constitution_output_tokens
   - constitution_rule_violations (array of rule_id)
3) Document rollout guardrails in docs/runbooks/:
   - latency budget threshold
   - cost budget threshold
   - rollback switch (flag off)
4) Add a short dashboard query reference to STATUS.md.

CONSTRAINTS:
- Do not change public API request schema.
- Keep metrics additive only (no breaking log format changes).
```

### Phase 7 — Consumer polish and monetisation (target: 4 weeks after Phase 6)

**Objective:** Bring the consumer product to paying-user quality. First recurring revenue.

Key deliverables:

- [ ] **Lens selector UI** — `LensSelector.svelte` component; backend `lens` parameter already wired; 5 lenses: Utilitarian, Deontological, Virtue, Rawlsian, Care ethics
- [ ] **Depth selector** — `DepthSelector.svelte`; Quick (Pass 1 only, ~10s) / Standard (3 passes, ~25s) / Deep (extended, ~40s); `DepthMode` added to `EngineOptions`
- [ ] **Reasoning quality badge** — circular score badge from Phase 5 scoring visible on consumer analyses; expandable 6-dimension detail
- [ ] **Feedback collection** — thumbs up/down per pass; Firestore `feedback/{queryId}/{passType}`
- [ ] **Stripe billing** — Free (5 analyses/day, standard depth only) / Pro £7.99/month (50/day, all depths and lenses); Stripe Checkout Sessions; webhook handler; `/account` page; feature gating in rate-limit layer

**Target metrics:** 20+ paying Pro subscribers; MRR > £160.

### Phase 8 — Enterprise pilot and domain expansion (target: 8 weeks)

**Objective:** First enterprise revenue. Expand knowledge base into legal and regulatory domains.

Key deliverables:

- [ ] **Legal reasoning knowledge base** — 15–20 foundational sources; domain-appropriate claim types (`legal_precedent`, `statutory_interpretation`, `procedural`, `rights_claim`)
- [ ] **Regulatory compliance knowledge base** — EU AI Act key articles and recitals; UK AI Safety Institute framework; claim types: `regulatory_requirement`, `compliance_obligation`, `risk_classification`
- [ ] **Enterprise features** — audit trail (every analysis logged with user + inputs + outputs); PDF/DOCX report export; custom constitutional rules
- [ ] **3 enterprise pilots** — EU AI Act compliance team; law firm brief analysis; NHS AI governance procurement

**Target:** 3 enterprise letters of intent; 10+ active API keys.

### Phase 9 — Platform and scale (ongoing)

Driven by market signal rather than a fixed sequence. Key items:

- **MCP integration** — expose `sophia_verify`, `sophia_extract_claims`, `sophia_check_constitution` as MCP tools; any MCP-compatible client (Claude Desktop, Cursor, VS Code) can call SOPHIA's reasoning evaluation
- **Open-source epistemic constitution** — standalone `@sophia/epistemic-constitution` npm package; enables developer ecosystem adoption
- **Developer SDK** — `@sophia/sdk` TypeScript client; handles auth, streaming, retries, type safety
- **Batch processing API** — `POST /api/v1/verify/batch` with async webhook callback; enables enterprise document-set verification
- **Argument graph visualisation** — full "Map" tab implementation (infrastructure already exists in `GraphCanvas` + `graphStore`; execution plan: `docs/argument-map-gold-standard-plan.md`)
- **Formal evaluation study** — 50+ queries, three independent evaluators, inter-rater reliability, separation of graph-context vs. dialectical-structure contributions

---

## What this roadmap does not include

- **Fixed delivery dates.** Phases are sequenced by dependency. Phase 5 requires a working Phase 4 launch to validate the positioning. Phase 6 requires Phase 5 types and extraction to be stable.
- **Research breakthrough claims.** SOPHIA is an engineering project testing a hypothesis about structured reasoning. The Phase 1 evaluation (n=10, single evaluator) is directional. The formal study in Phase 9 is when that changes.
- **Mobile app, multi-language, fine-tuning, multi-agent orchestration, formal verification.** All deliberately deferred — see docs/archive/ for earlier discussion.

---

## Metrics

| Metric | Target | Current |
| --- | --- | --- |
| Query latency p95 | < 3s to first token | ~2.5s (informal) |
| Ethics sources ingested | 27 | 25 (92.6%) |
| PoM sources ingested | 10 (Wave 1) | 9 (Wave 1 complete) |
| Total claims in graph | > 10,000 (post-PoM W2) | ~10,918 (7,500 ethics + 3,418 PoM) |
| Domains live | Ethics + PoM | Ethics (retrieval); PoM (ingested, engine routing TBD) |
| Formal evaluation | Phase 9 | Not started |
| Paying users | 20 (Phase 7) | 0 (pre-launch) |
| ARIA application | 24 Mar 2026 | Not submitted |

---

## See also

- [STATUS.md](STATUS.md) — deployment health and feature status
- [docs/architecture.md](docs/architecture.md) — system design and components
- [docs/evaluation-methodology.md](docs/evaluation-methodology.md) — evaluation rubric and Phase 1 results
- [docs/runbooks/domain-expansion-runbook.md](docs/runbooks/domain-expansion-runbook.md) — domain ingestion guide
- [docs/archive/SOPHIA-STRATEGIC-ROADMAP-v2.md](docs/archive/SOPHIA-STRATEGIC-ROADMAP-v2.md) — original strategic repositioning analysis with detailed agent implementation prompts
