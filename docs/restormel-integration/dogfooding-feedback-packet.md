# Restormel Keys Dogfooding Feedback Packet

## Purpose

This document consolidates the Sophia dogfooding exercise into one handoff pack for the Restormel Keys builder team. It supersedes the fragmented state across:

- `docs/restormel-integration/00-routing-inventory.md`
- `docs/restormel-integration/qa-documentation-review-report.md`
- `docs/restormel-integration/upstream-findings-report.md`
- `docs/restormel-integration/ingestion-control-plane-spec.md`
- `docs/restormel-integration/mcp-aaif-operator-guide.md`

It keeps the useful findings, removes stale outage assumptions that were later fixed, and adds the later live integration lessons that were only captured in Sophia runtime code, tests, and admin UI work.

## Executive Summary

Restormel Keys is now far closer to being a real routing control plane than it was at the start of this exercise.

The dogfooding path broke down into four stages:

1. Sophia proved the headless runtime integration first.
2. Sophia then exposed documentation and product gaps around routes, fallbacks, policies, UI packages, and package distribution.
3. Restormel subsequently stabilized the runtime and lifecycle APIs enough for Sophia to wire a real admin-side routing studio and machine-readable runtime handling.
4. A second wave of integration then exposed subtler issues around route shape, route type, execution-side provider availability, and guidance quality.

The result is positive: Restormel is now usable as a serious runtime and control-plane dependency. The remaining work is mostly about clarifying product semantics, smoothing host integration, and closing the last gaps between what Restormel can do and what integrators can safely infer from docs and UI packages.

## Final Current-State Snapshot

As of 2026-03-20, the practical Sophia view is:

- Headless Restormel routing is working in Sophia.
- MCP is usable and valuable for operator and agent workflows.
- AAIF is now publicly installable from npm as `@restormel/aaif@0.0.1`.
- The packaged Svelte UI path is still not cleanly public because `@restormel/keys-svelte` is not available on npm.
- Sophia now consumes machine-readable resolve fields rather than treating Restormel explanations as prose only.
- The admin-side ingestion routing studio is now viable because route, step, simulate, publish, rollback, and history flows exist.
- One important runtime nuance remains easy to miss: shared generic routes and dedicated stage routes do not accept the same resolve and simulate payload shape.

## What Worked First

### 1. Headless runtime integration

The first durable success was the headless path:

- `@restormel/keys` and the validate/doctor flow became usable from a SvelteKit app.
- Sophia could keep Gateway Keys server-side.
- Sophia could call Restormel `resolve` from its shared routing core rather than inventing a second app-specific router.
- Existing Sophia orchestration stayed intact while provider/model selection moved outward.

This was the right starting point. It let Sophia validate Restormel as infrastructure before committing to packaged UI or deeper control-plane adoption.

### 2. Shared routing-core insertion point

Sophia already had a broad routing surface, but it had one real insertion point: the shared model-resolution layer.

That turned out to be the correct adoption pattern:

- analyse, verify, learn, extraction, and evaluation flows could all move toward one Restormel-backed resolver
- route and policy semantics became reusable across multiple AI entrypoints
- Sophia did not need to rebuild its orchestration architecture to adopt Restormel

### 3. MCP value was clear early

The MCP surface made sense quickly for:

- model discovery
- provider validation
- cost estimation
- routing explanations
- entitlement checks
- integration scaffolding
- doc lookup during implementation

This validated MCP as an operator and agent surface. It did not validate MCP as the browser mutation path, and Sophia should not use it that way.

## What Broke Initially

### 1. Public docs and live product were out of sync

Early in the exercise, Sophia hit a familiar pattern:

- docs described capabilities that were incomplete or unstable in the live surface
- route lifecycle behavior was not available or not reliable yet
- live endpoints behaved differently from what the docs suggested
- some API affordances existed implicitly before they were properly documented

This created a large amount of uncertainty for an app team trying to decide whether a failure was:

- a product bug
- an environment problem
- an unsupported use case
- a docs gap

### 2. Package distribution was inconsistent

The headless/runtime packages became usable first, but package availability across the integration story was uneven.

Historically during dogfooding:

- headless integration worked
- the Svelte package path required local tarball usage
- AAIF docs existed before AAIF was publicly installable

Current state is better:

- `@restormel/aaif` is now on npm
- `@restormel/keys-svelte` is still not on npm

The lesson is straightforward: docs must distinguish clearly between:

- publicly installable packages
- private/local install paths
- documented future surfaces

### 3. Route and fallback semantics were underspecified

At the start, Sophia could not safely infer:

- how route steps were meant to behave when a model was configured but not actually usable
- how provider health should influence route selection
- how much runtime context Restormel expected to make a good selection
- how fallback chains were supposed to interact with actual execution capability in the host app

The product is materially stronger now, but this theme remained important through the later integration stages.

## What Restormel Fixed During the Exercise

The following changes materially improved the integration and unblocked deeper Sophia work:

### 1. Runtime endpoint hardening

Top-level structured error handling made failures deterministic enough for Sophia to distinguish:

- bad requests
- auth and permission failures
- missing routes
- internal Restormel failures

That moved the integration away from opaque breakage and toward actionable runtime behavior.

### 2. Route lifecycle APIs

The later addition of:

- publish
- rollback
- history

was a major control-plane milestone. Without those, Sophia could not ship a production-safe route editor or route studio.

### 3. Route version persistence

The route-history migration made lifecycle behavior real rather than notional. That matters because a route editor without versioning and rollback is not operationally safe.

### 4. Expanded resolve contract

The most important technical improvement was the richer resolve response. Sophia now relies on machine-readable fields such as:

- `selectedStepId`
- `selectedOrderIndex`
- `switchReasonCode`
- `estimatedCostUsd`
- `matchedCriteria`
- `fallbackCandidates`
- `providerType`
- `modelId`
- `explanation`

This changed Restormel from “routing plus prose” into an actual runtime decision service that a UI and pipeline can reason over.

### 5. Enriched step schema

Richer route-step fields made it plausible to expose route chains meaningfully in admin tooling instead of treating them as opaque backend state.

### 6. Better provider health basis

Using project bindings first and falling back to workspace integrations is the right direction. It makes the health surface more useful than a pure global/provider-status abstraction.

## What Then Worked In Sophia

Once the newer Restormel surface existed, Sophia could wire substantially more of the intended flow.

### 1. Full admin-side proxy layer

Sophia now has server-side proxy routes for:

- routes
- steps
- simulate
- resolve probes
- publish
- rollback
- history
- providers health
- routing capabilities
- switch criteria enums

This is the correct browser architecture. Gateway Keys stay server-side, and the browser consumes thin Sophia-owned admin APIs.

### 2. Machine-readable runtime handling

Sophia now uses the structured resolve metadata in both runtime and admin flows.

This enabled:

- logging selected steps and route decisions
- showing active and fallback candidates in admin UI
- displaying switch reason codes
- using estimated cost and matched criteria without brittle text parsing

### 3. Ingestion-stage planning through Restormel

Sophia’s ingestion planning moved from local stage profiles toward Restormel-backed route resolution. That is the right long-term model even where some bootstrap assumptions still exist.

### 4. A real admin routing studio became possible

Once route lifecycle and resolve/simulate stabilized, Sophia could move beyond “spec only” and toward a real admin surface for route inspection and editing.

## What Needed Changing After That

The next layer of issues was subtler and more valuable because it reflected real product semantics, not missing endpoints.

### 1. Shared generic routes vs dedicated stage routes

This was one of the most important late findings.

Sophia discovered that a shared generic route and a dedicated stage route do not behave the same way at runtime:

- dedicated stage routes can accept stage-aware context
- shared generic routes need a generic resolve/simulate payload

If Sophia sent `workload` and `stage` to a shared generic route, the live Restormel project returned `no_route`.

Sophia had to add route-mode awareness:

- dedicated route -> send stage-aware context
- shared route -> omit stage/workload and send the generic payload

This needs to be explicitly documented in Restormel guidance. It is not a small detail.

### 2. Successful resolve does not guarantee executable runtime

Sophia also hit a second important semantic gap:

- Restormel successfully resolved a shared route to Anthropic
- the local Sophia environment did not have an Anthropic credential
- without extra guarding, Sophia would crash after a perfectly valid resolve

Sophia now degrades cleanly to a safe default where failure mode allows it.

The upstream product and docs implication is:

- route selection and execution capability are related but not identical
- docs should explain the host’s responsibility clearly
- provider health and route eligibility should ideally reflect execution reality as much as possible

### 3. Embedding routing remains less proven than reasoning routing

Reasoning and completion flows are much more mature in the current integration than embedding flows.

Sophia still treats embeddings more cautiously because the end-to-end live route contract for embedding-specific execution has been less clearly proven than the reasoning path.

### 4. Cost simulation and runtime cost handling are not the same thing

The existence of `simulate` is important, but route cost preview and actual runtime execution/cost behavior still need clean documentation:

- when to rely on simulation
- how exact or approximate estimates are
- how simulation interacts with switch criteria and retries

## Remaining Product Improvements

These are the most useful improvements to push back to the Restormel builder now.

### 1. Document route types explicitly

Restormel should document the difference between:

- shared generic routes
- dedicated stage-aware routes

and show:

- what request shape each expects
- when `stage` and `workload` should be present
- what happens if an integrator mixes the two

### 2. Clarify the resolve-to-execution contract

Guidance should explicitly cover:

- resolve may return a provider/model the host still cannot execute
- what host-side checks should happen after resolve
- when to fail hard vs degrade
- how `providers/health` should be interpreted relative to actual execution credentials

### 3. Improve the provider-health story

Sophia still observed a case where `providers/health` was live but returned an empty provider list for the current project.

That is better than a broken endpoint, but still weak as an operator experience. The endpoint should make it obvious whether this means:

- no bindings configured
- bindings configured but no healthy providers
- project inheritance is empty
- provider discovery failed

### 4. Make UI package availability match the docs

As of 2026-03-20:

- `@restormel/aaif` is published
- `@restormel/keys-svelte` is not

The docs should stop implying a uniform “install from npm” story where it does not exist yet.

### 5. Continue improving host control for packaged UI

Dogfooding of `KeyManager` and `ModelSelector` showed that packaged UI is most valuable when the host app can still control:

- loading state
- empty state
- error state
- selection state
- disabled state
- surrounding workflow copy and layout

The more the packaged components behave like embeddable primitives rather than sealed widgets, the easier adoption becomes.

### 6. Tighten simulation and routing docs around switchover semantics

The route-step and simulate docs should make it obvious how these concepts relate:

- priority order
- provider health
- failure kind
- retry policy
- cost policy
- matched criteria
- fallback candidates
- final selected step

This is where operator trust is won or lost.

## Guidance-Material Fixes

These are the main documentation improvements Restormel should make based on the Sophia exercise.

### 1. Acknowledge multi-entrypoint apps early

The docs should not assume “one chat endpoint equals the routing surface”.

Sophia had to integrate Restormel across:

- analyse
- verify
- learn
- extraction
- evaluation
- ingestion planning

That should be reflected in the guidance.

### 2. Keep the headless-first path first-class

The best adoption path was:

1. headless routing
2. route and policy integration
3. packaged UI later

The docs should present that as a valid default path, not as a fallback for apps that failed to adopt packaged UI.

### 3. Add package-availability truth tables

Each integration guide should clearly distinguish:

- published on npm
- local tarball only
- private package
- documented but not publicly installable

This would have removed a lot of initial uncertainty.

### 4. Add dedicated vs shared route examples

Show both:

- a dedicated ingestion-stage route example
- a shared generic route example

with the exact resolve and simulate request payloads for each.

### 5. Show machine-readable resolve handling in examples

Examples should not stop at `providerType` and `modelId`.

They should also demonstrate consumption of:

- `selectedStepId`
- `selectedOrderIndex`
- `switchReasonCode`
- `matchedCriteria`
- `fallbackCandidates`
- `estimatedCostUsd`

This is the contract that makes a real operator UI possible.

### 6. Explain migration and lifecycle prerequisites

If publish, rollback, and history depend on a migration or environment prerequisite, that should be stated clearly in the docs and rollout guidance.

### 7. Clarify embedding support explicitly

If embedding routing is fully supported, show the production example.

If it is still narrower than reasoning routing, say so plainly.

## Current Sophia-Side Workarounds That Were Reasonable

These were valid app-side decisions and should not be framed as failures of adoption:

- server-side admin proxies over Restormel Dashboard APIs
- keeping Gateway Keys out of the browser
- host wrapper around packaged model-selection UI
- degraded safe-default fallback when resolve succeeds but local execution cannot
- route-mode-aware resolve logic for shared vs dedicated routes

These are the kinds of host responsibilities the Restormel docs should normalize.

## Most Important Feedback To Send Back

If this packet is reduced to a short upstream action list, it should be:

1. Document shared generic routes vs dedicated stage routes clearly.
2. Document the resolve-to-execution contract, not just the resolve response.
3. Improve `providers/health` semantics so empty states are operator-readable.
4. Keep headless-first integration as the recommended starting path.
5. Make package-availability guidance brutally explicit.
6. Continue improving packaged UI as host-controlled primitives.
7. Show machine-readable resolve handling and lifecycle flows in end-to-end examples.

## Source Artifacts

The original dogfooding outputs that informed this packet are:

- `docs/restormel-integration/00-routing-inventory.md`
- `docs/restormel-integration/qa-documentation-review-report.md`
- `docs/restormel-integration/upstream-findings-report.md`
- `docs/restormel-integration/ingestion-control-plane-spec.md`
- `docs/restormel-integration/mcp-aaif-operator-guide.md`

The later live-integration findings were also reflected in Sophia implementation work under:

- `src/lib/server/restormel.ts`
- `src/lib/server/resolve-provider.ts`
- `src/lib/server/vertex.ts`
- `src/lib/server/aaif/ingestion-plan.ts`
- `src/routes/admin/ingestion-routing/+page.svelte`
- `src/routes/admin/operations/+page.svelte`
