# Stoa Dialogue Agent Tooling Recommendation

## Purpose

This document recommends a concrete tooling stack for Stoa Mode 6 (Stoic Dialogue) that is fully aligned with SOPHIA's current architecture and migration trajectory.

This recommendation is intentionally conservative: reuse existing SOPHIA patterns wherever they already work, and add dependencies only when they clearly reduce complexity.

## Constraints and alignment gates

All recommendations in this document are filtered through these non-negotiable gates:

- Server-side LLM calls must go through `src/lib/server/vertex.ts` (single model-routing path).
- Retrieval and grounding must reuse `src/lib/server/retrieval.ts` and `src/lib/server/embeddings.ts`.
- Streaming should follow existing native SvelteKit `ReadableStream` + SSE patterns.
- Stoa v1 is single-agent dialogue, not a multi-agent orchestration problem.
- Hosting assumptions must remain host-neutral (works on current and planned infra).
- New dependencies must justify maintenance cost for a solo founder.

## Current state summary

### What SOPHIA already has and should be reused

- **Model routing and provider abstraction**
  - `src/lib/server/vertex.ts` already centralizes provider/model routing, including Restormel-aware decisioning and BYOK/platform key behavior.
  - `src/lib/server/engine.ts` already uses AI SDK core primitives (`streamText`, `generateText`, `generateObject`) successfully.
- **Streaming API pattern**
  - Existing endpoints use native SSE with SvelteKit `ReadableStream`:
    - `src/routes/api/analyse/+server.ts`
    - `src/routes/api/verify/+server.ts`
  - This gives a proven pattern for low-latency, incremental UI updates.
- **Graph-grounded retrieval**
  - `src/lib/server/retrieval.ts` already implements graph-aware retrieval with typed relation traversal and dialectical closure behavior.
  - `src/lib/server/embeddings.ts` already provides provider abstraction for query/document embeddings.
- **Data foundations**
  - SurrealDB schema and graph tables are already operational (`scripts/setup-schema.ts`).
  - Existing query history is currently mixed/legacy-oriented; Stoa can add a dedicated session path without forcing a history rewrite.

### Gaps to fill for Stoa Mode 6

- A dedicated conversational endpoint and session model (`/api/stoa/dialogue`).
- Stance detection module (Hold/Challenge/Guide/Teach/Sit With).
- Stoic framework matching logic and prompt assembly.
- Crisis safety response protocol as first-class runtime behavior.
- Optional deep-analysis escalation orchestration from conversational mode to full three-pass reasoning.

## Tool-by-tool assessment

### A. Vercel AI SDK (`ai`, `@ai-sdk/svelte`, `@ai-sdk/google`)

### Current status

- Installed now:
  - `ai`: `6.0.105` in repo (`6.0.141` latest on npm).
  - `@ai-sdk/google`: `3.0.43` in repo (`3.0.53` latest).
- Removed from repo (Phase 3c / GCP exit): `@ai-sdk/google-vertex` — platform Gemini uses `GOOGLE_AI_API_KEY` via `@ai-sdk/google` only.
- Not currently installed:
  - `@ai-sdk/svelte` (`4.0.141` latest), peer dependency `svelte ^5.31.0` (compatible with current Svelte 5).
- License: Apache-2.0.
- Active maintenance: yes (current major line and active docs).

### What it provides for Stoa

- **Server core (`ai`)**: robust streaming generation, tool calling, structured outputs.
- **Provider packages**: consistent adapter layer for Gemini and other providers under the same API.
- **UI option (`@ai-sdk/svelte`)**:
  - Svelte `Chat` class abstraction.
  - Transport customization and persistence patterns.
  - Built-in stream protocol support.

### What it does not provide

- It does not replace SOPHIA-specific stance detection or framework logic.
- It does not provide philosophical retrieval strategy; that remains SOPHIA code.
- It does not persist sessions by itself; persistence remains app responsibility.

### Integration cost

- **Server side**: low (already adopted).
- **Client side with `@ai-sdk/svelte`**: medium; requires mapping existing custom conversation store and SSE event shape to AI SDK UI message format.

### Risk

- Low for server core use (already proven in production codebase patterns).
- Moderate for UI migration complexity if introduced too early.

### Verdict

- **`ai` core: Use (already core).**
- **`@ai-sdk/google`: Use through existing router only (Google AI Studio / API key path).**
- **`@ai-sdk/svelte`: Defer for v1; optional optimization later if it clearly simplifies the Stoa UI.**

### B. Google model SDK options (`@google-cloud/vertexai`, `@google/generative-ai`)

### Current status

- `@google/generative-ai` is installed (`0.24.1`) but the upstream repository is marked legacy/deprecated and directs migration to newer Google Gen AI SDKs.
- `@google-cloud/vertexai` latest `1.10.3` has deprecation notice for `VertexAI` class path and migration guidance to newer SDK flows.

### What they provide

- Direct Google SDK access and native streaming/function patterns.

### What they do not provide (for SOPHIA context)

- They do not add value over SOPHIA's existing `vertex.ts` routing abstraction for this use case.
- They would create a second model invocation path if used directly in Stoa code.

### Integration cost

- Medium to high if introduced for Stoa-only behavior (new path, duplicate provider logic, more migration burden).

### Risk

- Architecture drift risk: parallel LLM call pathways.
- Migration churn risk: changing Google SDK recommendations.

### Verdict

- **Skip for Stoa v1 direct use.** Keep single-path invocation via `src/lib/server/vertex.ts`.
- **No exception currently justified.** Any future exception must explicitly prove that the router path cannot satisfy a required capability.

### C. SvelteKit native streaming (ReadableStream + SSE)

### Current status

- Already in use and stable in SOPHIA API routes.

### What it provides

- Full control over event schema, pacing, partial updates, and metadata.
- No additional dependency.
- Host-neutral behavior across current and planned infrastructure.

### What it does not provide

- No built-in chat state model; that remains client/store code.

### Integration cost

- Low; this is already SOPHIA's existing pattern.

### Risk

- Low; known operational behavior in existing endpoints.

### Verdict

- **Use as default Stoa v1 streaming transport.**

### D. LangChain.js (`langchain`, `@langchain/core`, `@langchain/google-vertexai`)

### Current status

- Active ecosystem and packages.
- Adds substantial package footprint and extra abstraction layers.
- LangChain now emphasizes broader agentic stacks (including LangGraph and Deep Agents) that are out of scope for Stoa v1.

### What it provides

- Generalized chain/agent abstractions, tools, retrieval patterns.

### What it does not provide (relative to SOPHIA needs)

- No unique benefit for one retrieval step + one model call + optional escalation when these primitives already exist in SOPHIA.
- Does not replace SOPHIA's domain-specific retrieval semantics and stance logic.

### Integration cost

- Medium to high; extra abstraction and dependency surface for little v1 benefit.

### Risk

- Overengineering and maintenance overhead.
- Pressure toward agent-framework patterns that dilute SOPHIA differentiation.

### Verdict

- **Skip for v1.**

### E. Conversation/session persistence options

### Current status

- Existing "history" APIs are legacy-oriented and not a dedicated Stoa session model.
- SOPHIA already uses SurrealDB and has graph-query/server data infrastructure.

### Recommendation

- Implement Stoa session persistence as a dedicated new server path (SurrealDB recommended for v1 alignment with Stoa's graph-adjacent reasoning context).
- Keep structure simple: session record + turns + rolling summary + expiry metadata.

### Verdict

- **Use bespoke persistence on existing datastore infrastructure; do not add chat-session libraries for v1.**

### F. Other potentially relevant tools

- No additional third-party "Stoic dialogue" libraries are recommended.
- Stance detection and framework mapping are product-core behaviors and should remain bespoke SOPHIA modules.

## Recommended stack

| Concern | Tool | Justification |
|---|---|---|
| Streaming chat | SvelteKit `ReadableStream` + SSE | Already used in production routes; no new dependency; full control |
| LLM provider calls | Existing `src/lib/server/vertex.ts` router + AI SDK core | Enforces single model path and reuses Restormel/BYOK/provider routing |
| Client chat UI state | Existing custom Svelte store pattern (v1) | Avoids migration churn; already compatible with SSE event handling |
| Knowledge graph retrieval | `src/lib/server/retrieval.ts` | Core SOPHIA differentiator; graph-aware and dialectical |
| Session persistence | New Stoa session store path on existing data stack (SurrealDB-first) | Dedicated conversation sessions without forcing legacy history rewrite |
| Stance detection | Bespoke SOPHIA module + system prompt rules | Product differentiation; needs philosophy-specific calibration |
| Tool/function calling | AI SDK core tools (`tool`, `generateText`/`streamText` as needed) | Native support without framework overhead |

## Integration sketch (within existing SOPHIA architecture)

### Existing files to reuse directly

- `src/lib/server/vertex.ts`
- `src/lib/server/engine.ts` (pattern reference for model calls and streaming semantics)
- `src/lib/server/retrieval.ts`
- `src/lib/server/embeddings.ts`
- `src/routes/api/analyse/+server.ts` (SSE endpoint pattern)
- `src/routes/api/verify/+server.ts` (SSE endpoint pattern)

### New files/modules (proposed)

- `src/lib/server/stoa/stance.ts`
  - stance detection logic and transition heuristics.
- `src/lib/server/stoa/frameworks.ts`
  - framework applicability matching and guardrails.
- `src/lib/server/stoa/prompt.ts`
  - system prompt assembly and conversation directives.
- `src/lib/server/stoa/safety.ts`
  - crisis detection and response protocol helpers.
- `src/lib/server/stoa/sessionStore.ts`
  - Stoa session load/save/summary/expiry operations.
- `src/routes/api/stoa/dialogue/+server.ts`
  - streaming conversation endpoint.
- `src/routes/api/stoa/dialogue/[sessionId]/escalate/+server.ts` (or inline async branch)
  - optional deep-analysis escalation trigger/status handling.

### Data flow

1. User sends message to `POST /api/stoa/dialogue`.
2. Server loads session context (recent turns + rolling summary).
3. Server computes stance candidate (inline logic + uncertainty branch).
4. Server retrieves relevant Stoic claims via `retrieval.ts` using session-aware query text.
5. Server builds grounded prompt context + invokes model through `vertex.ts` route resolution.
6. Server streams response chunks via SSE.
7. Server persists user/assistant turns, stance label, framework list, referenced claims.
8. If escalated: background deep analysis run triggers and later emits a follow-up conversational synthesis.

### Where stance detection runs

- **v1:** in the same request path before generation (no separate classifier call).
- **Phase 2 optional:** hybrid classifier for ambiguous messages only.

### Runtime neutrality note

- The integration above is intentionally host-neutral.
- It should run unchanged across current and planned infrastructure as long as standard SvelteKit server streaming and existing SOPHIA provider/retrieval modules are available.

## What to build bespoke (and why)

- **Stance detection policy and transitions**
  - This is core UX differentiation; generic chat frameworks do not encode SOPHIA's Stoic pedagogical intent.
- **Framework matching and misuse detection**
  - Must encode applicability boundaries (including emotional suppression misuse).
- **System prompt architecture**
  - Tone, pedagogy, safety, and source-weaving behavior are core product semantics.
- **Escalation policy**
  - The handoff between conversational mode and three-pass analysis is SOPHIA-specific.
- **Safety protocol integration**
  - Crisis behavior must be explicit, auditable, and tightly coupled to this domain.

## Final recommendation

For Stoa v1, implement on top of existing SOPHIA primitives:

- Keep **one model path** through `vertex.ts`.
- Keep **one retrieval path** through `retrieval.ts` and `embeddings.ts`.
- Keep **native SSE** for transport.
- Add **bespoke Stoa modules** for stance, frameworks, prompting, and safety.
- Defer UI abstraction migration (`@ai-sdk/svelte`) until after v1 validation shows clear simplification value.

This gives the fastest path to a high-quality dialogue agent while preserving architectural coherence during current auth/provider/hosting migrations.
