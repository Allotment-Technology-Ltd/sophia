# SOPHIA Roadmap

**Last updated:** 2026-03-08
**Status:** Phase 3c complete · UX Polish sprint shipped · Pre-launch hardening in progress
**Owner:** @adamboon
**Related:** [STATUS.md](STATUS.md) | [CHANGELOG.md](CHANGELOG.md) | [docs/architecture.md](docs/architecture.md)

---

## Current Status: Pre-Launch Hardening

Phase 3c (MVP Pivot) is functionally complete. A focused UX polish sprint has been applied
on top, addressing animation bugs, navigation, sources display, content quality, and shipping
new features (question limit, follow-up hints, verification animation, hallucination prevention).
The codebase is ahead of production — the next priority is deployment and pre-launch testing.

---

## Completed Phases

### Phase 3a ✅ (Feb 2026)

- SurrealDB persistence (GCE VM, europe-west2)
- Cloud Run deployment + VPC setup
- 8 foundational ethics sources ingested (~500 claims)
- Three-pass engine (originally Claude Sonnet, now Vertex Gemini)
- Graph context retrieval
- Basic admin dashboard

### Phase 3b ✅ (Feb 2026)

- Waves 2 & 3 ingestion (21 additional sources)
- Total: 25/27 sources (~7,500 claims, 92.6% completion)
- Sources 5 & 8 skipped (pragmatic coverage, alternatives included)
- Gemini cross-validation; spot-check accuracy >80%

### Phase 3c ✅ (Mar 2026)

#### 3c-A: Engine Restructure ✅

- Firebase Auth enforced on all `/api/*` routes via `hooks.server.ts` Bearer token check
- `uid` extracted from `locals.user?.uid`
- Successful runs saved to `users/{uid}/queries/{autoId}` in Firestore (30-day TTL)
- Firestore per-user cache checked before SurrealDB and before engine run; cache hit replays stored events

#### 3c-B: UI Implementation ✅

- SidePanel animations with `prefers-reduced-motion` fallback
- SourcesView, ClaimsView, error state with design-system CSS vars
- Loading progress indicator per pass

#### 3c-C: Firestore Integration ✅

- Schema: `users/{uid}/queries/{autoId}` — query, lens, events, createdAt
- Write: `saveFirestoreCache()` on successful run; read: `loadFirestoreCache()` (30-day TTL)
- `/api/history` — GET returns 50 most recent; DELETE removes by doc ID
- HistoryTab wired to Firestore; `syncFromServer()` on auth change

#### 3c-D: Polish & Testing (Partial)

- [x] Basic component structure complete
- [x] Design System B fully implemented (dark-first, Cormorant/JetBrains Mono)
- [ ] Unit tests: engine.ts grounding extraction
- [ ] Integration test: auth → query → history flow
- [ ] E2E test: full user flow (login → query → references → history)
- [ ] Error injection tests (Firestore down, grounding offline, auth fail)
- [ ] Performance: query latency <3s (p95) — currently ~2.5s
- [ ] Accessibility audit (axe-core, WCAG 2.2 AA)

#### 3c-E: Deployment ✅

- [x] Firebase credentials confirmed in Secret Manager (`firebase-api-key`, `firebase-auth-domain`)
- [x] `roles/datastore.user` granted to `sophia-app` SA (Firestore + rate-limit writes)
- [x] Image `app:c742bcc` built (linux/amd64) and pushed to Artifact Registry
- [x] Pulumi `appImageTag` updated + `pulumi up` applied (revision sophia-00077-256)
- [x] Health check passing: `usesophia.app/api/health → status: healthy, database: connected`
- [x] Auth guard verified: `/api/analyse` returns 401 without Bearer token

---

## UX Polish Sprint ✅ (Mar 2026)

### Bug Fixes

- **Animation clipping** — orbital rings container enlarged (120×80 → 160×160px) with padded
  SVG viewBox; rotating rings are no longer cropped
- **Tab navigation** — pass card wrappers given `id="pass-{pass}"` attributes; clicking a nav
  tab calls `scrollIntoView({ behavior: 'smooth' })`
- **History duplication** — removed erroneous `historyStore.addEntry()` from the cache-hit
  branch; loading a cached result no longer creates a duplicate entry
- **Sources panel** — `SourcesView` shows both **Knowledge Base** sources (`referencesStore.sources`)
  and **Web Sources** (`referencesStore.groundingSources`); badge colours use CSS custom properties

### Content Improvements

- **Academic section headers** — all three AI prompts updated to replace `## Roadmap` with
  `## Abstract`, with SEP-style instruction for a 2–4 sentence journal abstract
- **Claims linked to sources** — `Claim` type extended with optional `sourceUrl`; Zod schema
  updated; prompts ask AI to include Google Search URLs in `sophia-meta` claims; `ClaimCard`
  renders source as a clickable link when URL is available
- **Confidence transparency** — claims with `confidence === undefined` show **Interpretive** badge;
  claims below 0.65 show **Unverified** badge; expanded detail panel explains what each means

### Animation Improvements

- **PassTracker** — connector lines fill with sage on completion; active→complete triggers a
  scale flash; checkmark SVG appears inside completed nodes
- **Loading → Results morph** — coordinated Svelte `fly` transitions: loading exits upward,
  results enter from below with staggered delays
- **Verification animation** — while running, button is replaced by amber orbital ring +
  animated ellipsis + explanatory note ("Searching web sources…")
- **Verification nav tab** — `PassNavigator` shows a **Verification** tab (amber accent)
  after web verification has run; clicking scrolls to the verification section

### New Features

- **Follow-up hints** — `extractFurtherQuestions()` parses `## Further Questions` from synthesis;
  `FollowUpHints` displays up to 3 italic suggestion pills above the follow-up input
- **3-question limit** — `questionCount` tracked in conversation store and enforced in
  `submitQuery()`; `QuestionCounter` renders 3 copper dots with scale-flash animation;
  at the limit, the follow-up area shows "Inquiry complete — start a new inquiry"

### Hallucination Prevention

- **Prompt hardening** — all three analysis prompts require explicit attribution; unattributed
  claims prefixed `[Unattributed]`; novel synthesis flagged `[Novel synthesis]`; fabricating
  citations, titles, or quotations explicitly prohibited
- **Verification prompt** — five confidence tiers: `High / Medium / Low / Interpretive / Unsupported`;
  potential hallucinations flagged as "Potential hallucination — verify manually"
- **Claims notice** — `ClaimsView` shows a persistent disclaimer: "Claims are AI-generated.
  Run Web Verification to cross-check. Interpretive claims represent philosophical reasoning."

---

## Security: User Data Isolation

- [x] **ISO-1** localStorage scoped to `sophia-history-{uid}` / `sophia-query-cache-{uid}`
- [x] **ISO-2** Server-side stores are per-session client state; each browser session starts empty
- [x] **ISO-4** Conversation store cleared on sign-out/user switch
- [x] **ISO-3** Server: validate `uid` on history endpoints — Bearer token verified in `hooks.server.ts`; Firestore paths scoped to authenticated `uid`

---

## Architecture: Current State

| Layer | Technology | Status |
|-------|-----------|--------|
| Frontend | SvelteKit 2 / Svelte 5 | ✅ Working |
| Design system | Dark-first, Cormorant/JetBrains Mono, design tokens | ✅ Shipped |
| Auth | Firebase Google OAuth | ✅ Working |
| AI Engine | Vertex AI Gemini 2.0 Flash, 3-pass dialectical | ✅ Working |
| Web search | Google Search grounding (live, per pass + verification) | ✅ Working |
| Knowledge base | SurrealDB, ~7,500 ethics claims | ✅ Deployed |
| Cache (server) | Firestore per-user 30-day TTL | ✅ Working |
| Cache (client) | localStorage scoped to uid | ✅ Working |
| Streaming | SSE via `/api/analyse` and `/api/verify` | ✅ Working |
| Hosting | Cloud Run (europe-west2) | ✅ Live — revision sophia-00077-256 |

---

## Immediate Pre-Launch Checklist

These items must be resolved before any public access:

- [x] **3c-E Deploy** — deployed revision sophia-00077-256; health + auth guard confirmed live
- [x] **ISO-3** — `uid` validation on `/api/history` endpoint (already implemented)
- [x] **3c-D Testing** — vitest unit tests (38 passing): `extractFurtherQuestions`, sophia-meta
  block parsing, `SophiaMetaClaimSchema`, `aggregateConfidenceMetrics`, `checkRateLimit` (mocked);
  Playwright E2E smoke tests configured (`tests/e2e/app.test.ts`); auth-gated tests require
  `SOPHIA_TEST_TOKEN` env var for full flow coverage
- [ ] **Accessibility** — axe-core scan + WCAG 2.2 AA review of new components; initial fixes done:
  ClaimCard `<a>`-in-`<button>` resolved (div+role=button); PassNavigator `:focus-visible` added;
  FollowUpHints wrapper given `role="group"`; QuestionCounter has `aria-live="polite"` and `aria-label`
- [x] **Rate limiting** — 20 queries/day per uid via Firestore transaction in `hooks.server.ts`;
  429 + `Retry-After: 86400` returned when exceeded; stored at `users/{uid}/rateLimits/daily`

---

## Upcoming Phases

### Phase 4: Knowledge Graph Visualisation (Next major feature)

**Depends on:** Phase 3c deployment
**Design agreed:** New dedicated "Map" tab in PassNavigator

- `ClaimMapView` component as a 4th tab, rendered in the results column
- Layered force-directed graph with three zones:
  - **Knowledge Base** (left) — RAG retrieval claims (amber)
  - **AI Reasoning** (centre) — analysis/critique/synthesis claims (sage/copper/blue)
  - **Web Verification** (right) — grounding source nodes (purple)
- Source nodes as diamonds; claim nodes as circles; colour-coded by pass
- `graphStore.addGroundingSources()` to link web sources to claims via `supports` edges
- Click-to-expand node detail; legend panel
- Exposes full argument provenance chain

### Phase 5: Rate Limiting + Analytics

- Per-user rate limits (10 req/min, 100 req/day)
- Query analytics to BigQuery
- Cost tracking per user (Google AI API, Cloud Run)
- Admin dashboard

### Phase 6: Multi-turn Conversation

Supersedes the current 3-question limit with a richer session model:

- Conversation history maintained across queries within a session
- Context-aware follow-ups (AI sees prior turns)
- Claim refinement loops (user flags a claim → re-examination requested)
- Session persistence in Firestore

### Phase 7: Domain Expansion

- Law & policy (`legal-ethics`, `AI-regulation`)
- Medicine & bioethics
- Technology & information ethics
- Economics & capitalism ethics

### Phase 8: Payments + API

- Stripe integration
- Public API with API keys
- Usage-based billing
- Premium: batch analysis, export, longer sessions

---

## Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Query latency (p95) | <3s | ~2.5s |
| Sources ingested | 27 | 25 (92.6%) |
| Claims in graph | >2000 | ~7,500 |
| Uptime SLA | 99.5% | Untested in prod |
| Questions per topic | 3 (enforced) | ✅ Shipping |
| Web verification | Post-synthesis | ✅ Working |

---

## Suggested Next Steps

1. **Deploy (3c-E)** — the codebase is ahead of production; deploy to Cloud Run to unblock
   any live testing. This is the single highest-leverage action right now.

2. **ISO-3** — add `uid` validation to `/api/history` before any non-test user is allowed on
   the platform. One-line check in the route handler.

3. **Accessibility pass** — the new components (QuestionCounter, FollowUpHints, PassNavigator
   verification tab, ClaimCard source links) need axe-core scanning and keyboard testing.

4. **Knowledge Graph Visualisation (Phase 4)** — the "Map" tab design is agreed and the
   GraphCanvas + graphStore infrastructure already exists. This is the next major feature that
   differentiates SOPHIA from a standard AI chatbot.

5. **Basic rate limiting** — even a simple `X-RateLimit` check in `hooks.server.ts` (e.g. 20
   queries/day per uid via Firestore counter) is sufficient before any public traffic.
   Full analytics can follow in Phase 5.

6. **Complete sources ingestion** — sources 5 & 8 are still missing (92.6% coverage).
   Worth re-attempting or substituting before domain expansion.

7. **Multi-turn conversation (Phase 6)** — the current 3-question limit is a pragmatic
   constraint, not the final product. Once rate limiting and costs are controlled, upgrade
   to full conversation history with context-aware follow-ups.

---

## How to Use This Document

1. **Current task?** See "Immediate Pre-Launch Checklist"
2. **Planning a sprint?** Pick from "Upcoming Phases" in priority order
3. **Track per-task:** Mark [ ] as [x] when complete
4. **Update on merge:** After each PR, update this file in the same commit
5. **Review biweekly:** Keep age < 14 days

---

## See Also

- [docs/MVP-PIVOT-PLAN.md](docs/MVP-PIVOT-PLAN.md) — Full Phase A–J implementation breakdown
- [docs/AGENT-IMPLEMENTATION-PROMPT.md](docs/AGENT-IMPLEMENTATION-PROMPT.md) — Agent onboarding
- [docs/architecture.md](docs/architecture.md) — System design + deployment
- [STATUS.md](STATUS.md) — Operational health status
