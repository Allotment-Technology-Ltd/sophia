# Restormel Keys Dogfooding — QA and Documentation Review Report

## Executive summary

Status after the current rerun: Phases 0, 1, 2, 3, 4, and 5 are complete enough to move forward. The earlier npm/CLI, dashboard project-creation, and Phase 4 policy-enforcement blockers have been resolved in practice. Sophia now has a dedicated Restormel project, a Gateway Key, a verified resolve client, a live `interactive` route wired into the analyse path via `RESTORMEL_ANALYSE_ROUTE_ID`, structured resolve error handling that safely falls back on `policy_blocked` responses, a dogfooded packaged `KeyManager` in the BYOK settings surface, and a packaged `ModelSelector` wrapped into the real thinking-engine flow.

Preliminary concerns identified during the audit:

- Sophia's routing surface is wider than a single chat endpoint; verification and learning flows also route models.
- Some response metadata already misreports the actual model used, which will become more visible once routing is externalised.
- The walkthrough should more explicitly acknowledge shared resolver abstractions and multi-entrypoint apps.
- The current published `@restormel/keys` + `@restormel/doctor` path is usable for SvelteKit headless integration, and the fixed `keys-cli` / `validate` packages now execute correctly from npm.
- The packaged UI path can now be dogfooded in Sophia, but it still depends on a local tarball install because the published Svelte package is not yet consumable from npm.
- The control plane still has live product/documentation mismatches around model catalog coverage and route-step semantics.
- The Phase 4 docs/prompts have been tightened materially: structured `/resolve` errors are now documented, the prompt order is clearer, and the page now gives agents a better end-to-end execution path.

## Phase completion matrix

| Phase | Status | Notes |
| --- | --- | --- |
| 0 — Inventory | ✅ Complete | Routing inventory written to `docs/restormel-integration/00-routing-inventory.md` |
| 1 — Install and configure | ✅ Complete | `@restormel/keys@^0.2.5` installed, `doctor` exits 0, dedicated Sophia project + Gateway Key created |
| 2 — Resolve your first model | ✅ Complete | Raw script and wrapper smoke both returned `providerType`/`modelId` successfully |
| 3 — Add routes and fallbacks | ✅ Complete | `interactive` route created and wired; fallback verified by disabling the first step |
| 4 — Apply policies | ✅ Complete | `evaluate` allowed/blocked checks pass, live non-production `policy_blocked` resolve verified, structured fallback handling added in Sophia |
| 5 — Embed the UI | ✅ Complete | Server-side allowed-models proxy, packaged `ModelSelector` wrapped into the app flow, and packaged `KeyManager` mounted in settings with server-side validation adapters |
| 6 — Go live | ⏳ Pending | Not started |

## Phase-by-phase findings

### Phase 0 — Inventory

- Phase objective:
  Audit Sophia's existing provider/model routing, model-selection UI, and BYOK surfaces so Restormel can replace them intentionally.
- Documentation accuracy:
  The official page and Prompt 0B were directionally correct and strong enough to execute an audit without guesswork. The classification model (`REMOVE` / `KEEP` / `WRAP`) matched the repo well.
- Blocking issues found:
  None for Phase 0.
- Documentation improvements:
  Add explicit guidance to search shared resolver abstractions such as `getReasoningModelRoute` or equivalent, not only raw SDK imports.
  Add a note for apps with multiple AI entrypoints that the inventory should include verification, evaluation, and learning pipelines, not just the main chat path.
  Clarify that existing BYOK custody can remain in place during early Restormel integration if the product is not yet migrating key custody.
- Completion status:
  ✅ Complete
  Latest rerun verification: `pnpm exec vitest run src/lib/restormel/model-selector.test.ts src/lib/restormel/key-manager.test.ts src/routes/api/allowed-models/allowed-models.test.ts src/lib/server/resolve-provider.test.ts 'src/routes/api/byok/providers/[provider]/validate-raw/validate-raw.test.ts'` and `pnpm check` both passed again on March 19, 2026. Manual browser verification is still blocked in this environment by Playwright/Chrome persistent-session launch failure, so Phase 5 remains code/test verified rather than visually verified.

### Phase 1 — Install and configure

- Phase objective:
  Install the correct Restormel packages for Sophia's framework, scaffold `restormel.config.json`, create a dashboard project and environment, generate a Gateway Key, and get Restormel Doctor to pass.
- Documentation accuracy:
  The high-level flow is correct after the current publish train. `doctor` detects SvelteKit correctly and exits 0 with only `@restormel/keys` installed plus a valid `restormel.config.json`. `pnpm dlx @restormel/keys-cli@0.1.2 init` now works in a clean temp directory, so the manual-config fallback is no longer required for package-health reasons.
- Blocking issues found:
  Initial project creation returned `project_limit_reached`, but the live API now allows the second project as expected and a dedicated `Sophia` project was created successfully.
- Documentation improvements:
  For pnpm monorepos, document whether install should target the repo-root app package or a nested workspace package. Sophia's runnable app lives at the repo root, while `apps/sophia` is still a placeholder.
  Keep the manual fallback for `restormel.config.json` prominent. It is still the safest recovery path if CLI publishing regresses again.
  Clarify that dashboard login is interactive, but once the session exists the remaining project/key steps can be completed normally by an automation agent.
- Completion status:
  ✅ Complete

### Phase 2 — Resolve your first model

- Phase objective:
  Add a typed resolve client, validate the resolve response shape, and introduce a feature-flagged Restormel path with a legacy fallback.
- Documentation accuracy:
  The client shape in the docs matches the live response. `scripts/test-resolve.ts` returned:
  - `routeId: "interactive"`
  - `providerType: "anthropic"`
  - `modelId: "claude-3-5-sonnet"`
  - an `explanation` string matching the selected step
  The walkthrough still underplays one practical integration issue: Sophia’s provider naming uses `vertex`, while Restormel resolve returns `google`. A provider alias layer was required in the wrapper (`google` → `vertex`) for Google-backed routes to be usable.
- Blocking issues found:
  None for the current happy path.
- Documentation improvements:
  Explicitly document provider-name normalization when an app uses provider labels that differ from the control plane (`google` vs `vertex` is the concrete case here).
  The walkthrough says Phase 2 can be validated before Phase 3, but in practice the live HTTP resolve path is only truly useful once at least one route exists. That sequencing dependency should be stated more clearly.
- Completion status:
  ✅ Complete

### Phase 3 — Add routes and fallbacks

- Phase objective:
  Create a live dashboard route with ordered steps, verify fallback behaviour, and wire the route ID into Sophia’s backend.
- Documentation accuracy:
  The route creation flow works, and the route resolved correctly once steps existed. Sophia now uses `RESTORMEL_ANALYSE_ROUTE_ID=interactive` for the analyse path rather than relying on the first active route.
- Blocking issues found:
  The walkthrough examples use model IDs such as `gemini-2.5-flash` and `claude-sonnet-4-20250514`, but the live dashboard model catalog only exposed `claude-3-5-sonnet`, `gpt-4o`, and `gpt-4o-mini`. The steps API rejected the walkthrough example IDs with `invalid_step_schema`.
  Live fallback resolution does not currently inspect key availability or provider health; it returns the first enabled step. The fallback test only worked when the first step was manually disabled, not because the resolver automatically skipped an unusable provider.
- Documentation improvements:
  Document that route steps are validated against the current dashboard model catalog, not against arbitrary provider model IDs. The walkthrough examples should match the seeded catalog or instruct the user to seed/update the catalog first.
  Do not describe fallback as automatic on model/key unavailability unless the resolver actually evaluates those conditions. The current reliable fallback proof is step enable/disable ordering.
  Mention that a single-route setup can omit `routeId`, but multi-route integrations should wire explicit route IDs immediately to avoid ordering-dependent behaviour.
- Completion status:
  ✅ Complete

### Phase 4 — Apply policies

- Phase objective:
  Bind model-governance policies to the Sophia project/environment and verify that both `evaluate` and `resolve` enforce them correctly, with safe app-side fallback behaviour.
- Documentation accuracy:
  After the latest doc and prompt refresh, Phase 4 is much closer to the shipped behavior. The updated page now matches the live `/resolve` contract more closely: structured `policy_blocked` responses, clearer terminology around `evaluate` vs `resolve`, and better prompt sequencing for planning, creation/binding, verification, and wrapper updates.
- Blocking issues found:
  No current blocker for Sophia’s Phase 4 path. Verified evidence:
  - `evaluate` with `gpt-4o` + `openai` against the live allowlist returned `allowed: false` with `violationTypes: ["model_allowlist"]`
  - `evaluate` with `claude-3-5-sonnet` + `anthropic` returned `allowed: true`
  - a non-production `policy-blocked` route returned HTTP 403 semantics through the wrapper, and Sophia logged the policy failure distinctly before falling back to legacy
- Documentation improvements:
  The earlier major gaps have mostly been addressed by the new Phase 4 prompts and rewritten page. Remaining future-work items are product-facing rather than doc blockers: a tiny typed backend helper for `evaluate`, richer dashboard policy-test UX, and stronger binding visibility.
- Completion status:
  ✅ Complete

## Blocking issues log

None currently blocking Phases 0–5 in Sophia.

## Non-blocking product issues found so far

1. `src/routes/api/v1/verify/+server.ts` hardcodes the reported model metadata to Gemini even when the actual route may differ.
2. `src/lib/server/extraction.ts` previously hardcoded extraction model metadata from env rather than recording the actual selected route; this has now been corrected in Sophia’s local code.
3. Restormel resolve returns `google`, while Sophia’s routing layer expects `vertex`; an alias layer was required in the app code.
4. The live route-step API only accepts model IDs already present in the dashboard model catalog, which is narrower than the walkthrough examples imply.
5. The live resolver currently chooses the first enabled step; it does not appear to evaluate key availability or provider health before selecting a step.
6. The current policies UI is incomplete for real usage: creating a policy works, but real rule-definition/binding management still requires direct API calls.
7. The packaged `ModelSelector` is not a controlled component yet. It does not take a current-selection prop, so Sophia had to wrap it with host-owned “selected model” state and keep its own `auto` routing control outside the component.
8. The packaged `ModelSelector` also does not expose host-level loading, error, empty, or disabled states. Sophia had to wrap it to preserve retry/error handling around the policy-filtered `/api/allowed-models` flow.
9. `KeyManager` now correctly awaits async host persistence callbacks and surfaces richer key status, but Sophia still needs a server-side raw-validation endpoint because its custody model does not allow direct browser-to-provider validation.
10. The packaged UI path still depends on unpublished/local-tarball installation, which remains a distribution problem for real external consumers even though the component contracts are much healthier now.

### Phase 5 — Embed the UI

- Phase objective:
  Expose model selection and key management in Sophia through Restormel-aware UI paths, while keeping the Gateway Key server-side and validating how the packaged `KeyManager` behaves in a real app.
- Documentation accuracy:
  The updated Phase 5 walkthrough and compatibility page are now good enough to complete the phase on both the documented headless path and a real packaged-component dogfood pass. The package-availability callouts correctly redirected the initial implementation toward a server-side allowed-models proxy first, and the packaged path could then be layered on top once the local tarball build was available.
- Blocking issues found:
  No current blocker for Sophia’s Phase 5 path, but the packaged UI path is still not consumable from npm. To dogfood `ModelSelector` and `KeyManager` inside Sophia, the app had to install `@restormel/keys-svelte` from a locally packed tarball.
- Documentation improvements:
  Add one explicit sentence that the packaged `ModelSelector` is not fully host-controlled yet: apps may still need a small wrapper for current-selection display, `auto` routing, and host-owned loading/error/empty states.
  Clarify that `POST /api/preferences` is only an example. In real apps like Sophia, model choice may remain request-scoped and flow through the existing submit route rather than a persisted user-preferences API.
  Keep saying explicitly that `KeyManager` expects host-owned persistence and may still need a server-side validation adapter when raw credentials must not go directly from the browser to providers.
- Completion status:
  ✅ Complete

## Documentation gaps

1. Phase 0 examples lean on direct SDK import searches, but Sophia's real routing is mostly hidden behind shared helper functions. That is a common enough architecture that the walkthrough should call it out directly.
2. The page says Phase 0 helps leave "one place left to wire", but larger apps may have one shared resolver plus many entrypoints. The docs should acknowledge both shapes.
3. The optional feature-flag prompt assumes a single primary function to branch. In a repo like Sophia, the safer recommendation is to introduce a shared resolver interface first, then branch once in that shared layer.
4. Phase 1 package-install instructions should acknowledge repo-root app packages in pnpm workspaces, not only nested `apps/*` packages.
5. Phase 1 should mention that manual config creation is an acceptable fallback when CLI scaffolding is unavailable.
6. Phase 2 should mention provider-label normalization for apps whose internal provider names differ from Restormel’s public API values.
7. Phase 3 should note the dependency on the live model catalog and should align example model IDs with the currently seeded catalog.
8. Phase 4’s earlier prompt/execution gaps have now been substantially addressed. The remaining improvements are mostly around convenience, not correctness.
9. Phase 5’s package-availability story is much better now, but the canonical markdown and demo references should go one step further and show a concrete headless fallback example that does not import unpublished UI packages.
10. Phase 5 should explicitly say that the packaged UI components are host-integrated shells. `KeyManager` still relies on host persistence/validation, and `ModelSelector` currently benefits from a host wrapper when the app needs controlled selection state, request-scoped `auto` mode, or host-owned loading/error/empty states.

## Recommendations

1. Keep the documented headless fallback path first-class for SvelteKit/monorepo users: `@restormel/keys` + manual `restormel.config.json` is enough for Phases 1–4.
2. Keep the npm release gate that explicitly tests `pnpm dlx @restormel/keys-cli init --help` and `npx @restormel/validate --help` from a clean environment.
3. Align the walkthrough’s Phase 3 example model IDs with the seeded dashboard model catalog, or add an explicit “seed/verify catalog first” prerequisite.
4. Decide whether control-plane provider names should be normalized centrally (`google`/`vertex`) or whether the docs should require app-side mapping.
5. Extend the live resolver so fallback considers actual step usability, not just enabled order, or narrow the docs to match the current behavior.
6. Continue migrating verification and learning paths onto the same Restormel wrapper so policies do not diverge by endpoint.
7. Treat the current Phase 4 docs refresh as the baseline going forward; the next improvements should focus on product ergonomics like typed helpers and dashboard testing UX rather than on correcting the core walkthrough.
8. Before asking external users to attempt the packaged-component path in Phase 5, either publish `@restormel/keys-svelte`, `@restormel/keys-react`, and `@restormel/keys-elements` successfully to npm or add a concrete headless fallback example that uses only `@restormel/keys`, a server-side allowed-models proxy, and an app-owned picker.
9. Improve `KeyManager` for real-host integrations: await host add/remove callbacks, expose an optional persistence/error state, and consider a richer list item API that can show validation timestamps and last-known provider status.
10. Expand the packaged provider/icon story so apps with wider BYOK matrices do not need generic icons and bespoke provider-definition wrappers for common OpenAI-compatible providers.

## Support bot knowledge base

### Q: Where is Sophia's current provider routing logic?

A: Primarily in `src/lib/server/vertex.ts`, with request validation and BYOK loading in `src/routes/api/analyse/+server.ts` and secondary callsites in verification and learning pipelines.

### Q: Can Sophia integrate Restormel without migrating BYOK custody first?

A: Yes. The current BYOK storage and validation stack can remain in place while Restormel takes over provider resolution, routing, and policy enforcement.

### Q: Which local surface is the clearest candidate to replace in Phase 5?

A: `src/routes/api/models/+server.ts` plus `src/lib/components/ModelSelector.svelte`.

### Q: What is the biggest Phase 0 risk if missed?

A: Forgetting the secondary AI paths such as verification, extraction, constitution checks, and learning flows, which would leave routing inconsistent across the product.

### Q: What blocked Phase 1 for a SvelteKit integration?

A: Earlier runs were blocked by CLI publishing and dashboard setup, but those are now resolved. Current SvelteKit headless setup works with `@restormel/keys`, `restormel.config.json`, and `npx @restormel/doctor`.

### Q: What resolve response did Sophia actually receive in Phase 2?

A: The live response was `{ routeId: "interactive", providerType: "anthropic", modelId: "claude-3-5-sonnet", explanation: "route=... step=0 provider=anthropic model=claude-3-5-sonnet" }`.

### Q: What unexpected integration shim was needed for Sophia?

A: Restormel returns `providerType: "google"` for Google-backed routes, while Sophia’s existing routing layer uses `vertex`. The wrapper now normalizes `google` to `vertex`.

### Q: What is the current Phase 4 status?

A: Phase 4 is now working in Sophia. `evaluate` returns the expected allowed/blocked results, `/resolve` produces structured `policy_blocked` failures when every enabled step is blocked, and Sophia’s wrapper logs those distinctly before falling back to legacy.

### Q: What is the current Phase 5 status?

A: Phase 5 is now working in Sophia on both the documented headless path and the dogfooded packaged-UI path. The app uses a server-side `/api/allowed-models` proxy backed by Restormel `evaluate`, keeps the Gateway Key server-side, mounts `KeyManager` in settings with server-side validation, and now runs the real packaged `ModelSelector` in the thinking-engine flow through a small host wrapper that preserves Sophia’s `auto` mode and request-scoped selection state.

### Q: What did the real `KeyManager` dogfood uncover?

A: The new contract is substantially better than the first iteration. Async add/remove, `onRevalidate`, richer key status, and broader first-party provider coverage all reduced app-side glue. The main remaining gap is still custody-related: apps like Sophia need a server-side validation bridge when raw credentials must not go directly from the browser to providers.

### Q: What did the real `ModelSelector` dogfood uncover?

A: The packaged selector is usable, but it is not fully host-controlled yet. It does not take a current-selection prop or host-owned loading/error/empty states, so Sophia had to wrap it to preserve request-scoped `auto` routing, selected-model visibility, retry behavior, and disabled states around the policy-filtered model list.
