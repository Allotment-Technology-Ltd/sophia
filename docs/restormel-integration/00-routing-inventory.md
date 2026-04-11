# Restormel Keys Integration — Phase 0 Routing Inventory

## Scope

This document records the current AI routing surface in `usesophia.app` before any Restormel Keys code is added. It follows the official walkthrough for Phase 0 and is based on direct inspection of the live codebase on 2026-03-18.

## Phase 0 deliverables

- Identify every file that currently participates in provider selection, model selection, fallback behaviour, or BYOK key usage.
- Classify each item as `REMOVE`, `KEEP`, or `WRAP`.
- Document at least one real end-to-end provider call pattern.
- Map each item to the walkthrough phase where it will be replaced or integrated.

## Evidence collected

Searches and traces used during the audit:

- Provider SDK imports: `openai`, `@anthropic-ai/sdk`, `@google/generative-ai`, `@ai-sdk/*`, `google-vertex`
- Shared resolver call sites: `getReasoningModelRoute`, `getReasoningModel`, `getExtractionModel`, `getAvailableReasoningModels`
- User-facing selection UI: `ModelSelector`, `model_provider`, `model_id`, `credential_mode`, `byok_provider`
- BYOK/key management: `/api/byok/providers`, `loadByokProviderApiKeys`, `getByokProviderApiKey`
- Fallback and routing config: `ENABLE_DEEP_MODEL_ROUTING`, `DEEP_MODEL_PROVIDER`, `BYOK_ENABLED_PROVIDERS`

## Current routing strategy

Sophia does not have a single `ai-router.ts` style module. The routing logic is spread across:

1. Shared resolver helpers in `src/lib/server/vertex.ts`
2. Request handlers that validate provider/model inputs and load BYOK credentials
3. App UI state that lets the user choose platform vs BYOK, provider, and custom model IDs
4. Secondary pipelines that call the same shared resolver for verification, constitution, extraction, and learning flows

In practice, `src/lib/server/vertex.ts` is the current routing core. It decides:

- which provider to use
- which model ID to use
- whether credentials come from platform env vars or user BYOK storage
- how deep mode escalates to a different provider/model
- which models are exposed to the frontend

## Routing inventory

| Surface | Files | Current responsibility | Classification | Why | Restormel phase |
| --- | --- | --- | --- | --- | --- |
| Shared routing core | `src/lib/server/vertex.ts` | Builds provider clients, chooses provider/model, exposes model catalog, applies local auto/deep routing rules | `WRAP` | This is the main insertion point for Restormel `resolve` and later route/policy logic. The provider client builders may remain useful, but local provider-selection branches should be retired. | 2, 3, 4, 6 |
| Main reasoning engine | `src/lib/server/engine.ts` | Calls the shared resolver for analysis/critique/synthesis/verification passes and streams model outputs | `KEEP` | The orchestration is app-specific. Only the model-resolution calls inside it should change. | 2, 3, 4 |
| Domain-agnostic reasoning wrapper | `src/lib/server/reasoningEngine.ts` | Reuses the main engine for verification-style reasoning | `KEEP` | Thin wrapper around the main engine. It should inherit Restormel once the shared resolver is replaced. | 2 |
| Primary backend entrypoint | `src/routes/api/analyse/+server.ts` | Validates `credential_mode`, `byok_provider`, `model_provider`, `model_id`; loads BYOK keys; gates access; launches `runDialecticalEngine` | `WRAP` | Request validation, auth, billing, and SSE stay. Local provider/model validation should move toward Restormel evaluate/resolve. | 2, 4 |
| Verification endpoints | `src/routes/api/verify/+server.ts`, `src/routes/api/v1/verify/+server.ts`, `src/lib/server/verification/pipeline.ts` | Load BYOK keys, run reasoning/extraction/evaluation pipeline, expose JSON/SSE responses | `WRAP` | Endpoint logic stays, but provider/model resolution should become Restormel-backed so the verification path matches the main app. | 2, 4 |
| Extraction/evaluation helpers | `src/lib/server/extraction.ts`, `src/lib/server/reasoningEval.ts`, `src/lib/server/constitution/evaluator.ts` | Use shared model helpers for extraction, scoring, and constitution checks | `WRAP` | These are secondary AI call paths that should not bypass Restormel once policies/routes are introduced. | 2, 4 |
| Learning flows | `src/lib/server/learn/pipeline.ts`, `src/routes/api/learn/short-review/+server.ts`, `src/routes/api/learn/essay/review/+server.ts`, `src/routes/api/learn/essay/[id]/revise/+server.ts` | Use the shared resolver for essay review, short review, and revision flows | `WRAP` | Same reason as verification: they are separate entrypoints but part of the same model-routing surface. | 2, 4 |
| Frontend model selection shell | `src/routes/app/+page.svelte` | Lets users choose platform vs BYOK, active provider, catalog model, or custom model ID before calling `/api/analyse` | `WRAP` | The surrounding UX is app-specific, but the model list and picker behaviour should eventually come from Restormel policy-filtered data. | 5 |
| Local model picker component | `src/lib/components/ModelSelector.svelte` | Renders the current in-app model dropdown | `REMOVE` | The walkthrough’s Phase 5 expects Restormel `ModelSelector`; this local selector is the clearest replacement candidate. | 5 |
| Local model catalog endpoint | `src/routes/api/models/+server.ts` | Returns locally computed available models based on BYOK status and `vertex.ts` config | `REMOVE` | Phase 5 calls for a server-side proxy returning Restormel-filtered models. This endpoint should be replaced rather than layered on top. | 5 |
| BYOK storage/API | `src/lib/server/byok/store.ts`, `src/lib/server/byok/config.ts`, `src/lib/server/byok/validation.ts`, `src/routes/api/byok/providers/+server.ts`, `src/routes/api/byok/providers/[provider]/+server.ts`, `src/routes/api/byok/providers/[provider]/validate/+server.ts` | Stores encrypted BYOK secrets, validates them, and exposes provider status to the UI | `KEEP` | Sophia already has app-specific BYOK storage, validation, wallet, and entitlement flows. Restormel routing can be integrated without migrating custody immediately. | 1, 5 |
| BYOK management UI | `src/lib/components/panel/SettingsTab.svelte`, `src/routes/developer/+page.svelte` | Lets signed-in users save, validate, revoke, and inspect BYOK credentials | `KEEP` | Existing UI can coexist while Restormel routing is dogfooded. Later adoption of Restormel `KeyManager` is a product choice, not a Phase 0 prerequisite. | 5 |
| Legacy direct Anthropic path | `src/routes/api/+server.ts`, `src/lib/server/claude.ts` | Old SSE endpoint that streams three passes directly from Anthropic without the shared routing core | `REMOVE` | This is a parallel legacy surface that bypasses the current routing system entirely. If still needed, it should be explicitly deprecated or brought onto the same path. | 6 |
| Standalone Gemini validation utility | `src/lib/server/gemini.ts` | Direct Google Generative AI helper for validation tooling | `KEEP` | This appears to be a specialised utility, not the main user-facing routing path covered by the walkthrough. | Out of current walkthrough scope |

## Current provider call pattern

### Primary path: app query to `/api/analyse`

1. The user selects a key source, provider, and optional custom model in `src/routes/app/+page.svelte`.
2. `buildCredentialOptions()` converts that UI state into:
   - `credentialMode: 'platform'` for platform runs, or
   - `credentialMode: 'byok'` plus `byokProvider`
3. `buildModelOptionsForSubmit()` converts the chosen model into:
   - `modelProvider`
   - `modelId`
4. `conversation.submitQuery()` in `src/lib/stores/conversation.svelte.ts` sends those values to `POST /api/analyse`.
5. `src/routes/api/analyse/+server.ts`:
   - loads BYOK keys with `loadByokProviderApiKeys(uid)`
   - validates `credential_mode`, `byok_provider`, `model_provider`, `model_id`
   - checks whether the requested provider/model is allowed by current local rules
   - calls `runDialecticalEngine(...)`
6. `src/lib/server/engine.ts` calls `getReasoningModelRoute(...)` three times for analysis, critique, and synthesis.
7. `src/lib/server/vertex.ts` decides:
   - provider
   - model ID
   - credential source (`platform` or `byok`)
8. The selected provider client is constructed in `vertex.ts` via:
   - `createVertex(...)`
   - `createAnthropic(...)`
   - `createOpenAI(...)`
   - `createGoogleGenerativeAI(...)` for BYOK Vertex/Gemini cases
9. The engine uses those route objects with the AI SDK to `streamText`, `generateText`, or `generateObject` depending on the downstream task.
10. Errors are surfaced either:
   - early in `api/analyse` as request validation failures, or
   - later from the provider/client layer as runtime exceptions

### Current auto-routing behaviour

The local resolver in `src/lib/server/vertex.ts` behaves as follows:

- If `requestedProvider !== 'auto'`, it routes directly to that provider and model after availability checks.
- If `requestedProvider === 'auto'` and the run is not a deep escalation, it prefers user BYOK keys in this order:
  - `vertex`
  - `openai`
  - `xai`
  - `groq`
  - `mistral`
  - `deepseek`
  - `together`
  - `openrouter`
  - `perplexity`
  - `anthropic`
- If no BYOK key is present, it falls back to platform Vertex.
- Deep mode may escalate to `DEEP_MODEL_PROVIDER` if enabled.

Important consequence: platform OpenAI/Anthropic-style providers are not part of the normal `auto` path unless explicitly requested; `auto` mostly means "prefer BYOK if present, otherwise platform Vertex".

## Environment and config surface affecting routing

Primary env/config inputs discovered during the audit:

- `GOOGLE_VERTEX_PROJECT`, `GCP_PROJECT_ID`, `GOOGLE_CLOUD_PROJECT`, `GCLOUD_PROJECT`, `VITE_FIREBASE_PROJECT_ID`
- `GEMINI_REASONING_MODEL`
- `GEMINI_EXTRACTION_MODEL`
- `GEMINI_DEEP_REASONING_MODEL`
- `GEMINI_DEEP_ANALYSIS_MODEL`
- `GEMINI_DEEP_CRITIQUE_MODEL`
- `GEMINI_DEEP_SYNTHESIS_MODEL`
- `GEMINI_DEEP_VERIFICATION_MODEL`
- `ENABLE_DEEP_MODEL_ROUTING`
- `DEEP_MODEL_PROVIDER`
- `DEEP_MODEL_PASSES`
- `ANTHROPIC_API_KEY`
- `BYOK_ENABLED_PROVIDERS`
- Provider-specific platform/base URL env names defined in `@restormel/contracts` / Restormel Keys `packages/contracts/src/providers.ts`

## Issues found during the audit

These did not block Phase 0 completion, but they matter for later phases:

1. `src/routes/api/v1/verify/+server.ts` reports `metadata.model` from `process.env.GEMINI_REASONING_MODEL`, even though the verification pipeline can run with other providers and BYOK keys.
2. `src/lib/server/extraction.ts` records `extraction_model` from `process.env.GEMINI_EXTRACTION_MODEL`, which can also misreport the actual model used after routing changes.
3. The routing surface is broader than the walkthrough examples imply because Sophia has multiple AI entrypoints beyond the main chat flow.

## Replacement sequence

1. Phase 1: install Restormel packages, create dashboard project, and verify framework compatibility.
2. Phase 2: add a shared Restormel-backed resolve path at the routing core, starting from `src/lib/server/vertex.ts` and the `engine.ts` callsites.
3. Phase 3: replace local route/fallback selection rules with dashboard route IDs.
4. Phase 4: move provider/model guardrails out of local validation and into Restormel evaluate-backed policy checks.
5. Phase 5: replace `src/routes/api/models/+server.ts` plus the local `ModelSelector.svelte` path with Restormel UI/proxy integration.
6. Phase 6: remove the remaining local routing branches and legacy direct-Anthropic path once the Restormel path is stable.

## Phase 0 gate check

- Routing inventory exists: yes
- `REMOVE` / `KEEP` / `WRAP` classifications recorded: yes
- One real provider call pattern documented: yes
- Replacement mapping to later phases recorded: yes

Phase 0 is complete.
