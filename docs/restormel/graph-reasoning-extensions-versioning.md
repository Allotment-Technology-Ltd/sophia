# `@restormel/graph-reasoning-extensions` — versioning (npm)

SOPHIA consumes this package from **npm** (`^0.1.0`). Source of truth lives in the **Restormel Keys** monorepo (`packages/graph-reasoning-extensions`).

## Relationship to Contract v0

- **`@restormel/graph-core`** Contract **v0** (`viewModel.ts`) has **no** `@restormel/contracts` dependency.
- **Reasoning extensions** depend on **`@restormel/contracts`** (including `reasoning-object`).
- **Semver is independent** — bump extensions for compare/eval/diff changes without forcing a graph-core major.

## Consumer entrypoints

Same as npm `exports`: `/compare`, `/diff`, `/evaluation`, `/lineage`, `/projection`, `/summary`.

## Related

- [Restormel Graph — SOPHIA extraction artefacts](./04-delivery/restormel-graph-sophia-extraction-artifacts.md)
- [Phase 1 extraction status](./PHASE1-EXTRACTION-STATUS.md)
