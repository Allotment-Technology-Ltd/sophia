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

## Phase 3c — In Progress

### 3c-A: Engine Restructure (70% done)
**Status:** Google Search grounding fully implemented; Vertex AI embeddings live; sophia-meta parsing working

**Remaining tasks:**
- [ ] **A1** Wire Firebase Auth guards to all protected routes ← CRITICAL
- [ ] **A2** Add `requireAuth()` middleware to `/api/analyse`
- [ ] **A3** Extract uid from ID token in request handler
- [ ] **A4** Save query to Firestore after each query completes
- [ ] **A5** Load query history from Firestore on request
- [ ] **A6** Delete unused `passRefinement.ts` file

**Verification:** Manual test: authenticated user submits query → output streams → history saves → user can reload and retrieve

### 3c-B: UI Implementation (50% done)
**Status:** Design tokens locked; components created; references panel scaffold exists

**Remaining tasks:**
- [ ] **B1** SidePanel animations (40ms slide+fade, prefers-reduced-motion)
- [ ] **B2** SourcesView component (render grounding sources as link cards)
- [ ] **B3** ClaimsView component (render sophia-meta claims with badges)
- [ ] **B4** Error boundary + graceful degradation UI
- [ ] **B5** Mobile responsive testing (<768px overlay behavior)
- [ ] **B6** ARIA labels + keyboard navigation (tab, enter, escape)
- [ ] **B7** Loading states (skeleton screens, pass indicators)

**Verification:** Visual regression test against Design B mockups

### 3c-C: Firestore Integration (0% done)
**Status:** Firebase Admin SDK initialized but not wired

**Remaining tasks:**
- [ ] **C1** Create Firestore schema: `users/{uid}/queries/{queryId}`
- [ ] **C2** Add write in `/api/analyse`: save query + response metadata
- [ ] **C3** Add read in `/api/analyse`: check query_cache for memoization
- [ ] **C4** Implement cache invalidation (purge on source updates)
- [ ] **C5** Create query history fetch endpoint (`/api/history`)
- [ ] **C6** Wire HistoryTab data source to Firestore

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
- [ ] **E3** Run GCP org migration (transfer from personal to admin@usesophia.app)
- [ ] **E4** Deploy new image to Cloud Run
- [ ] **E5** Smoke test production

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
