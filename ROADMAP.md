# SOPHIA Roadmap

**Last updated:** 2026-03-06  
**Status:** Phase 3c in-progress (MVP Pivot architecture overhaul)  
**Owner:** @adamboon  
**Related:** [STATUS.md](STATUS.md) | [CHANGELOG.md](CHANGELOG.md) | [docs/architecture.md](docs/architecture.md)

---

## Current Status: Phase 3c (MVP Pivot) — In Progress

**What is Phase 3c?**  
Architectural overhaul of the three-pass engine and UI. The pivot replaces Anthropic Claude with Vertex AI Gemini, adds Google Search grounding, mandatory Firebase Auth, and a complete UI redesign with side-panel references and graph visualization.

**Progress:** 60% complete  
**Timeline:** Started Feb 2026, targeting early April 2026  
**Blockers:** Auth integration, Firestore wiring

---

## Completed Phases

### Phase 3a ✅ (Feb 2026)
- SurrealDB persistence (GCE VM, europe-west2)
- Cloud Run deployment + VPC setup
- 8 foundational ethics sources ingested (~500 claims)
- Three-pass engine (Claude Sonnet via Anthropic SDK)
- Graph context retrieval
- Basic admin dashboard

### Phase 3b ✅ (Feb 2026)
- Waves 2 & 3 ingestion (21 additional sources)
- Total: 25/27 sources (~7,500 claims, 92.6% completion)
- Sources 5 & 8 skipped (pragmatic coverage, alternatives included)
- Gemini cross-validation
- Spot-check accuracy >80%

---

## 🚨 Security Blocker: User Data Isolation

**Discovered:** 2026-03-06
**Severity:** Critical — blocks any public access
**Status:** Partially resolved (2026-03-06)

All signed-in users currently see each other's queries and history. There is no per-user scoping anywhere in the data layer or UI store. This must be fixed before any non-test users are allowed on the platform.

**Root cause:** The in-memory conversation store and any persisted history are not scoped to `uid`. Firestore (3c-C) is not yet wired, so nothing is saved per-user. The UI simply shows whatever is in the shared store.

**Required fixes (in order):**

- [x] **ISO-1** Scope localStorage history/cache keys to `sophia-history-{uid}` and `sophia-query-cache-{uid}` — users on the same browser can no longer read each other's data
- [x] **ISO-2** Server-side leakage confirmed absent — stores are client-side Svelte 5 state, each browser session starts empty. `historyStore.setUid()` called on auth change reloads state per-user.
- [ ] **ISO-3** Server: never return another user's data — validate `uid` on history/query endpoints ← deferred until Firestore history API exists (3c-C)
- [x] **ISO-4** Client: clear conversation store on sign-out / user switch via `onAuthChange` in `+layout.svelte`

**Note:** ISO-3 remains open — no server-side per-user history endpoint exists yet. Revisit when 3c-C Firestore integration is built.

---

## Phase 3c — In Progress

### 3c-A: Engine Restructure ✅ (100% done)
**Status:** Complete (2026-03-06)

- [x] **A1** Firebase Auth enforced on all `/api/*` routes via `hooks.server.ts` Bearer token check
- [x] **A2** `/api/analyse` handler uses `locals` (populated by hook) — no separate middleware needed
- [x] **A3** `uid` extracted from `locals.user?.uid` in request handler
- [x] **A4** Successful runs saved to `users/{uid}/queries/{autoId}` in Firestore (30-day TTL)
- [x] **A5** Firestore per-user cache checked before SurrealDB and before engine run; cache hit replays stored events
- [x] **A6** `passRefinement.ts` already deleted — confirmed absent

**Verification:** Manual test: authenticated user submits query → output streams → saved to Firestore → second request for same query replays from Firestore cache

### 3c-B: UI Implementation ✅

**Status:** Complete

- [x] **B1** SidePanel animations — opacity fade + `@media (prefers-reduced-motion: reduce)` fallback
- [x] **B2** SourcesView component (render grounding sources as link cards)
- [x] **B3** ClaimsView component (render sophia-meta claims with badges)
- [x] **B4** Error state redesigned with design-system CSS vars + Retry button
- [x] **B5** `.main-content.panel-open` applies `margin-right: 380px` on desktop
- [x] **B6** `aria-controls` added to all pass tab buttons; content panels have matching IDs
- [x] **B7** Loading progress indicator shows "Pass N of 3 · Label" when pass is known

**Verification:** Visual regression test against Design B mockups

### 3c-C: Firestore Integration ✅

**Status:** Complete

- [x] **C1** Firestore schema: `users/{uid}/queries/{autoId}` — query, lens, events, createdAt
- [x] **C2** Write in `/api/analyse`: `saveFirestoreCache()` persists on successful run
- [x] **C3** Read in `/api/analyse`: `loadFirestoreCache()` checked before engine run (30-day TTL)
- [x] **C4** Cache invalidation: stale/failed entries purged on read; DELETE `/api/history?id=` for manual purge
- [x] **C5** `/api/history` endpoint — GET returns 50 most recent queries; DELETE removes by doc ID
- [x] **C6** HistoryTab wired to Firestore: `syncFromServer()` on auth change; delete button calls `deleteEntry()`

**Verification:** User creates query → appears in history → reload page → history still there

### 3c-D: Polish & Testing (10% done)
**Status:** Basic component structure done; testing minimal

**Remaining tasks:**
- [ ] **D1** Unit tests: engine.ts grounding extraction
- [ ] **D2** Integration test: auth → query → history flow
- [ ] **D3** E2E test: full user flow (login → query → references → history)
- [ ] **D4** Error injection tests (Firestore down, grounding offline, auth fail)
- [ ] **D5** Performance: query latency <3s (p95)
- [ ] **D6** Accessibility audit (axe-core, manual WCAG 2.2 AA check)

**Verification:** All tests passing; lighthouse score >90

### 3c-E: Deployment (0% done)
**Status:** Cluster unchanged since Phase 3a; new secrets needed

**Remaining tasks:**
- [ ] **E1** Add Firebase credentials to Secret Manager
- [ ] **E2** Update Cloud Run env vars (FIREBASE_PROJECT_ID, etc)
- [ ] **E4** Deploy new image to Cloud Run

**Verification:** `curl https://sophia.usesophia.app/api/health` → 200 OK

---

## Upcoming Phases (Post-MVP)

### Phase 4: Web Search + Gap Filling (4–6 weeks)
**Depends on:** Phase 3c complete

- Google Search grounding (via `@ai-sdk/google`) already integrated into analysis, critique, and synthesis passes
- Grounding sources surfaced to the UI per pass
- Credibility scoring of grounding results
- Fallback to graph-only if search fails

### Phase 5: Rate Limiting + Analytics (2–3 weeks)
- Per-user rate limits (10 req/min, 100 req/day)
- Query analytics to BigQuery
- Cost tracking (Google AI API, Cloud Run)
- Admin dashboard analytics

### Phase 6: Payments + API (paid version)
- Stripe integration
- Public API with API keys
- Usage-based billing
- Premium features (batch analysis, export)

### Phase 7: Domain Expansion (ongoing)
- Law & policy (`legal-ethics`, `AI-regulation`)
- Medicine & bioethics
- Technology & information ethics
- Economics & capitalism ethics

### Phase 8: Conversation & Context (future)
- Multi-turn conversation persistence
- Context awareness across queries
- Claim refinement loops
- Source feedback integration

---

## Quality Gates for Phase 3c Completion

All the following must pass before MVP launch:

- [ ] **Auth:** Firebase Auth working on all protected routes
  - [ ] Unauthenticated user redirected to login
  - [ ] Authenticated user can query
  - [ ] All API calls require valid ID token
  
- [ ] **Retrieval:** Graph context injection works
  - [ ] 10 test queries return relevant claims
  - [ ] Grounding sources appear in output
  - [ ] Top-1 relevance >0.75 (manual spot-check)

- [ ] **Engine:** Three-pass streaming complete
  - [ ] Analysis starts immediately
  - [ ] Critique starts at ~30% of Analysis
  - [ ] Both stream simultaneously
  - [ ] Synthesis waits for both
  - [ ] Total latency <3s for typical queries

- [ ] **History:** Firestore persistence working
  - [ ] Query saved within 30s of completion
  - [ ] History tab shows last 10 queries
  - [ ] Can click history item to replay
  - [ ] No re-execution on replay (cached)

- [ ] **UI:** References panel functional
  - [ ] Claims tab shows sophia-meta claims
  - [ ] Sources tab shows grounding URLs
  - [ ] Panel responsive on mobile
  - [ ] No accessibility violations (axe-core)

- [ ] **Performance:** 
  - [ ] Query latency p95 <3s
  - [ ] Page load <2s
  - [ ] SSE streaming starts <500ms

- [ ] **Deployment:**
  - [ ] Cloud Run healthy check green
  - [ ] All secrets in Secret Manager
  - [ ] No hardcoded credentials
  - [ ] Pulumi state recent

---

## What's NOT in Phase 3c

- ❌ Web search grounding (Phase 4)
- ❌ Rate limiting (Phase 5)
- ❌ Payments (Phase 6)
- ❌ Domain expansion (Phase 7)
- ❌ Conversation memory (Phase 8)

---

## Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Query latency (p95) | <3s | ~2.5s |
| Sources ingested | 27 | 25 (92.6%) |
| Claims in graph | >2000 | ~7,500 |
| Uptime SLA | 99.5% | Untested |
| Unique users (MVP) | Conservative | TBD |

---

## How to Use This Document

1. **Prioritize:** Read "Current Status" and "Phase 3c" sections first
2. **Plan sprint:** Pick tasks from Phase 3c sections with no dependencies
3. **Track per-task:** Mark [ ] as [x] when task completes
4. **Update on merge:** After PR merge, update this file in same commit
5. **Review biweekly:** Ensure age < 14 days; update after any milestone

---

## See Also

- [docs/MVP-PIVOT-PLAN.md](docs/MVP-PIVOT-PLAN.md) — Full Phase A–J implementation breakdown
- [docs/AGENT-IMPLEMENTATION-PROMPT.md](docs/AGENT-IMPLEMENTATION-PROMPT.md) — Agent onboarding
- [docs/architecture.md](docs/architecture.md) — System design + deployment
- [STATUS.md](STATUS.md) — Operational health status
