# `@sophia/graph-reasoning-extensions` — publish and versioning plan

This package holds **contracts-coupled** reasoning graph logic (compare, diff, evaluation, lineage, projection, summary). It is **not** part of **Restormel Graph Contract v0** (frozen DTOs in `@restormel/graph-core` `viewModel.ts`). See **Contract v0** scope in the Restormel Keys repo: [`packages/graph-core/GRAPH_CORE_V0_SCOPE.md`](https://github.com/Allotment-Technology-Ltd/restormel-keys/blob/main/packages/graph-core/GRAPH_CORE_V0_SCOPE.md) (or [restormel.dev/graph/docs](https://restormel.dev/graph/docs)).

## Why a separate package (and name)

- **Contract v0** (`@restormel/graph-core`) must stay free of `@restormel/contracts` imports for minimal renderers.
- **Reasoning extensions** intentionally depend on `@restormel/contracts` (including `reasoning-object`).
- Semver for **extensions** must be **independent** of graph-core v0: a new `evaluateReasoningGraph` heuristic or diff rule should not force a major bump on interactive graph DTOs.

## Target npm identity (recommended)

| Step | Action |
|------|--------|
| 1 | Publish under Restormel scope, e.g. **`@restormel/graph-reasoning-extensions`**, from the same source layout (or move tree into Restormel Keys monorepo). |
| 2 | Keep **`@restormel/graph-core`** on its own release cadence; declare a **peer or direct** dependency on `@restormel/contracts` with a supported range (e.g. `workspace:*` in monorepo, semver range when published). |
| 3 | In SOPHIA, replace imports from `@sophia/graph-reasoning-extensions/*` with `@restormel/graph-reasoning-extensions/*` once the package is on npm. |

Until step 1 completes, **`private: true`** and the **`@sophia/*`** name remain the workspace placeholder.

## Versioning policy

- **Major:** breaking changes to public function signatures, exported finding kinds, or diff keys consumed by the workspace UI.
- **Minor:** new findings, optional fields, or additional exports behind stable entrypoints (`/compare`, `/evaluation`, etc.).
- **Patch:** bugfixes and internal refactors with no contract change.

Do **not** tie this package’s major version to `@restormel/graph-core` major versions.

## Pre-publish checklist

- [ ] Run package tests: `pnpm exec vitest run packages/graph-reasoning-extensions` (or repo-equivalent).
- [ ] Confirm `exports` map covers all documented entrypoints (`compare`, `diff`, `evaluation`, `lineage`, `projection`, `summary`).
- [ ] Document peer dependency on `@restormel/contracts` version range in `package.json` `peerDependencies` when publishing externally.
- [ ] Align README with published name and installation snippet.

## Related

- [Restormel Graph — SOPHIA extraction artefacts](../../docs/restormel/04-delivery/restormel-graph-sophia-extraction-artifacts.md) — non-MVP modules table.
- [Phase 1 RunTrace emitter checklist](../../docs/restormel/phase1-run-trace-emitter-checklist.md)
