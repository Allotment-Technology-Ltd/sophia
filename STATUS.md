# STATUS

**Project:** SOPHIA
**Last updated:** 2026-03-09
**Current version:** 0.3.0 (`domain-expansion` branch)
**Production revision:** `sophia-00077-256` (Cloud Run, europe-west2) — pending redeploy with Phase 3d/3e/D changes

---

## Deployment health

| Component | State | Notes |
| --- | --- | --- |
| App (Cloud Run) | **Live** | `sophia-210020077715.europe-west2.run.app` |
| Database (SurrealDB / GCE) | **Live** | `sophia-db` VM, europe-west2-b, persistent disk |
| Firebase Auth | **Live** | Google OAuth enforced on consumer/admin APIs; `/api/v1/verify` uses API keys |
| Firestore | **Live** | Per-user history + rate-limit counters |
| Health endpoint | **Passing** | `/api/health` → `{ status: healthy, database: connected }` |
| Auth guard | **Enforced** | `/api/analyse` returns 401 without Bearer token |

---

## Feature matrix

### Working in production

| Feature | Detail |
| --- | --- |
| Three-pass dialectical engine | Analysis → Critique → Synthesis via Vertex AI Gemini 2.5 Flash |
| Google Search grounding | Live web sources returned per pass; emitted as SSE `sources` events |
| Web verification pass | Optional fourth pass cross-checks claims; five confidence tiers |
| Knowledge graph retrieval | Domain-agnostic vector search + multi-hop graph traversal; no domain filter |
| Ethics knowledge graph | ~7,500 claims, 25 sources deployed in SurrealDB |
| Philosophy of Mind knowledge graph | 3,418 claims, 1,443 relations, 255 arguments (Wave 1); tagged `philosophy_of_mind` |
| Streaming (SSE) | Progressive output; user sees Pass 1 completing before Pass 2 starts |
| Firebase Auth | Mandatory Google OAuth; ID token verified server-side on every request |
| Per-user history | Firestore `users/{uid}/queries/{autoId}`, 30-day TTL, cross-device sync |
| Per-user cache | Firestore cache checked before engine run; cache-hit replays stored events |
| Rate limiting | 20 queries/day per uid via Firestore transaction; 429 + `Retry-After: 86400` |
| Reasoning API (`/api/v1/verify`) | **Working** — API key auth, JSON + SSE modes, extraction + reasoning scores |
| Constitution check (`/api/v1/verify`) | **Working** — 10-rule hybrid evaluator + compliance output |
| API key management (`/api/v1/keys`) | **Working** — admin-gated create/list/revoke; Firestore-backed hashed keys |
| Developer waitlist | **Working** — `/api-access` form writes to Firestore `waitlist` |
| Lens parameter (backend) | `lens` string accepted by engine and `/api/analyse`; affects analysis system prompt |
| Follow-up hints | Synthesis parsed for `## Further Questions`; up to 3 suggestion pills shown |
| 3-question limit | Per-topic cap enforced in conversation store |
| Design system | Dark-first, Cormorant Garamond / JetBrains Mono, CSS custom properties throughout |
| Admin dashboard | `/admin` — SurrealDB + Firestore stats, Firebase Auth gated |

### Partial / in progress

| Feature | State | Blocking item |
| --- | --- | --- |
| Philosophy of Mind domain (live in engine) | Graph ingested; engine domain-agnostic; routing/query classification not yet implemented | Phase 3f + engine routing update |
| Argument graph visualisation | Infrastructure exists (`GraphCanvas`, `graphStore`); full "Map" tab UI incomplete | Phase 9 |
| Accessibility | Initial structural fixes applied; full axe-core scan + WCAG 2.2 AA review not done | Phase 4 pre-launch |
| Analytics | No instrumentation yet | Phase 4 |
| E2E test suite | Playwright configured; auth-gated tests require `SOPHIA_TEST_TOKEN` | Token provision |
| Philosophy of Mind Wave 2 | In progress on `domain-expansion` branch | Phase 3f |

### Not yet built

| Feature | Planned phase |
| --- | --- |
| Lens selector UI (`LensSelector.svelte`) | Phase 7 |
| Depth selector UI + engine depth mode | Phase 7 |
| Epistemic constitution evaluator | Phase 6 |
| Constitution dogfood in `/api/analyse` | Phase 6.5 (flagged rollout) |
| Stripe billing / subscriptions | Phase 7 |
| Usage analytics | Phase 4 |
| Privacy policy / terms of service pages | Phase 4 |
| Multi-turn conversation | Phase 9 |
| Formal evaluation study | Phase 9 |

---

## Knowledge graph

| Domain | Sources | Claims | Relations | Arguments | Status |
| --- | --- | --- | --- | --- | --- |
| Ethics | 25/27 | ~7,500 | ~2,800 | ~420 | Live in engine |
| Philosophy of Mind | 9/10 (Wave 1) | 3,418 | 1,443 | 255 | Ingested; engine routing TBD |
| **Total** | **34** | **~10,918** | **~4,243** | **~675** | |

Sources 5 & 8 (ethics) skipped — SEP alternatives included. Source 10 (PoM) skipped — title collision with source 101.

---

## Known issues and constraints

- **PoM domain not yet routed in engine:** The engine is domain-agnostic but the UI and query path have no mechanism to select or detect which domain to retrieve from. Queries about consciousness or mind will retrieve claims from both ethics and PoM corpora indiscriminately. A domain classifier or explicit domain parameter is needed.
- **Single-evaluator Phase 1 results:** The preliminary evaluation (n=10, self-assessed) is not statistically robust. Treat as directional only.
- **Latency:** 15–25s end-to-end (three sequential LLM calls). Inherent to dialectical architecture; disclosed to users.
- **3-question limit:** Pragmatic constraint replacing full multi-turn. Will be superseded in Phase 9.
- **No analytics:** No visibility into query patterns, completion rates, or user behaviour prior to launch.
- **Constitution dogfood rollout pending:** `/api/analyse` constitution emission is behind `ENABLE_CONSTITUTION_IN_ANALYSE`; enable only with rollout guardrails.
- **ARIA deadline:** 24 March 2026 — 15 days from today. Application not yet started.

---

## Immediate priorities (current sprint)

1. **ARIA grant application** (deadline 24 Mar) — highest-leverage action; no engineering required. Position: "Structured reasoning evaluation for trustworthy AI systems."
2. **Phase 3f — PoM Wave 2** — continue domain-expansion branch ingestion (Descartes, Smart, Fodor, Kim, Parfit, Clark & Chalmers).
3. **Phase 4 pre-launch** — accessibility audit, privacy policy, analytics instrumentation, meta tags.
4. **Domain routing** — decide and implement how the engine selects which domain(s) to retrieve from; required before PoM queries are meaningful.

---

## Test coverage

| Suite | Status | Count |
| --- | --- | --- |
| Vitest unit tests | **Passing** | 38 — engine parsing, sophia-meta, rate limiting |
| Playwright E2E (smoke) | **Configured** | Auth-gated flows require `SOPHIA_TEST_TOKEN` |
| Engine integration tests | **Not written** | Auth → query → history flow |
| Error injection tests | **Not written** | Firestore down, grounding offline, auth fail |

---

## Metrics

| Metric | Target | Current |
| --- | --- | --- |
| Query latency p95 | < 3s to first token | ~2.5s (informal) |
| Ethics sources | 27 | 25 (92.6%) |
| PoM sources (Wave 1) | 10 | 9 |
| Total claims in graph | > 10,000 | ~10,918 |
| Uptime | 99.5% | Not formally monitored |
| Daily rate limit | 20 queries/uid | Enforced |
| Paying users | 20 (Phase 7 target) | 0 (pre-launch) |

---

## Ops query reference

- Constitution dogfood logs: see [docs/runbooks/constitution-dogfood-rollout.md](docs/runbooks/constitution-dogfood-rollout.md) and query for `"[CONSTITUTION][ANALYSE]"` in Cloud Logging.
