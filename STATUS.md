# STATUS

**Project:** SOPHIA
**Last updated:** 2026-03-09
**Current version:** 0.2.0 (`domain-expansion` branch)
**Production revision:** `sophia-00077-256` (Cloud Run, europe-west2)

---

## Deployment health

| Component | State | Notes |
| --- | --- | --- |
| App (Cloud Run) | **Live** | `sophia-210020077715.europe-west2.run.app` |
| Database (SurrealDB / GCE) | **Live** | `sophia-db` VM, europe-west2-b, persistent disk |
| Firebase Auth | **Live** | Google OAuth enforced on all `/api/*` routes |
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
| Knowledge graph retrieval | Vector search + multi-hop graph traversal on ~7,500 ethics claims |
| Streaming (SSE) | Progressive output; user sees Pass 1 completing before Pass 2 starts |
| Firebase Auth | Mandatory Google OAuth; ID token verified server-side on every request |
| Per-user history | Firestore `users/{uid}/queries/{autoId}`, 30-day TTL, cross-device sync |
| Per-user cache | Firestore cache checked before engine run; cache-hit replays stored events |
| Rate limiting | 20 queries/day per uid via Firestore transaction; 429 + `Retry-After: 86400` |
| Follow-up hints | Synthesis parsed for `## Further Questions`; up to 3 suggestion pills shown |
| 3-question limit | Per-topic cap enforced in conversation store; UI confirms completion |
| Design system | Dark-first, Cormorant Garamond / JetBrains Mono, CSS custom properties throughout |
| Admin dashboard | `/admin` — SurrealDB + Firestore stats, Firebase Auth gated |

### Partial / in progress

| Feature | State | Blocking item |
| --- | --- | --- |
| Argument graph visualisation | Infrastructure exists (`GraphCanvas`, `graphStore`); full "Map" tab UI incomplete | Phase 4 implementation |
| Accessibility | Initial fixes applied; full axe-core scan + WCAG 2.2 AA review not done | Accessibility sprint |
| E2E test suite | Playwright configured; auth-gated tests require `SOPHIA_TEST_TOKEN` env var | Token provision |
| Embedding standardisation | Ingestion corpus uses Voyage AI (1024-dim); runtime uses Vertex AI text-embedding-005 (768-dim); MTREE index migration pending | Phase 3d-A1 |
| Domain expansion (Philosophy of Mind) | Source list drafted (`data/source-list-pom.json`); ingestion blocked on embedding standardisation | Phase 3d → 3e |

### Not yet built

| Feature | Planned phase |
| --- | --- |
| Multi-turn conversation (context across queries) | Phase 6 |
| Knowledge graph visualisation (full "Map" tab) | Phase 4 |
| Query analytics / cost tracking | Phase 5 |
| Public API with API keys | Phase 8 |
| Payments (Stripe) | Phase 8 |
| Formal evaluation study (n=50+, independent evaluators) | Phase 6 |

---

## Known issues and constraints

- **MVP domain filter:** The live engine is constrained to the ethics knowledge graph (`MVP_DOMAIN_FILTER = 'ethics'` in `engine.ts`). The knowledge graph stores data from 25 sources but non-ethics domains are not yet populated. This filter will be lifted after Philosophy of Mind ingestion clears quality gates.
- **Embedding dimension mismatch:** The ethics corpus was ingested with Voyage AI embeddings (1024-dim). Runtime query embedding uses Vertex AI `text-embedding-005` (768-dim). Retrieval works because both are normalised for cosine similarity, but a full re-embedding migration (`reembed-corpus.ts`) is required before domain expansion to maintain consistency.
- **Single-evaluator Phase 1 results:** The preliminary evaluation showing SOPHIA outperforms single-pass on 8/10 queries used a single evaluator who is also the author. This is a known bias. Results should be treated as directionally promising, not statistically significant.
- **Latency:** End-to-end query time is 15–25 seconds (three sequential LLM calls). This is inherent to the dialectical architecture and is disclosed to users.
- **3-question limit:** A pragmatic per-topic cap currently replaces a full multi-turn conversation model. This will be superseded in Phase 6.

---

## Immediate priorities (current sprint)

1. **Accessibility audit** — axe-core scan + keyboard testing of new components (QuestionCounter, FollowUpHints, ClaimCard source links). Initial structural fixes are done; full WCAG 2.2 AA review is outstanding.
2. **Phase 3d-A1** — Embedding standardisation: update `ingest.ts` to Vertex AI `text-embedding-005` (768-dim), update MTREE index dimension, run `reembed-corpus.ts` against ethics corpus. This unblocks Philosophy of Mind ingestion.
3. **Phase 3d-A2** — Idempotent ingestion: per-stage JSON checkpoints + `--force-stage` flag. Required for reliable large-batch ingestion.
4. **Philosophy of Mind Wave 1** — Nagel, Chalmers, Jackson, Dennett, Block + Turing, Searle (10 sources). Depends on Phase 3d.

---

## Test coverage

| Suite | Status | Count |
| --- | --- | --- |
| Vitest unit tests | **Passing** | 38 tests — `extractFurtherQuestions`, sophia-meta parsing, `SophiaMetaClaimSchema`, `aggregateConfidenceMetrics`, `checkRateLimit` |
| Playwright E2E (smoke) | **Configured** | Auth-gated flows require `SOPHIA_TEST_TOKEN` |
| Engine integration tests | **Not written** | Auth → query → history flow |
| Error injection tests | **Not written** | Firestore down, grounding offline, auth fail |

---

## Metrics

| Metric | Target | Current |
| --- | --- | --- |
| Query latency p95 | < 3s first token | ~2.5s (not formally measured) |
| Sources ingested | 27 | 25 (92.6%) — sources 5 & 8 skipped |
| Claims in graph | > 2,000 | ~7,500 |
| Uptime | 99.5% | Not formally monitored |
| Daily rate limit | 20 queries/uid | Enforced via Firestore |
