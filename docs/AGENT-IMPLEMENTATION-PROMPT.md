# SOPHIA — Agent Implementation Prompt

**Purpose:** This document, together with `docs/MVP-PIVOT-PLAN.md`, provides everything an AI coding agent needs to implement the SOPHIA MVP Pivot. The plan describes *what* to build. This document describes *how* to build it, with the codebase context an agent needs to navigate the project.

**Target agents:** Cursor, Claude Code, GitHub Copilot, Devin, Roo Code, or any AI coding agent with file read/write and terminal access.

---

## How to Use This Document

1. Read this document fully before starting any work.
2. Read `docs/MVP-PIVOT-PLAN.md` fully to understand the plan.
3. Work through the phases in the order specified in the plan's Implementation Order section.
4. After completing each phase, run the verification steps listed under that phase.
5. Commit after each phase passes verification. Do not batch phases into a single commit.

---

## Project Overview

SOPHIA is a philosophical reasoning engine. A user submits a question. The backend retrieves relevant claims from a philosophical knowledge graph (SurrealDB), then runs three sequential passes through Gemini 2.5 Pro (Analysis, Critique, Synthesis), streaming the output to the browser via Server-Sent Events. Each pass plays a different dialectical role. The frontend displays the streaming text in tabbed pass panels, with a side panel for references and history.

The app is deployed on Google Cloud Run (europe-west2), with a SurrealDB instance on a GCE VM (europe-west2-b, internal IP 10.154.0.2) accessed via a VPC connector. Infrastructure is managed by Pulumi (see `infra/index.ts`).

---

## Tech Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| SvelteKit | 2 | App framework |
| Svelte | 5 (runes: `$state`, `$derived`, `$effect`) | UI reactivity |
| Tailwind CSS | 4 | Styling |
| TypeScript | strict | All source files |
| Vercel AI SDK (`ai`) | 6.x | `streamText`, `generateObject`, `generateText` |
| `@ai-sdk/google-vertex` | 4.x | Gemini model access via Vertex AI |
| SurrealDB | 2 | Knowledge graph (HTTP SQL mode) |
| Pulumi | — | Infrastructure as code (`infra/`) |
| pnpm | 9 | Package manager |
| Node.js | 20 | Runtime |
| Docker | — | Container builds for Cloud Run |

---

## Key Files and Their Roles

### Server-Side (Backend)

| File | Purpose | Notes |
|------|---------|-------|
| `src/lib/server/engine.ts` | Three-pass dialectical engine | Entry point: `runDialecticalEngine()`. Callbacks emit SSE events. |
| `src/lib/server/vertex.ts` | Vertex AI client setup | `getReasoningModel()` → Gemini 2.5 Pro. `getExtractionModel()` → Gemini 2.5 Flash. `buildGroundingTool()` exists but is **UNUSED** — to be replaced by SDK tool. |
| `src/lib/server/retrieval.ts` | Knowledge graph retrieval pipeline | `retrieveContext()` → embed → vector search → graph traversal → `RetrievalResult`. `buildContextBlock()` formats result for prompt injection. |
| `src/lib/server/embeddings.ts` | Embedding provider | Currently Voyage AI. **To be replaced with Vertex AI text-embedding-005.** |
| `src/lib/server/db.ts` | SurrealDB HTTP SQL client | `query()` function. Phase 1 hardened: retries, timeouts, typed `DatabaseError`. |
| `src/lib/server/db-pool.ts` | WebSocket connection pool | **UNUSED by app runtime. Delete in Phase J.** |
| `src/lib/server/passRefinement.ts` | Post-pass section structuring via separate LLM call | **Delete in Phase D.** Replace with inline `sophia-meta` parsing. |
| `src/lib/server/graphProjection.ts` | Converts `RetrievalResult` to graph nodes/edges | Emitted as `graph_snapshot` SSE event. |
| `src/lib/server/claude.ts` | Legacy Anthropic Claude client | **UNUSED. Delete in Phase J.** |
| `src/lib/server/anthropic.ts` | Legacy Anthropic utils | **UNUSED. Delete in Phase J.** |
| `src/lib/server/gemini.ts` | Direct Gemini API client | Used only in ingestion scripts for validation. Not in app runtime. |
| `src/lib/server/prompts/analysis.ts` | Pass 1 system prompt (The Proponent) | Exports `getAnalysisSystemPrompt(contextBlock)` and `buildAnalysisUserPrompt(query, lens)`. |
| `src/lib/server/prompts/critique.ts` | Pass 2 system prompt (The Adversary) | Exports `getCritiqueSystemPrompt(contextBlock)` and `buildCritiqueUserPrompt(query, analysisOutput)`. |
| `src/lib/server/prompts/synthesis.ts` | Pass 3 system prompt (The Synthesiser) | Exports `getSynthesisSystemPrompt(contextBlock)` and `buildSynthesisUserPrompt(query, analysisOutput, critiqueOutput)`. |
| `src/lib/server/prompts/live-extraction.ts` | Claim extraction prompt | **Delete in Phase D.** |
| `src/lib/server/prompts/verification.ts` | Pass 4 (web verification) prompt | Keep for now. |
| `src/routes/api/analyse/+server.ts` | SSE streaming endpoint | `POST /api/analyse`. Cache check (SurrealDB `query_cache`), engine callbacks → SSE events, cache write on success. |
| `src/routes/api/verify/+server.ts` | Pass 4 SSE endpoint | `POST /api/verify`. Separate from main engine. |
| `src/routes/api/health/+server.ts` | Health check | Returns DB status, latency, runtime config, readiness. |
| `src/routes/api/+server.ts` | Legacy Claude endpoint | **UNUSED. Delete in Phase J.** |
| `src/routes/admin/+page.server.ts` | Admin data loader | Queries SurrealDB for corpus stats. **Currently unprotected.** |

### Client-Side (Frontend)

| File | Purpose | Notes |
|------|---------|-------|
| `src/routes/+page.svelte` | Main page (935 lines) | Single-page app. Empty state + conversation view. **Major rewrite in Phase G.** |
| `src/routes/+layout.svelte` | Layout shell | Renders `TopBar` + slot. No auth checks. |
| `src/routes/admin/+page.svelte` | Admin dashboard UI | Displays SurrealDB stats. |
| `src/lib/stores/conversation.svelte.ts` | Conversation state | Messages, streaming, SSE consumption. `submitQuery()` does the fetch + SSE parsing. |
| `src/lib/stores/references.svelte.ts` | References panel state | Claims, relations, sources, grounding status. |
| `src/lib/stores/history.svelte.ts` | History state | **localStorage only.** `sophia-history` and `sophia-query-cache` keys. |
| `src/lib/stores/graph.svelte.ts` | Graph visualization state | Nodes, edges, selection. |
| `src/lib/stores/panel.svelte.ts` | Side panel toggle | Open/close state. |
| `src/lib/utils/sseHandler.ts` | SSE event router | `handleSSEEvent()` routes events to appropriate stores. |
| `src/lib/utils/markdown.ts` | Markdown rendering | `renderMarkdown()` using `marked`. |
| `src/lib/components/panel/` | Side panel components | `SidePanel`, `TabStrip`, `HistoryTab`, `SettingsTab` |
| `src/lib/components/references/` | References components | `ReferencesTab`, `ClaimsView`, `SourcesView`, `ClaimCard`, etc. |
| `src/lib/components/visualization/` | Graph components | `GraphCanvas`, `NodeDetail` |
| `src/lib/components/shell/` | Shell components | `TopBar` |

### Types

| File | Purpose |
|------|---------|
| `src/lib/types/api.ts` | SSE event types. `SSEEvent` discriminated union. `PassSection`, `GraphNode`, `GraphEdge`, `MetadataEvent`. |
| `src/lib/types/references.ts` | `Claim`, `RelationBundle`, `SourceReference`, `AnalysisPhase`, `BadgeVariant`, `RelationType`. |
| `src/lib/types/passes.ts` | `PassType`, `AnalysisPass`, `CritiquePass`, `SynthesisPass`, `VerificationPass`, `VerificationClaim`. |
| `src/app.d.ts` | SvelteKit app types. `Locals` interface is currently **empty**. Must be populated with `user` for auth. |

### Infrastructure

| File | Purpose |
|------|---------|
| `infra/index.ts` | Pulumi infrastructure. Service accounts, VPC connector, Cloud Run (app + ingest job), load balancer, SSL, domain mapping. |
| `infra/Pulumi.production.yaml` | Production stack config. Region, DB IP, instance sizing. |
| `Dockerfile` | App container build. |
| `Dockerfile.ingest` | Ingestion job container build. |

### Scripts (Not Modified Unless Specified)

| File | Purpose |
|------|---------|
| `scripts/setup-schema.ts` | SurrealDB schema setup |
| `scripts/ingest.ts` | Single-source ingestion |
| `scripts/ingest-batch.ts` | Wave-based batch ingestion |
| `scripts/test-retrieval.ts` | Retrieval quality testing |
| `scripts/db-backup.ts` | Database backup |
| `scripts/db-restore.ts` | Database restore |

---

## SSE Event Protocol

The `/api/analyse` endpoint streams Server-Sent Events. Each event is a JSON object on a `data:` line, followed by `\n\n`.

### Current Events

```typescript
type SSEEvent =
  | { type: 'pass_start'; pass: PassType }
  | { type: 'pass_chunk'; pass: PassType; content: string }
  | { type: 'pass_complete'; pass: PassType }
  | { type: 'pass_structured'; pass: PassType; sections: PassSection[]; wordCount: number }
  | { type: 'claims'; pass: AnalysisPhase; claims: Claim[] }
  | { type: 'relations'; pass: AnalysisPhase; relations: RelationBundle[] }
  | { type: 'sources'; sources: SourceReference[] }
  | { type: 'graph_snapshot'; nodes: GraphNode[]; edges: GraphEdge[] }
  | { type: 'confidence_summary'; avgConfidence: number; lowConfidenceCount: number; totalClaims: number }
  | { type: 'metadata'; total_input_tokens: number; total_output_tokens: number; duration_ms: number; ... }
  | { type: 'error'; message: string };
```

### New Events (Add in This Pivot)

```typescript
  | { type: 'grounding_sources'; pass: PassType; sources: GroundingSource[] }
  | { type: 'retrieval_status'; phase: 'started' | 'claims_found' | 'complete' | 'degraded'; claimCount?: number; message?: string }
```

---

## SurrealDB Schema

The knowledge graph uses these tables. **Do not modify the schema** except for the embedding index dimension change in Phase B.

```sql
-- Tables: source, claim, argument, relation, query_cache, ingestion_log

-- Key: claim table has embedding field (currently 1024-dim Voyage vectors)
DEFINE INDEX claim_embedding ON claim FIELDS embedding MTREE DIMENSION 1024;
-- ^ This changes to DIMENSION 768 in Phase B after re-embedding

-- Key: query_cache table (migrates to Firestore in Phase F)
-- Table: query_cache { query_hash, query_text, lens, events, created_at, expires_at, hit_count }
```

---

## Google Search Grounding — How It Works

The `@ai-sdk/google-vertex` package (already installed) exports `googleVertexTools`:

```typescript
import { googleVertexTools } from '@ai-sdk/google-vertex';
// Available tools: googleSearch, enterpriseWebSearch, googleMaps, urlContext, fileSearch, vertexRagStore
```

When passed to `streamText()`:
```typescript
const stream = streamText({
  model: getReasoningModel(),
  system: systemPrompt,
  messages,
  tools: { googleSearch: googleVertexTools.googleSearch() }
});
```

After the stream completes, `await stream.sources` returns:
```typescript
Array<{
  type: 'source';
  sourceType: 'url';
  id: string;
  url: string;
  title?: string;
}>
```

These are extracted from `groundingMetadata.groundingChunks` in the Gemini API response. The Vercel AI SDK handles this automatically — no manual parsing needed.

---

## Vertex AI Embeddings — How to Replace Voyage

The current embedding client (`src/lib/server/embeddings.ts`) calls Voyage AI:
```typescript
import { VoyageAIClient } from 'voyageai';
const client = new VoyageAIClient({ apiKey: env.VOYAGE_API_KEY });
// → 1024-dim vectors
```

Replace with Vertex AI `text-embedding-005`:
```typescript
// Direct REST call to Vertex AI
const response = await fetch(
  `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/text-embedding-005:predict`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${await getAccessToken()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      instances: [{ content: text, task_type: taskType }]  // task_type: 'RETRIEVAL_QUERY' or 'RETRIEVAL_DOCUMENT'
    })
  }
);
// → 768-dim vectors
```

On Cloud Run with the correct service account (`sophia-app`, which has `roles/aiplatform.user`), Application Default Credentials work automatically. Use `google-auth-library` to get an access token:
```typescript
import { GoogleAuth } from 'google-auth-library';
const auth = new GoogleAuth();
const client = await auth.getClient();
const { token } = await client.getAccessToken();
```

**Package to add:** `google-auth-library` (if not already transitive).

---

## Firebase Auth — Integration Pattern

### Server-side (Cloud Run)

On Cloud Run, `firebase-admin` uses Application Default Credentials:
```typescript
import { initializeApp, getApps } from 'firebase-admin/app';
if (!getApps().length) initializeApp();  // No credentials needed on Cloud Run
```

The service account needs `roles/firebase.sdkAdminServiceAgent` or the specific Firebase Auth role. Add this to the `app-sa` IAM bindings in `infra/index.ts`.

### Client-side

Firebase client SDK uses public config (safe to expose in client code):
```typescript
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
};
```

These `VITE_` prefixed vars are exposed to the client by SvelteKit.

### Auth flow
1. User clicks "Sign in with Google" on `/auth` page
2. `signInWithPopup(auth, googleProvider)` opens Google consent
3. On success, Firebase client has a user object with `getIdToken()`
4. All subsequent API calls include `Authorization: Bearer ${idToken}` header
5. Server `hooks.server.ts` verifies token via `adminAuth.verifyIdToken(token)`
6. `event.locals.user` is populated for the request lifecycle

---

## Task Sequence

Work through these tasks in order. Each task is atomic — verify before moving to the next.

### Task 1: Enable Google Search Grounding (Phase A1-A2)

**Files to modify:** `src/lib/server/engine.ts`, `src/lib/server/vertex.ts`

1. In `engine.ts`, add `import { googleVertexTools } from '@ai-sdk/google-vertex';`
2. In `streamPassWithContinuation()`, add `tools: { googleSearch: googleVertexTools.googleSearch() }` to the `streamText()` call
3. After the stream completes (after `await stream.totalUsage`), access `const sources = await stream.sources;` and return them alongside the text output
4. In `vertex.ts`, delete the `buildGroundingTool()` function and its export
5. Update the return type of `streamPassWithContinuation()` to include `sources`

**Verify:** Build succeeds (`pnpm build`). Deploy and submit a test query — check Cloud Logging for source objects in the engine output.

### Task 2: Wire Grounding Sources Through SSE (Phase A3-A4)

**Files to modify:** `src/lib/types/api.ts`, `src/lib/server/engine.ts`, `src/routes/api/analyse/+server.ts`, `src/lib/stores/references.svelte.ts`, `src/lib/utils/sseHandler.ts`

1. Add `GroundingSource` interface and `grounding_sources` to `SSEEvent` union in `api.ts`
2. Add `onGroundingSources` to `EngineCallbacks` in `engine.ts`
3. Call `callbacks.onGroundingSources(pass, sources)` after each pass in the engine
4. Wire the callback in `analyse/+server.ts` to emit the SSE event
5. Add `groundingSources` state + `addGroundingSources()` method to `references.svelte.ts`
6. Route the event in `sseHandler.ts`

**Verify:** Submit a query. Inspect browser DevTools Network tab — `grounding_sources` events appear in the SSE stream with URL data.

### Task 3: Restructure Context Block (Phase A5-A6)

**Files to modify:** `src/lib/server/retrieval.ts` (specifically `buildContextBlock()`), `src/lib/server/prompts/analysis.ts`, `critique.ts`, `synthesis.ts`

1. Update `buildContextBlock()` to format claims with their typed relations (supports/contradicts/depends-on) and source metadata
2. Add the graph + grounding instruction to all three system prompts

**Verify:** Check Cloud Logging — the context block should show structured claim format with relation types.

### Task 4: Replace Voyage with Vertex AI Embeddings (Phase B1-B4)

**Files to modify:** `src/lib/server/embeddings.ts`
**Files to create:** `scripts/backup-vectors.ts`, `scripts/reembed-corpus.ts`, `scripts/restore-vectors.ts`

1. Create and run the backup script first. Verify backup file exists with ~6,500 entries.
2. Rewrite `embeddings.ts` to use Vertex AI `text-embedding-005`
3. Create the re-embedding script. Run it. Verify with `scripts/test-retrieval.ts`.
4. Create the restore script (do not run — it's the rollback path).
5. Update SurrealDB index: `REMOVE INDEX claim_embedding ON claim; DEFINE INDEX claim_embedding ON claim FIELDS embedding MTREE DIMENSION 768;`

**Verify:** Run `scripts/test-retrieval.ts` with 5 known queries. Compare results to pre-migration quality.

### Task 5: Hybrid Parallel Engine (Phase C1-C3)

**Files to modify:** `src/lib/server/engine.ts`, `src/lib/server/prompts/critique.ts`, `src/lib/stores/conversation.svelte.ts`, `src/routes/+page.svelte`

1. Restructure `runDialecticalEngine()` to start Critique after ~2000 chars of Analysis
2. Update Critique system prompt for partial input
3. Ensure client handles interleaved `pass_start`/`pass_chunk` events for concurrent passes
4. Update UI to show both tabs as active during concurrent streaming

**Verify:** Submit a query. Both Analysis and Critique tabs show streaming indicators simultaneously. Total time < 2m30s (measured from SSE metadata event).

### Task 6: Inline Structured Output (Phase D1-D3)

**Files to modify:** `src/lib/server/prompts/analysis.ts`, `critique.ts`, `synthesis.ts`, `src/lib/server/engine.ts`
**Files to delete:** `src/lib/server/passRefinement.ts`, `src/lib/server/prompts/live-extraction.ts`

1. Add `sophia-meta` block instruction to all three system prompts
2. Add parsing logic in engine.ts — after each pass completes, extract JSON from the ` ```sophia-meta ` fence
3. Emit `pass_structured` and `claims` events from parsed data (existing event types, no change needed)
4. Strip the `sophia-meta` block from the final text before `pass_complete`
5. Remove all calls to `extractClaims()` and `refinePass()` from the engine
6. Delete `passRefinement.ts` and `live-extraction.ts`

**Verify:** Build succeeds. Submit a query — `pass_structured` events still arrive. Cloud Logging shows NO `[EXTRACTION]` log lines. Total query time is 15-30s faster.

### Task 7: Firebase Auth (Phase E1-E6)

**Files to create:** `src/lib/server/firebase-admin.ts`, `src/lib/firebase.ts`, `src/hooks.server.ts`, `src/routes/auth/+page.svelte`
**Files to modify:** `src/app.d.ts`, `src/lib/components/shell/TopBar.svelte`, `src/lib/stores/conversation.svelte.ts`, `src/routes/admin/+page.server.ts`, `infra/index.ts`, `package.json`

1. `pnpm add firebase firebase-admin`
2. Create server-side admin SDK init (`firebase-admin.ts`)
3. Create client-side Firebase init (`firebase.ts`)
4. Create auth middleware (`hooks.server.ts`) — redirects unauthenticated page requests to `/auth`, returns 401 for API calls
5. Create auth page (`/auth`)
6. Update `app.d.ts` with `Locals.user` type
7. Update `TopBar` with user avatar and sign-out
8. Update `conversation.svelte.ts` to include auth header in fetch calls
9. Update admin route to check admin UID allowlist
10. Add Firebase/IAM resources to Pulumi config
11. Add `VITE_FIREBASE_*` env vars to `.env` and Pulumi Cloud Run config

**Verify:** App redirects to `/auth` when not signed in. After Google sign-in, main page loads. API calls include auth header. `/admin` returns 403 for non-admin users.

### Task 8: Firestore History (Phase F1-F4)

**Files to modify:** `src/routes/api/analyse/+server.ts`, `src/lib/stores/history.svelte.ts`
**Files to create:** `scripts/migrate-query-cache.ts`

1. After successful engine run, write query result to `users/{uid}/queries/{queryId}` in Firestore
2. Replace SurrealDB `query_cache` reads/writes with Firestore `query_cache/{hash}`
3. Update client-side history store to read from Firestore when authenticated
4. Create and run the query cache migration script

**Verify:** Submit a query while signed in. Check Firestore console — document appears under the user's collection. Sign in on another device/browser — same query appears in history.

### Task 9: UI Overhaul (Phase G)

**This is the largest task.** Break it into sub-tasks:

**9a. Auth page** (`src/routes/auth/+page.svelte`)
- Centered SOPHIA branding
- Google Sign-In button
- Philosophical quote or product description

**9b. Idle state redesign** (`src/routes/+page.svelte`)
- Recent queries from Firestore history
- Knowledge graph stats ribbon
- Improved example prompts layout

**9c. Retrieval state** (new components)
- Create `src/lib/components/retrieval/RetrievalProgress.svelte`
- Animated timeline: "Searching knowledge graph → Found N claims → Preparing analysis..."
- Add `retrieval_status` SSE event handling

**9d. Pass report cards**
- Create `src/lib/components/passes/PassReportCard.svelte`
- Header with role name + status
- Progress bar (word count vs. target)
- Rendered markdown body with streaming cursor
- Grounding source chips (real-time)
- Elapsed timer

**9e. Concurrent streaming UI**
- Split view or adjacent tabs for Analysis + Critique when both active
- Transition card between phases

**9f. Complete state**
- Source verification summary card
- Action buttons (follow-up, share)

**9g. Side panel redesign**
- Tab: Sources (grounding sources grouped by pass)
- Tab: Knowledge Graph (retrieved claims with relations)
- Tab: History (Firestore-backed)
- Tab: Settings (user profile, sign out)

**9h. Loading skeletons and empty states**
- Skeleton components for each loading state
- Empty state messages for each panel

**9i. Responsive design**
- Desktop: main + side panel
- Tablet: full-width + overlay panel
- Mobile: single-column + bottom sheet

**Verify:** Walk through the full user journey: Auth → Idle → Submit query → Retrieval animation → Streaming passes → Complete. All states have visual content. No blank screens.

### Task 10: Admin Dashboard (Phase H)

**Files to modify:** `src/routes/admin/+page.server.ts`, `src/routes/admin/+page.svelte`

1. Add Firestore reads alongside existing SurrealDB reads
2. Display: user count, query volume, cache hit rate, grounding discoveries, veracity signals, top queries
3. Auth gated by admin UID allowlist

**Verify:** Admin page shows data from both SurrealDB and Firestore. Non-admin users get 403.

### Task 11: Training Data Pipeline (Phase I)

**Files to create:** `src/lib/server/veracity.ts`, `scripts/export-training-data.ts`
**Files to modify:** `src/routes/api/analyse/+server.ts`

1. Auto-capture grounding discoveries to Firestore after each query
2. Implement heuristic veracity signal collection
3. Build JSONL export script for Vertex AI supervised tuning

**Verify:** After several queries, Firestore `grounding_discoveries` and `veracity_signals` collections contain entries. Export script produces valid JSONL.

### Task 12: Dependency Cleanup (Phase J)

**Files to delete:** `src/lib/server/db-pool.ts`, `src/lib/server/claude.ts`, `src/lib/server/anthropic.ts`, `src/routes/api/+server.ts`
**Files to modify:** `package.json`

1. `pnpm remove voyageai @anthropic-ai/sdk`
2. Delete dead code files
3. Remove unused env vars from Pulumi config and Secret Manager
4. Remove `buildGroundingTool()` from `vertex.ts` (if not already done in Task 1)

**Verify:** `pnpm build` succeeds. `pnpm check` passes. No import errors. Cloud Run deployment works.

---

## Build and Deploy

### Local development
```bash
pnpm install
pnpm dev          # starts dev server at http://localhost:5173
pnpm build        # production build
pnpm check        # TypeScript type checking
```

### Docker build (Cloud Run)
```bash
docker build --platform linux/amd64 -t europe-west2-docker.pkg.dev/sophia-488807/sophia/app:TAG .
docker push europe-west2-docker.pkg.dev/sophia-488807/sophia/app:TAG
```

### Deploy via Pulumi
```bash
cd infra
pulumi config set sophia:appImageTag TAG
pulumi up
```

### Direct Cloud Run deploy (bypass Pulumi)
```bash
gcloud run deploy sophia \
  --image=europe-west2-docker.pkg.dev/sophia-488807/sophia/app:TAG \
  --region=europe-west2 \
  --project=sophia-488807
```

### Verify deployment
```bash
curl -s https://usesophia.app/api/health | jq .
```

---

## Environment Variables

### Server-side (Cloud Run env vars / secrets)
```
SURREAL_URL=http://10.154.0.2:8000/rpc
SURREAL_USER=root
SURREAL_PASS=<secret>
SURREAL_NAMESPACE=sophia
SURREAL_DATABASE=sophia
GCP_PROJECT_ID=sophia-488807
GOOGLE_VERTEX_PROJECT=sophia-488807
GOOGLE_VERTEX_LOCATION=us-central1
GCP_LOCATION=europe-west2
GEMINI_REASONING_MODEL=gemini-2.5-pro        # optional, this is the default
GEMINI_EXTRACTION_MODEL=gemini-2.5-flash      # optional, this is the default
DB_REQUEST_TIMEOUT_MS=10000                   # optional, Phase 1 addition
DB_MAX_RETRIES=2                              # optional, Phase 1 addition
DB_RETRY_BASE_MS=300                          # optional, Phase 1 addition
ADMIN_UIDS=<comma-separated Firebase UIDs>    # NEW in this pivot
```

### Client-side (VITE_ prefix, exposed to browser)
```
VITE_FIREBASE_API_KEY=<firebase api key>
VITE_FIREBASE_AUTH_DOMAIN=sophia-488807.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=sophia-488807
```

### Removed in this pivot
```
VOYAGE_API_KEY       — Voyage AI eliminated
ANTHROPIC_API_KEY    — Legacy Claude eliminated from app (keep for ingestion scripts)
```

---

## Coding Conventions

- **Svelte 5 runes:** Use `$state`, `$derived`, `$effect`. No `writable()` or `readable()` stores.
- **TypeScript strict mode:** All files are `.ts` or `.svelte` with TypeScript. No `any` unless absolutely unavoidable.
- **Tailwind CSS 4:** Utility classes for styling. Use `@apply` sparingly.
- **Error handling:** Server-side code should never throw unhandled. Use typed error classes (e.g., `DatabaseError`). Catch and log with `console.error('[MODULE]', ...)` prefix.
- **Logging format:** `[MODULE] message` — e.g., `[ENGINE]`, `[RETRIEVAL]`, `[EXTRACTION]`, `[CACHE]`, `[AUTH]`.
- **SSE events:** All new event types must be added to the `SSEEvent` discriminated union in `src/lib/types/api.ts`.
- **Imports:** Use `$lib/` prefix for imports from `src/lib/`. Use `$env/dynamic/private` for server-side env vars. Use `import.meta.env.VITE_*` for client-side env vars.
- **No default exports.** Use named exports.
- **Commit granularity:** One commit per phase. Descriptive commit message: `feat(phase-a): enable Google Search grounding in all passes`.

---

## Testing Strategy

There is no test framework in this project. Verification is done via:

1. **Build check:** `pnpm build` must succeed with no errors
2. **Type check:** `pnpm check` must pass
3. **Manual integration test:** Deploy to Cloud Run, submit a query, verify SSE events in browser DevTools, check Cloud Logging
4. **Retrieval comparison:** `scripts/test-retrieval.ts` for embedding migration (Phase B)
5. **Health check:** `curl https://usesophia.app/api/health | jq .`

---

## Common Pitfalls

1. **Vercel AI SDK `streamText` with tools:** When using `tools` parameter, the stream may emit tool call events alongside text. The text output is still available via `stream.textStream`. Sources are available via `await stream.sources` (a Promise that resolves after the stream completes).

2. **SvelteKit `hooks.server.ts`:** This file must be at the root of `src/`, not inside a route. It runs for every request.

3. **Firebase Admin on Cloud Run:** Do NOT pass credentials manually. `initializeApp()` with no arguments uses Application Default Credentials, which are automatically available on Cloud Run.

4. **Firebase client config is public:** The `VITE_FIREBASE_*` values are safe to expose in client-side code. They are public identifiers, not secrets. Auth security comes from the server-side token verification.

5. **SurrealDB embedding index rebuild:** After changing the vector dimension, you must `REMOVE INDEX` before `DEFINE INDEX` with the new dimension. The re-embedding script must complete before the index rebuild.

6. **Concurrent SSE events:** When Analysis and Critique stream simultaneously, `pass_chunk` events for both arrives interleaved in the stream. The client must accumulate text per pass type independently. The existing `conversation.svelte.ts` already keys on `pass` — verify this works with interleaved events.

7. **The `sophia-meta` block:** The model may occasionally fail to produce a valid `sophia-meta` block. Always handle this gracefully — if the block is missing or invalid, skip structured data for that pass and log a warning. Do not fail the entire response.

8. **Docker builds for Cloud Run:** Always build with `--platform linux/amd64`. macOS ARM builds won't run on Cloud Run.

9. **Pulumi state:** After adding Firebase resources to `infra/index.ts`, you may need to import existing resources if Firebase was manually enabled. Use `pulumi import` syntax documented in the Pulumi file's comments.

10. **Embedding dimension mismatch:** If the vector index dimension doesn't match the embedding dimension, SurrealDB vector search will silently return empty results. This is why the backup/rollback path in Phase B is critical.
