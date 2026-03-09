# SOPHIA — MVP Pivot Plan (Phase 2)

**Date:** 2 March 2026
**Status:** Approved for implementation
**Companion document:** `docs/AGENT-IMPLEMENTATION-PROMPT.md`

---

## Executive Summary

SOPHIA's three-pass dialectical engine is architecturally sound but operationally broken. The retrieval pipeline (Voyage AI → SurrealDB vector search → context injection) fails silently, references never display, and the result is indistinguishable from a single Gemini call. This pivot retains the three-pass structure and the curated philosophical knowledge graph while adding Google Search grounding as a live verification layer, Firebase Auth for mandatory identity, Firestore for persistent history, and a complete UI overhaul that keeps users engaged throughout the 2-minute generation cycle.

### Core Thesis

The SurrealDB knowledge graph is the **philosophical foundation** — curated claims with typed logical relations. Google Search grounding is the **evidence layer** — live web sources that verify, challenge, and extend the graph claims. Neither alone is sufficient. Together they produce something no single LLM call can: structured dialectical reasoning grounded in both curated scholarship and current sources.

### Key Decisions (Locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Auth | Firebase Auth, Google Sign-In, **mandatory** | Zero-infra on GCP. All users authenticated. |
| History storage | Firestore | Pairs with Firebase Auth UIDs. Serverless. Free tier. |
| SurrealDB | Keep permanently as knowledge graph | Curated corpus is irreplaceable. |
| Embedding provider | Vertex AI `text-embedding-005` replaces Voyage AI | Eliminates external vendor. Google-hosted. |
| Embedding migration | Overwrite with backup/rollback | One-time re-embedding of ~6,500 claims. Backup first. |
| Pass parallelism | Hybrid (Analysis first → Critique after ~30%) | ~40% faster than sequential. Critique sees partial Analysis. |
| Post-pass extraction | Remove. Inline `sophia-meta` block. | One call per pass instead of two. Faster, more coherent. |
| VPC/SurrealDB access | Keep VPC connector, accept occasional degradation | Grounding provides safety net. Track managed alternative for future. |
| Admin dashboard | Show everything (SurrealDB + Firestore) | Full operational visibility. |
| UI | Complete overhaul with progressive engagement | Users never see a blank screen. |

---

## Current Architecture (Pre-Pivot)

```
User (browser, no auth)
    │
    ▼
SvelteKit (Cloud Run, europe-west2)
    │
    ├─► Voyage AI (embedding) ──► SurrealDB (vector search + graph traversal)
    │       └─► Context block injected into prompts (fails silently)
    │
    ├─► Gemini 2.5 Pro (3 sequential passes, no grounding)
    │       └─► Raw text streamed via SSE
    │
    ├─► Gemini 2.5 Flash (3× post-pass extraction + 3× section refinement = 6 extra calls)
    │       └─► Structured claims + sections (frequently fails)
    │
    └─► localStorage (browser-only history, no persistence)
```

**Problems:**
- 3 external vendor dependencies in the live path (Voyage, Anthropic legacy, SurrealDB over VPC)
- No authentication — anyone can hit the API, no user identity
- History is localStorage only — lost on device change or browser clear
- References/Sources panel never populates because retrieval fails silently
- 6 extra LLM calls per query for extraction/refinement that frequently error
- Users stare at a blank screen for 2–4 minutes
- Admin dashboard is completely unprotected
- No live web sources — output is indistinguishable from a raw Gemini call

---

## Target Architecture (Post-Pivot)

```
User (browser, Firebase Auth mandatory)
    │ ID token in Authorization header
    ▼
SvelteKit (Cloud Run, europe-west2)
    │
    ├─► SurrealDB Knowledge Graph (VPC connector → GCE VM)
    │       │  Vertex AI text-embedding-005 replaces Voyage
    │       └─► Structured context block (claims + typed relations + sources)
    │
    ├─► Gemini 2.5 Pro + Google Search Grounding (3 hybrid-parallel passes)
    │       ├─► Streaming text via SSE (per-pass report cards)
    │       ├─► Grounding sources via SSE (real URLs, per-pass)
    │       └─► Inline sophia-meta block (structured claims, no extra LLM call)
    │
    ├─► Firestore
    │       ├─► users/{uid}/queries/{queryId} — persistent cross-device history
    │       ├─► query_cache/{hash} — server-side memoisation (replaces SurrealDB query_cache)
    │       ├─► grounding_discoveries/{hash} — auto-captured web sources for corpus growth
    │       └─► veracity_signals/{claimId} — grounding vs graph confidence delta
    │
    └─► Firebase Auth (Google Sign-In, mandatory)
            └─► User identity, session management, admin gating
```

---

## Implementation Phases

### Phase A: Google Search Grounding (Working Sources)

The single highest-impact change. Every pass gets live, verified web sources with real URLs.

#### A1. Enable grounding in all 3 passes

**File:** `src/lib/server/engine.ts`
**Change:** Add `tools: { googleSearch: googleVertexTools.googleSearch() }` to every `streamText()` call inside `streamPassWithContinuation()`.

**Import:** `import { googleVertexTools } from '@ai-sdk/google-vertex';`

**Remove:** The existing `buildGroundingTool()` function in `src/lib/server/vertex.ts` — it's a hand-rolled configuration that predates the SDK's proper tool export and was never wired in.

**Verification:** After this change, `stream.sources` returns `LanguageModelV3Source[]` objects with `{ sourceType: 'url', url, title }` for each pass.

#### A2. Extract grounding sources from stream

**File:** `src/lib/server/engine.ts`
**Change:** After each pass's stream completes (after `await stream.totalUsage`), access `await stream.sources`. Collect these as `GroundingSource[]` per pass.

**Type definition** (add to `src/lib/types/api.ts`):
```typescript
export interface GroundingSource {
  url: string;
  title?: string;
  pass: PassType;
}
```

#### A3. New SSE event: `grounding_sources`

**File:** `src/lib/types/api.ts`
**Change:** Add to `SSEEvent` union:
```typescript
| { type: 'grounding_sources'; pass: PassType; sources: GroundingSource[] }
```

**File:** `src/routes/api/analyse/+server.ts`
**Change:** Add `onGroundingSources` callback to the engine callbacks. Emit `grounding_sources` event after each pass completes.

**File:** `src/lib/server/engine.ts`
**Change:** Add `onGroundingSources(pass: PassType, sources: GroundingSource[]): void` to `EngineCallbacks` interface. Call it after each pass with the collected sources.

#### A4. Wire grounding sources to References panel

**File:** `src/lib/stores/references.svelte.ts`
**Change:** Add `groundingSources` state array of type `GroundingSource[]`. Add `addGroundingSources(pass, sources)` method.

**File:** `src/lib/utils/sseHandler.ts`
**Change:** Handle `grounding_sources` event type — route to `referencesStore.addGroundingSources()`.

**File:** `src/lib/components/references/SourcesView.svelte`
**Change:** Rewrite to render grounding sources as clickable link cards grouped by pass. Each card shows: domain favicon, page title, URL, and which pass cited it.

#### A5. Update context block format for graph + grounding synergy

**File:** `src/lib/server/retrieval.ts` → `buildContextBlock()` function
**Change:** Restructure the context block to make graph relations explicit:

```
=== PHILOSOPHICAL KNOWLEDGE GRAPH CONTEXT ===

CLAIM [c:001] (thesis, confidence: 0.87, source: "Critique of Pure Reason")
"Space is not an empirical concept derived from outer experiences"
  ├─ SUPPORTS [c:003] "Space is a necessary a priori representation"
  └─ CONTRADICTS [c:045] "All knowledge derives from sensory experience"

=== END KNOWLEDGE GRAPH CONTEXT ===

Use Google Search to verify, challenge, or extend these claims with current sources.
```

#### A6. Update pass system prompts for graph + grounding

**Files:** `src/lib/server/prompts/analysis.ts`, `critique.ts`, `synthesis.ts`
**Change:** Add instruction to each system prompt:

> You have been provided with structured claims from a curated philosophical knowledge graph. Use Google Search grounding to verify these claims against scholarly sources, find counterarguments, and identify recent developments. When citing knowledge graph claims, reference them by their claim ID (e.g., [c:001]). When citing web sources, the grounding system will automatically attach URLs.

---

### Phase B: Replace Voyage AI with Vertex AI Embeddings

Eliminates the Voyage AI vendor dependency. The knowledge graph's vector search continues to work, powered by Google-hosted embeddings.

#### B1. Backup existing vectors

**New file:** `scripts/backup-vectors.ts`
**Purpose:** Export all claim IDs and their current Voyage-generated 1024-dim embeddings to a JSON file in `data/backups/`. This is the rollback path if re-embedding fails.

```typescript
// Pseudocode
const claims = await query('SELECT id, embedding FROM claim WHERE embedding IS NOT NULL');
fs.writeFileSync(`data/backups/vectors-voyage-${timestamp}.json`, JSON.stringify(claims));
```

**Verification:** Backup file exists with ~6,500 entries, each with a 1024-element float array.

#### B2. Implement Vertex AI embedding client

**File:** `src/lib/server/embeddings.ts`
**Change:** Replace the Voyage AI client with Vertex AI's text embedding API.

- Remove `voyageai` import and client initialisation
- Add Vertex AI embedding call via `@google-cloud/aiplatform` or direct REST to `https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/text-embedding-005:predict`
- Output dimension: 768 (Vertex AI `text-embedding-005` native dimension)
- Maintain the same export interface: `embedQuery(text)` → `number[]` and `embedText(text)` → `number[]`

#### B3. Re-embed the corpus

**New file:** `scripts/reembed-corpus.ts`
**Purpose:** Read all claims from SurrealDB, embed each via Vertex AI, write the new 768-dim vectors back. Process in batches of 100 with rate limiting.

**Critical:** Before overwriting, verify the backup from B1 exists and is complete.

**SurrealDB schema change:** The vector index dimension must change from 1024 to 768:
```sql
REMOVE INDEX claim_embedding ON claim;
DEFINE INDEX claim_embedding ON claim FIELDS embedding MTREE DIMENSION 768;
```

#### B4. Rollback script

**New file:** `scripts/restore-vectors.ts`
**Purpose:** Read the backup JSON from B1, restore the original 1024-dim Voyage vectors to SurrealDB, and recreate the 1024-dim index. This is the emergency rollback if re-embedding produces bad results.

**Verification:** After re-embedding, run `scripts/test-retrieval.ts` with 5 known queries and verify that retrieved claims are semantically relevant. Compare retrieval results before and after.

---

### Phase C: Engine Restructure — Hybrid Parallel Passes

#### C1. Hybrid parallelism in `runDialecticalEngine()`

**File:** `src/lib/server/engine.ts`
**Change:** Replace the fully sequential `Analysis → Critique → Synthesis` with:

1. Start Analysis immediately. Stream chunks to client via `onPassChunk('analysis', ...)`.
2. Accumulate Analysis output. Once it reaches ~2000 characters (~500 words, ~30% of expected output), start Critique in parallel. Pass the partial Analysis text to the Critique prompt.
3. Both Analysis and Critique stream simultaneously. The client receives interleaved `pass_chunk` events for both passes.
4. Once **both** Analysis and Critique complete, start Synthesis with both full outputs.

**Implementation pattern:**
```typescript
// Pseudocode
const analysisPromise = streamPassWithContinuation('analysis', ...);
let analysisPartialText = '';
let critiqueStarted = false;
let critiquePromise: Promise<...> | null = null;

// In the analysis chunk callback:
onAnalysisChunk(chunk) {
  analysisPartialText += chunk;
  callbacks.onPassChunk('analysis', chunk);
  if (!critiqueStarted && analysisPartialText.length >= 2000) {
    critiqueStarted = true;
    callbacks.onPassStart('critique');
    critiquePromise = streamPassWithContinuation('critique', critiqueSystem,
      buildCritiqueUserPrompt(query, analysisPartialText + '\n[Analysis in progress...]'),
      callbacks
    );
  }
}

const analysisResult = await analysisPromise;
// If critique hasn't started yet (very short analysis), start it now
if (!critiqueStarted) { ... }
const critiqueResult = await critiquePromise;
// Now start synthesis with both full outputs
```

**Expected latency:** ~2m10s (down from ~3m30s)

#### C2. Update Critique prompt for partial input

**File:** `src/lib/server/prompts/critique.ts`
**Change:** Add to system prompt:

> The Analysis output you receive may be partial (in progress) or complete. Apply your critical reasoning to whatever content is available. Focus on the arguments, premises, and positions presented so far. If the Analysis appears incomplete, note this but proceed with your critique of the available material.

#### C4. Add word limits to all pass prompts

**Files:** `src/lib/server/prompts/analysis.ts`, `critique.ts`, `synthesis.ts`
**Change:** Add word limits to each system prompt:

- **Analysis** (Pass 1): "Your response should be 500–750 words."
- **Critique** (Pass 2): "Your response should be 500–750 words."
- **Synthesis** (Pass 3): "Your response should be 750–1000 words."

Include these limits as explicit constraints in the system prompt so the model complies during streaming.

#### C3. Update client for concurrent pass streaming

**File:** `src/lib/stores/conversation.svelte.ts`
**Change:** The store already handles `pass_start`/`pass_chunk`/`pass_complete` per pass type. The change is that `pass_start('critique')` may arrive before `pass_complete('analysis')`. Ensure both passes' text accumulates independently.

**File:** `src/routes/+page.svelte`
**Change:** When two passes are streaming simultaneously, show both pass tabs as active (with streaming indicators on both). Default the visible tab to the most recently started pass. User can freely switch between active tabs.

---

### Phase D: Drop Post-Pass Extraction, Inline Structured Output

#### D1. Add `sophia-meta` block instruction to prompts

**Files:** `src/lib/server/prompts/analysis.ts`, `critique.ts`, `synthesis.ts`
**Change:** Append to each system prompt:

> After completing your analysis, append a structured metadata block. This block MUST be fenced with triple backticks and the language tag `sophia-meta`. The block contains JSON with two arrays: `sections` (id, heading, content summary) and `claims` (id, text, badge, source, tradition, confidence). Example:
>
> \`\`\`sophia-meta
> {"sections":[{"id":"the-questions","heading":"The Question(s)","content":"..."}],"claims":[{"id":"c1","text":"...","badge":"thesis","source":"Kant","tradition":"Kantian deontology","confidence":0.85}]}
> \`\`\`

#### D2. Parse `sophia-meta` from stream output

**File:** `src/lib/server/engine.ts`
**Change:** After each pass completes, scan the accumulated output for the ` ```sophia-meta ` fence. Parse the JSON block. Extract `sections` and `claims`. Emit them via existing SSE events (`pass_structured`, `claims`).

Strip the `sophia-meta` block from the text before sending the final `pass_complete` event so the user never sees raw JSON.

#### D3. Remove `extractClaims()` and `refinePass()`

**Files to modify:** `src/lib/server/engine.ts` — remove all calls to `extractClaims()` and `refinePass()`.

**Files to delete:**
- `src/lib/server/passRefinement.ts`
- `src/lib/server/prompts/live-extraction.ts`

**Impact:** 6 fewer LLM calls per query. ~15-30s faster. No more `[EXTRACTION] primary structured parse failed` warnings in logs.

---

### Phase E: Firebase Auth (Mandatory)

#### E1. Firebase project setup

**Pulumi:** In `infra/index.ts`, enable:
- `firebase.googleapis.com`
- `identitytoolkit.googleapis.com`
- `firestore.googleapis.com`

Add Firebase Auth provider configuration for Google Sign-In.

#### E2. Server-side Firebase Admin SDK

**New file:** `src/lib/server/firebase-admin.ts`

```typescript
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// On Cloud Run, Application Default Credentials work automatically
if (!getApps().length) {
  initializeApp();
}

export const adminAuth = getAuth();
export const adminDb = getFirestore();
```

**Package:** Add `firebase-admin` to `package.json` dependencies.

#### E3. Auth middleware (mandatory)

**New file:** `src/hooks.server.ts`

```typescript
import { adminAuth } from '$lib/server/firebase-admin';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  // Public routes that don't require auth
  const publicPaths = ['/api/health', '/auth'];

  if (publicPaths.some(p => event.url.pathname.startsWith(p))) {
    return resolve(event);
  }

  const authHeader = event.request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    // For page requests, redirect to auth page
    if (event.request.headers.get('Accept')?.includes('text/html')) {
      return new Response(null, { status: 302, headers: { Location: '/auth' } });
    }
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const token = authHeader.slice(7);
    const decoded = await adminAuth.verifyIdToken(token);
    event.locals.user = {
      uid: decoded.uid,
      email: decoded.email ?? null,
      displayName: decoded.name ?? null,
      photoURL: decoded.picture ?? null
    };
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 });
  }

  return resolve(event);
};
```

**File:** `src/app.d.ts`
**Change:** Populate the `Locals` interface:
```typescript
interface Locals {
  user: {
    uid: string;
    email: string | null;
    displayName: string | null;
    photoURL: string | null;
  } | null;
}
```

#### E4. Client-side Firebase Auth

**New file:** `src/lib/firebase.ts`

```typescript
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export async function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export async function signOutUser() {
  return signOut(auth);
}

export function onAuthChange(callback: (user: any) => void) {
  return onAuthStateChanged(auth, callback);
}

export async function getIdToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken();
}
```

**Package:** Add `firebase` to `package.json` dependencies.

**Env vars:** Add `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID` to `.env` and Cloud Run config.

#### E5. Auth UI

**New file:** `src/routes/auth/+page.svelte`
**Purpose:** Full-page auth screen with Google Sign-In button. After successful auth, redirect to `/`.

**File:** `src/lib/components/shell/TopBar.svelte`
**Change:** Show user avatar + display name when signed in. "Sign out" dropdown menu.

**File:** `src/lib/stores/conversation.svelte.ts`
**Change:** Include `Authorization: Bearer ${idToken}` header in all `fetch('/api/analyse', ...)` calls.

#### E6. Protect admin route

**File:** `src/routes/admin/+page.server.ts`
**Change:** Check `event.locals.user` against an admin UID allowlist (stored in env var `ADMIN_UIDS`). Return 403 if not in the list.

---

### Phase F: Firestore for Persistent History

#### F1. Firestore schema

```
users/{uid}/queries/{queryId}
  ├─ query: string
  ├─ lens: string | null
  ├─ timestamp: Timestamp
  ├─ status: 'streaming' | 'complete' | 'error'
  ├─ passes:
  │   ├─ analysis: string
  │   ├─ critique: string
  │   └─ synthesis: string
  ├─ groundingSources: GroundingSource[]
  ├─ graphClaims: { id, text, claimType, confidence }[]
  ├─ metadata:
  │   ├─ totalInputTokens: number
  │   ├─ totalOutputTokens: number
  │   ├─ durationMs: number
  │   ├─ retrievalDegraded: boolean
  │   └─ retrievalDegradedReason: string | null
  └─ ttl: Timestamp (90 days from creation)

query_cache/{hash}
  ├─ queryHash: string
  ├─ queryText: string
  ├─ lens: string | null
  ├─ events: SSEEvent[]
  ├─ createdAt: Timestamp
  ├─ expiresAt: Timestamp
  └─ hitCount: number

grounding_discoveries/{hash}
  ├─ url: string
  ├─ title: string | null
  ├─ domain: string
  ├─ firstSeenAt: Timestamp
  ├─ lastSeenAt: Timestamp
  ├─ queryCount: number
  ├─ passes: PassType[]
  └─ relatedQueries: string[]

veracity_signals/{claimId}
  ├─ claimId: string
  ├─ claimText: string
  ├─ graphConfidence: number
  ├─ groundingAgreements: number
  ├─ groundingContradictions: number
  ├─ lastChecked: Timestamp
  └─ webSources: { url, agrees: boolean }[]
```

#### F2. Server-side history persistence

**File:** `src/routes/api/analyse/+server.ts`
**Change:** After a successful engine run, if `event.locals.user` is present, write the completed query result to Firestore `users/{uid}/queries/{queryId}`. Also capture grounding discoveries and veracity signals.

#### F3. Migrate query cache from SurrealDB to Firestore

**File:** `src/routes/api/analyse/+server.ts`
**Change:** Replace all `dbQuery('... FROM query_cache ...')` calls with Firestore reads/writes. The SurrealDB `query_cache` table is no longer used.

**Migration script:** `scripts/migrate-query-cache.ts` — reads existing cache entries from SurrealDB, writes to Firestore.

#### F4. Client-side history from Firestore

**File:** `src/lib/stores/history.svelte.ts`
**Change:** When authenticated, read from Firestore `users/{uid}/queries` (ordered by timestamp, limited to 50). Remove localStorage dependency for authenticated users. Keep localStorage as fallback for the auth page pre-login only.

---

### Phase G: UI Overhaul — Progressive Engagement

This is a complete redesign of the user experience. Users must never see a blank screen.

#### G1. State Machine

The UI follows a clear state machine:

```
[AUTH] → [IDLE] → [RETRIEVING] → [STREAMING] → [COMPLETE]
                                      │
                     ┌────────────────┤
                     ▼                ▼
              [ANALYSIS]    [ANALYSIS + CRITIQUE]
                                      │
                                      ▼
                               [SYNTHESIS]
```

Each state has a distinct visual presentation.

#### G2. Auth State (`/auth`)

Full-page centered auth screen:
- SOPHIA logo and tagline
- "Philosophical Reasoning Engine" subtitle
- "Sign in with Google" button (prominent, branded)
- Brief product description or rotating philosophical quote
- No access to any other route until authenticated

#### G3. Idle State (Post-Auth, Pre-Query)

**File:** `src/routes/+page.svelte`

- SOPHIA branding, centered
- Textarea input with placeholder
- 4 rotating example prompts (existing `getRandomExamples()`)
- **New:** Recent queries section (from Firestore history) showing last 3-5 queries with timestamps
- **New:** Knowledge graph stats ribbon: "12,847 claims · 4,200 relations · 29 sources" (fetched from SurrealDB via a lightweight endpoint)

#### G4. Retrieving State (First 2-5 Seconds)

**Triggered by:** User submits query
**Duration:** Until first `pass_start` event arrives

**Visual:**
- Query appears in a "Your question" card at the top
- **Animated retrieval visualisation:**
  - A timeline/stepper showing: "Searching knowledge graph → Found {n} relevant claims → Preparing analysis..."
  - As claims are retrieved, show them appearing as small cards with their claim type badges (thesis, premise, objection)
  - Show the graph relations between them with animated connecting lines
  - If retrieval is degraded, show a subtle notice: "Working from live sources (knowledge graph temporarily unavailable)"
- **Status ribbon** at the top of the main area showing technical progress

#### G5. Streaming State (The Bulk of the Wait)

**Layout:** Three-column or tabbed layout showing pass report cards.

**Per-pass report card structure:**
```
┌─────────────────────────────────────────────────┐
│  ◎ THE PROPONENT — Analysis         ▓▓▓▓▓▓░░ 73%  │
│                                                   │
│  ## Roadmap                                       │
│  This analysis examines three core positions...   │
│                                                   │
│  ## 1. The Question(s)                            │
│  ▌ (streaming cursor)                             │
│                                                   │
│  ── Sources discovered ──────────────────────────│
│  🔗 plato.stanford.edu — "Kant's Moral Philo..." │
│  🔗 iep.utm.edu — "Deontological Ethics"         │
│                                                   │
│  ── Progress ────────────────────────────────────│
│  847 / ~1800 words · 42s elapsed                  │
└─────────────────────────────────────────────────┘
```

**Key UI elements per report card:**
1. **Header:** Pass role name (The Proponent / The Adversary / The Synthesiser) + pass type + status indicator (spinning = streaming, check = complete)
2. **Progress bar:** Word count vs. target band (1500-2000), shown as a horizontal fill bar
3. **Rendered markdown body:** Streams in real-time with a blinking cursor at the insertion point. Use `renderMarkdown()` for live rendering of accumulated text.
4. **Grounding source chips:** Appear in real-time as they're discovered during the pass. Each chip shows favicon + domain + truncated title. Clickable to expand showing full URL and snippet. Grouped at the bottom of each card or in a floating sidebar.
5. **Elapsed timer:** Shows how long the current pass has been running

**Concurrent streaming (Analysis + Critique):**
- When both are active, show a split view or two adjacent tabs both with active streaming indicators
- A subtle animation connecting them: "The Adversary is examining the Proponent's arguments..."
- Default view: the most recently started pass

**Between passes (brief gaps):**
- When Analysis completes and Synthesis hasn't started yet:
  - Show a transition card: "The Proponent and Adversary have presented their cases. The Synthesiser will now integrate both perspectives..."
  - Display a summary of what each pass found: key claims count, sources cited, word count

#### G6. Complete State

**After all 3 passes finish:**
1. Each report card snaps into its final rendered form with a "Complete" badge
2. **Source verification summary:** A new card appears below the three passes:
   ```
   ┌─── Source Verification Summary ───────────────┐
   │                                                 │
   │  15 sources cited across 3 passes               │
   │  8 from Google Search · 12 claims from          │
   │  knowledge graph                                │
   │                                                 │
   │  Graph claims verified by web: 9/12             │
   │  Novel web sources discovered: 6                │
   │                                                 │
   │  📊 View full source analysis                   │
   └─────────────────────────────────────────────────┘
   ```
3. **Action buttons:** "Ask a follow-up" (pre-fills context), "Save to history" (auto-saved for auth users), "Share" (generates a shareable link)

#### G7. Side Panel Redesign

The existing side panel (References / History / Settings) is redesigned:

**Tab: Sources** (replaces References)
- All grounding sources grouped by pass
- Each source is a card with: favicon, title, URL, which pass cited it, snippet
- Knowledge graph claims that were verified by grounding sources are highlighted
- Claims that were contradicted by grounding sources are flagged

**Tab: Knowledge Graph**
- Claims retrieved from SurrealDB for this query
- Shown with their typed relations (supports/contradicts/depends-on)
- Confidence scores
- Whether they were verified by grounding sources

**Tab: History**
- Firestore-backed query history (cross-device for authenticated users)
- Each entry shows: query text, timestamp, pass count, source count
- Click to re-view the full result

**Tab: Settings**
- User profile (from Firebase Auth)
- Sign out
- Optional lens selection (existing feature)

#### G8. Loading Skeletons & Empty States

Every component has a loading skeleton and empty state:
- **Report cards** before streaming: Pulse-animated skeleton with faux section headers
- **Sources panel** before grounding sources arrive: "Sources will appear as the analysis progresses..."
- **Knowledge graph panel** during retrieval: Animated nodes appearing
- **History** when empty: "Your analysis history will appear here after your first query"

#### G9. Responsive Design

- **Desktop (>1024px):** Main content area (report cards) + collapsible side panel
- **Tablet (768-1024px):** Full-width report cards, side panel as overlay
- **Mobile (<768px):** Single-column, tabs for passes, bottom sheet for sources

---

### Phase H: Admin Dashboard Expansion

#### H1. Unified admin view

**File:** `src/routes/admin/+page.svelte` and `+page.server.ts`
**Change:** The admin dashboard shows data from both SurrealDB and Firestore:

**SurrealDB section:**
- Knowledge graph stats: total claims, relations, arguments, sources
- Claim distribution by domain and type
- Source ingestion status

**Firestore section:**
- Total registered users
- Query volume (last 24h, 7d, 30d)
- Cache hit rate
- Grounding discovery count
- Veracity signal summary (how many graph claims confirmed/contradicted by web)
- Top queries

**Auth:** Gated by admin UID allowlist (e.g., `ADMIN_UIDS=uid1,uid2`).

---

### Phase I: Training Data Pipeline (Flywheel)

#### I1. Auto-capture grounding discoveries

**File:** `src/routes/api/analyse/+server.ts`
**Change:** After each query completes, write each unique grounding source URL to `grounding_discoveries/{urlHash}` in Firestore. Track which queries triggered each discovery, how many times it was cited, which passes used it.

#### I2. Veracity signal collection

**File:** `src/lib/server/engine.ts` or a new `src/lib/server/veracity.ts`
**Change:** After synthesis completes, compare the knowledge graph claims injected into the context block against the grounding sources. If a grounding source directly references the same topic as a graph claim, record whether it agrees or contradicts. Write to `veracity_signals/{claimId}`.

This is heuristic — not a formal contradiction detector. Start simple: if a grounding source's title/snippet contains keywords from a graph claim's text, record it as a "related source" and let the model's synthesis assessment (which already evaluates tensions) inform the agreement/contradiction flag.

#### I3. Fine-tuning dataset export

**New file:** `scripts/export-training-data.ts`
**Purpose:** Reads from:
- SurrealDB: ~6,500 claims + typed relations → extraction training examples
- Firestore: (query, three-pass output) pairs → reasoning training examples

Outputs Vertex AI supervised tuning JSONL format.

**Target model:** Gemini 1.5 Flash (fine-tuning available). The fine-tuned model can replace the `sophia-meta` inline extraction or improve future claim extraction during ingestion.

**Trigger:** Manually, after accumulating 100+ clean query-output pairs.

#### I4. Vertex AI Search Corpus (Future Stretch)

**Status:** Deferred. Not required for MVP.
**Purpose:** Upload philosophical texts to a Vertex AI Search Unstructured datastore. Use Discovery Engine API to query. This would provide managed semantic search as a faster, more reliable alternative to SurrealDB vector search over VPC.
**When to reconsider:** If VPC connector → SurrealDB latency or reliability becomes a persistent production issue despite Phase 1 hardening.

---

### Phase J: Dependency Cleanup

#### J1. Remove Voyage AI

- Delete `voyageai` from `package.json`
- Remove `VOYAGE_API_KEY` from Cloud Run env vars and Pulumi config
- Delete the Voyage-specific code in `src/lib/server/embeddings.ts` (replace with Vertex AI embeddings)
- Remove `voyage-api-key` from Secret Manager (after confirming nothing else uses it)

#### J2. Remove Anthropic legacy

- Delete `@anthropic-ai/sdk` from `package.json`
- Delete `src/lib/server/claude.ts`
- Delete `src/lib/server/anthropic.ts`
- Delete `src/routes/api/+server.ts` (the legacy Claude endpoint)
- Remove `ANTHROPIC_API_KEY` from Cloud Run env vars (keep in scripts if needed for ingestion until Phase 2 migrates those)

#### J3. Remove dead code

- Delete `src/lib/server/db-pool.ts` (WebSocket pool, unused by app)
- Delete `src/lib/server/passRefinement.ts` (replaced by inline sophia-meta)
- Delete `src/lib/server/prompts/live-extraction.ts` (replaced by inline sophia-meta)
- Clean up `src/lib/server/vertex.ts` — remove `buildGroundingTool()` (replaced by SDK tool)

#### J4. SurrealDB stays but scope narrows

SurrealDB remains as:
- Knowledge graph store (claims, relations, arguments, sources)
- Queried via `src/lib/server/db.ts` (HTTP SQL, Phase 1 hardened)
- Accessed for retrieval in the live query path
- Accessed for admin dashboard stats
- Accessed by ingestion scripts

SurrealDB loses:
- `query_cache` table (migrated to Firestore in Phase F)

---

## Dependency Summary

### Added
| Package | Purpose |
|---------|---------|
| `firebase` | Client-side Firebase Auth |
| `firebase-admin` | Server-side auth verification + Firestore |

### Removed
| Package | Reason |
|---------|--------|
| `voyageai` | Replaced by Vertex AI `text-embedding-005` |
| `@anthropic-ai/sdk` | Legacy Claude client, no longer used |

### Kept
| Package | Reason |
|---------|--------|
| `surrealdb` | Knowledge graph access (app + scripts) |
| `@ai-sdk/google-vertex` | Gemini 2.5 Pro/Flash via Vercel AI SDK |
| `ai` | Vercel AI SDK core (`streamText`, `generateObject`) |
| `@google-cloud/logging` | Cloud Logging for ingestion |
| `@google/generative-ai` | Direct Gemini API (validation in ingestion) |

---

## Env Var Changes

### Added
| Var | Scope | Purpose |
|-----|-------|---------|
| `VITE_FIREBASE_API_KEY` | Client | Firebase client config |
| `VITE_FIREBASE_AUTH_DOMAIN` | Client | Firebase client config |
| `VITE_FIREBASE_PROJECT_ID` | Client | Firebase client config |
| `ADMIN_UIDS` | Server | Comma-separated admin Firebase UIDs |

### Removed
| Var | Reason |
|-----|--------|
| `VOYAGE_API_KEY` | Voyage AI eliminated |
| `ANTHROPIC_API_KEY` | Anthropic legacy eliminated (from app; keep for ingestion scripts until migrated) |

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Vertex AI embedding quality differs from Voyage | Retrieval relevance may change | Backup + rollback script (Phase B4). Compare retrieval results before/after. |
| Google Search grounding returns low-quality sources for niche philosophy | Sources panel shows generic results | Context block from knowledge graph guides the model toward philosophical topics. Accept degraded grounding for very niche queries. |
| VPC connector → SurrealDB remains flaky | Retrieval degrades occasionally | Phase 1 hardening (retry, timeout, typed errors). Grounding provides independent source of truth. Track Vertex AI Search as managed alternative. |
| Firebase Auth adds latency to every request | Increased time-to-first-byte | ID token verification is fast (~50ms). Cache verified tokens in-memory for the request lifecycle. |
| Inline `sophia-meta` block parsing fails | No structured claims from a pass | Fallback: if no `sophia-meta` block found, skip structured data for that pass. Log warning. Do not block the response. |
| Hybrid parallelism: Critique with partial Analysis produces weaker critique | Lower quality critique pass | The partial text threshold (2000 chars) ensures significant Analysis content is available. Synthesis pass has both full outputs. Monitor quality. |

---

## Future Considerations (Not in This Phase)

| Item | Description | Trigger |
|------|-------------|---------|
| Vertex AI Search corpus | Managed semantic search to replace SurrealDB vector search | VPC reliability remains problematic |
| Cloud SQL for knowledge graph | If SurrealDB becomes a bottleneck | Scale beyond single GCE VM |
| Multi-domain expansion | Remove `MVP_DOMAIN_FILTER = 'ethics'` | After cross-domain ingestion waves |
| Fine-tuned reasoning model | RLHF on (query, user-preference) pairs | 500+ queries with engagement signals |
| Collaborative features | Shared queries, team workspaces | User growth justifies |
| Offline/PWA support | Service worker, cached query results | Mobile usage pattern emerges |
| WebSocket SSE replacement | Bidirectional streaming | Follow-up question support during streaming |

---

## Implementation Order

```
Phase A (Grounding)      ████████░░  — Week 1-2
Phase B (Embeddings)     ████████░░  — Week 1-2 (parallel with A)
Phase C (Hybrid Engine)  ░░████████  — Week 2-3
Phase D (Inline Extract) ░░████████  — Week 2-3 (parallel with C)
Phase E (Firebase Auth)  ░░░░████░░  — Week 3
Phase F (Firestore)      ░░░░░░████  — Week 3-4
Phase G (UI Overhaul)    ░░████████  — Week 2-4 (continuous)
Phase H (Admin)          ░░░░░░░░██  — Week 4
Phase I (Flywheel)       ░░░░░░░░██  — Week 4
Phase J (Cleanup)        ░░░░░░░░██  — Week 4
```

**Critical path:** A → C → G (grounding must work before engine restructure, both must work before UI overhaul can be fully realised).

**Parallel tracks:**
- B (embedding migration) can run alongside A
- D (inline extraction) can run alongside C
- E + F (auth + Firestore) can run alongside everything after A is validated
- G spans the entire period — each phase unlocks new UI capabilities
