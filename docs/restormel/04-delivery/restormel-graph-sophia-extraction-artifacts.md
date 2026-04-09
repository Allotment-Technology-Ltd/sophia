# Restormel Graph — SOPHIA extraction artefacts

Prepared for lifting the SOPHIA graph + visualisation stack into a standalone **Restormel Graph** module. This document is intended to be sufficient for another agent to implement `packages/graph-core` + `packages/ui-graph-svelte` in the Restormel monorepo without reading all of SOPHIA.

**Repo state note:** Portable render types live in the published package **`@restormel/graph-core/viewModel`** (`0.1.0+`). The Svelte canvas ships in **`@restormel/ui-graph-svelte`** (`GraphCanvas`, `NodeDetail`, `semanticStyles` exports). SOPHIA → `GraphData` uses **`graphDataFromSophiaGraphKit` only** (see § Integration contract).

**Sophia monorepo split (post–npm integration):**

| Package | Location |
|---------|----------|
| `@restormel/graph-core` | **npm** `0.1.0` — Contract v0 + `layout` / `trace` / `workspace` |
| `@restormel/ui-graph-svelte` | **npm** `0.1.0` — SVG canvas + styles (`styles.css` imported in `src/app.css`) |
| `@restormel/graph-reasoning-extensions` | **npm** (`^0.1.0`) — `compare`, `lineage`, `projection`, `diff`, `evaluation`, `summary` (depends on `@restormel/contracts`; source in Restormel Keys) |

Reasoning-heavy imports use `@restormel/graph-reasoning-extensions/*`; render path uses `@restormel/graph-core` + `@restormel/ui-graph-svelte`.

**Phase 1 — trace + handoff:** emitter checklist [`phase1-run-trace-emitter-checklist.md`](../phase1-run-trace-emitter-checklist.md); **status index** [`PHASE1-EXTRACTION-STATUS.md`](../PHASE1-EXTRACTION-STATUS.md); **Restormel build spec** [`phase1-restormel-engineering-spec.md`](../phase1-restormel-engineering-spec.md); **copy-paste agent prompt** [`phase1-agent-prompt-restormel-engineering.md`](../phase1-agent-prompt-restormel-engineering.md).

**Phase 2 — context packs:** [`PHASE2-EXTRACTION-STATUS.md`](../PHASE2-EXTRACTION-STATUS.md), [`phase2-context-packs-extraction-scope.md`](../phase2-context-packs-extraction-scope.md), [`phase2-agent-prompt-restormel-engineering.md`](../phase2-agent-prompt-restormel-engineering.md) (portable input: `src/lib/server/contextPackRetrieval.ts`).

---

## graph-core v0 — frozen scope (Contract v0)

**Canonical doc (Restormel Keys repo):** `packages/graph-core/GRAPH_CORE_V0_SCOPE.md` and banner in published `viewModel.ts`.

### Contract v0 **includes** (Restormel Graph MVP DTOs)

| Item | Location |
|------|-----------|
| `GraphNode`, `GraphEdge`, `GraphGhostNode`, `GraphGhostEdge` | `viewModel.ts` |
| `GraphData` | `viewModel.ts` |
| `GraphViewportCommand`, `GraphRendererProps` | `viewModel.ts` |
| Semantic style DTOs for renderers | `viewModel.ts` |

**Rules:** no imports from SOPHIA or `@restormel/contracts`; types/interfaces only in this file; **do not change without platform review**.

### Contract v0 **excludes** (future extraction targets — **not** part of frozen DTO)

| Module | Dependency | Purpose |
|--------|------------|---------|
| `compare.ts` | `@restormel/contracts` | Reasoning snapshot compare |
| `lineage.ts` | `@restormel/contracts` | Lineage report / markdown |
| `projection.ts` | `@restormel/contracts` | Retrieval-like → snapshot |
| `diff.ts` | `@restormel/contracts` | Graph diff |
| `evaluation.ts` | `@restormel/contracts/reasoning-object` | Reasoning evaluation |
| `summary.ts` | `@restormel/contracts` | Snapshot summary |

These remain in the **same npm package** for SOPHIA compatibility but **must not** be pulled into a minimal Restormel Graph renderer that only implements Contract v0.

### Co-located render helpers (not Contract v0 file; **zero `contracts` today**)

`layout.ts`, `trace.ts` (label formatting), `workspace.ts` — required by `GraphCanvas` for layout and UI helpers until moved to `ui-graph-svelte` or a render subpackage.

---

## Integration contract (SOPHIA ↔ Restormel Graph v0)

**Single supported crossing** from SOPHIA Graph Kit state into portable graph data:

```ts
// src/lib/graph-kit/adapters/sophiaGraphData.ts
export function graphDataFromSophiaGraphKit(graph: GraphKitGraphViewModel): GraphData;
```

- **Public consumers** (e.g. `GraphWorkspace`) should call **`graphDataFromSophiaGraphKit`** only.
- **`adaptGraphViewModelToLegacyCanvas`** is **`@internal`** — implementation detail; do not use from new code.
- **Renderers** accept **`GraphData`** (and optional semantic style maps keyed by node id / edge key), not `GraphKitGraphViewModel`, not raw contracts snapshots, not SOPHIA stores.

---

## Portability proof (in-repo)

| Item | Location |
|------|-----------|
| Mock `GraphData` + `GraphCanvas` only (no adapter, no stores) | `src/routes/dev/graph-portability/+page.svelte` |

**Manual QA:** open `/dev/graph-portability` — confirm zoom, pan, wheel zoom, node click / keyboard selection match product canvas behaviour.

---

## Non-MVP modules (contracts-coupled — Sophia workspace package)

SOPHIA consumes **`@restormel/graph-reasoning-extensions`** from npm: **`compare`**, **`diff`**, **`evaluation`**, **`lineage`**, **`projection`**, **`summary`**.

**Not required** for: rendering, pan/zoom, selection, orbital layout, or `GraphCanvas` / `NodeDetail` from `@restormel/ui-graph-svelte`.

---

## A. File map (complete)

### A.1 Interactive canvas (`@restormel/ui-graph-svelte`)

| Source | Role |
|--------|------|
| npm `@restormel/ui-graph-svelte` → `GraphCanvas`, `NodeDetail` | Same SVG canvas as former `src/lib/components/visualization/*` (removed from SOPHIA tree) |
| `graphCanvasEdgeKey` + semantic style types | Imported from `@restormel/ui-graph-svelte` (e.g. `graphSemantics.ts`) |
| `src/app.css` | `@import '@restormel/ui-graph-svelte/styles.css'` for canvas token fallbacks / parity |

### A.2 Graph Kit workspace (SOPHIA product shell; partial extraction)

| Path | Role |
|------|------|
| `src/lib/graph-kit/types.ts` | GraphKit node/edge/workspace/scenario types (reasoning-object aligned) |
| `src/lib/graph-kit/rendering/graphSemantics.ts` | GraphKit → semantic style maps for canvas |
| `src/lib/graph-kit/components/GraphWorkspace.svelte` | Toolbar + canvas + inspector + trace panel orchestration |
| `src/lib/graph-kit/components/GraphWorkspaceToolbar.svelte` | Search, filters, viewport actions |
| `src/lib/graph-kit/components/GraphWorkspaceInspector.svelte` | Node/workspace inspector |
| `src/lib/graph-kit/components/GraphWorkspaceTracePanel.svelte` | Trace playback UI |
| `src/lib/graph-kit/components/GraphComparePanel.svelte` | Baseline vs current compare |
| `src/lib/graph-kit/components/ReasoningLineagePanel.svelte` | Lineage markdown panel |
| `src/lib/graph-kit/components/primitives/*.svelte` | EvidenceCard, CitationChip, SourceBadge, ValidationNote |

### A.3 Graph Kit state (logic; stays in core or moves to `graph-core` extensions)

| Path | Role |
|------|------|
| `src/lib/graph-kit/state/query.ts` | Filter workspace graph by search/phase/kinds/ghosts |
| `src/lib/graph-kit/state/focus.ts` | Neighborhood scope, isolate-to-scope |
| `src/lib/graph-kit/state/trace.ts` | Trace path focus, stepping |
| `src/lib/graph-kit/state/workspace.ts` | Focus summary, readability warnings, kind toggles |
| `src/lib/graph-kit/state/compare.ts` | Workspace compare payloads |
| `src/lib/graph-kit/state/workspace.test.ts` | Unit tests |

### A.4 SOPHIA adapters (MUST stay consumer-side or become `graph-adapters-sophia`)

| Path | Role |
|------|------|
| `src/lib/graph-kit/adapters/legacyCanvasAdapter.ts` | **`@internal`** — implements `GraphKitGraphViewModel` → `GraphData`; use `graphDataFromSophiaGraphKit` only |
| `src/lib/graph-kit/adapters/sophiaGraphData.ts` | **Integration entry:** `graphDataFromSophiaGraphKit` → `GraphData` |
| `src/lib/graph-kit/adapters/sophiaWorkspaceBuilder.ts` | Session/cache → workspace bundle |
| `src/lib/graph-kit/adapters/sophiaGraphAdapter.ts` | Snapshot → graph kit (older path) |
| `src/lib/graph-kit/adapters/sophiaReasoningObjectAdapter.ts` | Reasoning object → graph / meta |
| `src/lib/graph-kit/adapters/reasoningObjectGraphAdapter.ts` | Reasoning-object graph wiring |
| `src/lib/graph-kit/adapters/sophiaReasoningObjectAdapter.test.ts` | Tests |

### A.5 Graph packages (split: npm MVP vs Sophia reasoning extensions)

**npm `@restormel/graph-core` (e.g. `0.1.0`):** `viewModel`, `layout`, `trace`, `workspace` — no `contracts` dependency.

**npm `@restormel/ui-graph-svelte`:** `GraphCanvas`, `NodeDetail`, semantic style helpers, `styles.css`.

**npm `@restormel/graph-reasoning-extensions`:** `compare`, `diff`, `evaluation`, `lineage`, `projection`, `summary`. Consumer smoke test: [`src/lib/restormel/graph-reasoning-extensions-smoke.test.ts`](../../src/lib/restormel/graph-reasoning-extensions-smoke.test.ts).

### A.6 SOPHIA stores & server graph plumbing

| Path | Role |
|------|------|
| `src/lib/stores/graph.svelte.ts` | Live graph snapshot + meta for UI |
| `src/lib/server/graphProjection.ts` | Server-side graph projection helpers |
| `src/lib/server/graphProjection.test.ts` | Tests |
| `src/lib/utils/graphTrace.ts` | Client trace utilities |
| `src/lib/utils/graphTrace.test.ts` | Tests |
| `src/lib/utils/sseHandler.ts` | SSE may feed graph store (coupled) |

### A.7 Routes & panels

| Path | Role |
|------|------|
| `src/lib/components/panel/MapTab.svelte` | Embeds `GraphWorkspace` |
| `src/routes/map/workspace/+page.svelte` | Full-page workspace |
| `src/routes/map/+page.svelte` | Map entry |
| `src/routes/help/graph-filters/+page.svelte` | Help |
| `src/routes/dev/graph-portability/+page.svelte` | **Contract v0 portability smoke** (mock `GraphData`, no adapter) |

### A.8 Docs & scripts (reference only)

| Path | Role |
|------|------|
| `docs/restormel/03-product/*graph*` | Product/spec notes |
| `docs/archive/product/graph-visualization-implementation.md` | Historical |
| `scripts/*graph*`, `data/thinker-graph/*` | Non-runtime |

### A.9 Other packages named “graph”

| Path | Role |
|------|------|
| `packages/graphrag-core/` | Separate GraphRAG product slice — **not** the interactive canvas |

---

## B. Classification table (representative)

| Path | Class | Notes |
|------|-------|--------|
| `graph-core/viewModel.ts` | **DIFFERENTIATED** | Neutral graph DTOs for any host |
| `graph-core/layout.ts` | **DIFFERENTIATED** | Domain layout algorithm (source ring / claim placement) |
| `graph-core/workspace.ts` | **DIFFERENTIATED** | Graph workspace algebra (filter/scope) |
| `graph-core/compare/diff/evaluation/lineage/projection` | **DIFFERENTIATED** | Reasoning analytics (still contracts-coupled today) |
| `GraphCanvas.svelte`, `NodeDetail.svelte` | **ADJACENT** | Renderer + interaction |
| `semanticStyles.ts` | **ADJACENT** | Presentation tokens keyed by id/edge key |
| `graphSemantics.ts` | **ADJACENT** (hosts GraphKit coupling) | Maps kit kinds → styles |
| `GraphWorkspace*.svelte`, primitives | **ADJACENT** | Product chrome |
| `legacyCanvasAdapter`, `sophiaWorkspaceBuilder`, etc. | **ADJACENT** (SOPHIA) | Consumer adapters |
| `graph.svelte.ts`, `sseHandler.ts` | **ADJACENT** (SOPHIA) | App wiring |
| `formatTraceTag`, string helpers | **COMMODITY** | Small pure functions |

---

## C. Coupling analysis

| Dependency | Label | Mitigation |
|------------|-------|------------|
| `GraphCanvas` → `@restormel/graph-core/viewModel` | **SAFE** | Portable boundary (done) |
| `GraphCanvas` / `graphSemantics` → `@restormel/ui-graph-svelte` semantic exports | **DONE** | Shipped in npm ui package |
| `graphSemantics` → GraphKit types + SOPHIA CSS vars | **ADAPTER REQUIRED** | Keep in SOPHIA or ship `graph-kit-semantics` theme hook |
| `graph-core/compare|diff|lineage|projection|...` → `@restormel/contracts` | **ADAPTER REQUIRED** | Split “render core” vs “reasoning contracts core” in Restormel |
| `graphStore` / conversation / references | **MUST DECOUPLE** | Remain in SOPHIA; only `GraphData` crosses boundary |
| `GraphWorkspace` → `$app/navigation` | **MUST DECOUPLE** | Inject `onNavigate` / links from host |
| Server `graphProjection` | **SAFE** (server-only) | Optional duplicate in Restormel ingest |

---

## D. Extraction boundaries

### `packages/graph-core` (platform)

**Contract v0 (frozen):** `viewModel.ts` only — see `GRAPH_CORE_V0_SCOPE.md`.

**Same package, non-v0 (contracts-coupled):** compare, diff, evaluation, lineage, projection, summary — **deferred**; do not conflate with Contract v0.

**Render co-ship (no contracts import):** `layout.ts`, `trace.ts`, `workspace.ts`.

**Refactors:**

- Long term: split `graph-render-core` (viewModel + layout + trace + workspace) vs `graph-reasoning-core` (contracts modules).
- Short term: single package; document v0 vs non-v0 as above.

### `packages/ui-graph-svelte` (new in Restormel)

**Move from SOPHIA:**

- `GraphCanvas.svelte`, `NodeDetail.svelte`, `semanticStyles.ts`

**Peer deps:** `svelte@^5`, `@restormel/graph-core` (viewModel + layout + trace as needed).

**Refactors:**

- Replace `$lib/...` with package-relative imports.
- Accept CSS variables from host (`--color-*`) or ship a minimal theme layer.

**Do not move yet (product):**

- Entire `graph-kit/components` except optionally shared primitives — those belong to “Stoa/SOPHIA workspace chrome” until Restormel defines its own shell.

---

## E. Interfaces (authoritative source)

**Source of truth:** `packages/graph-core/src/viewModel.ts`

Exports include:

- `GraphNode`, `GraphEdge`, `GraphGhostNode`, `GraphGhostEdge`
- `GraphData` (`nodes`, `edges`, `ghostNodes`, `ghostEdges`)
- `GraphViewportCommand`, `GraphRendererProps`
- `GraphNodeSemanticStyle`, `GraphEdgeSemanticStyle`
- Phase/kind enums (`GraphPhase`, `GraphArcKind`, …)

---

## F. Adapter (SOPHIA) — locked boundary

**Only public integration:** `graphDataFromSophiaGraphKit` in `sophiaGraphData.ts`.

**Internal:** `adaptGraphViewModelToLegacyCanvas` — not for new call sites.

```ts
import { graphDataFromSophiaGraphKit } from '$lib/graph-kit/adapters/sophiaGraphData';
const data = graphDataFromSophiaGraphKit(workspace.graph);
// GraphCanvas: nodes={data.nodes} edges={data.edges} ghostNodes={data.ghostNodes} ghostEdges={data.ghostEdges}
```

Restormel hosts implement **their** adapter → `GraphData`; they do not import this function.

---

## G. Refactored component examples

**GraphCanvas / NodeDetail** — imports switched from `@restormel/contracts/api` to `@restormel/graph-core/viewModel` so the renderer does not depend on the API package’s graph Zod schemas.

**Optional further cleanup (non-blocking):**

```svelte
<!-- GraphWorkspace.svelte: could bundle once -->
<script>
  import { graphDataFromSophiaGraphKit } from '$lib/graph-kit/adapters/sophiaGraphData';
  const data = $derived(graphDataFromSophiaGraphKit(workspaceView.graph));
</script>
<GraphCanvas nodes={data.nodes} edges={data.edges} ... />
```

---

## H. Step-by-step extraction plan (for Restormel agent)

1. **Create** `packages/ui-graph-svelte` with `svelte` peerDep and dependency on `@restormel/graph-core`.
2. **Copy** `GraphCanvas.svelte`, `NodeDetail.svelte`, `semanticStyles.ts` into `ui-graph-svelte/src`, fix import paths to `@restormel/graph-core/viewModel` and `@restormel/graph-core/layout` / `trace`.
3. **Run** visual regression / manual checklist: pan, zoom, wheel, node select, edge hover, ghost toggle, fit/reset, path highlight, dim-out-of-scope.
4. **Port tests** — any Vitest targeting layout/trace already in `graph-core`; add component tests in Restormel if desired (Playwright/Storybook).
5. **Split graph-core** (optional hardening) — extract `viewModel.ts` + `layout.ts` + `trace.ts` + `workspace.ts` into `@restormel/graph-render-core` with zero `contracts` dependency; leave compare/lineage/projection on contracts.
6. **SOPHIA** — swap imports from `$lib/components/visualization/GraphCanvas` to `@restormel/ui-graph-svelte` once package published (or workspace link).
7. **Document** CSS variable contract required by canvas (`--color-bg`, `--color-text`, `--color-border`, edge colours, etc.) in ui package README.

---

## Functional parity checklist

| Area | Expected |
|------|-----------|
| Node positions | `computeLayout` unchanged algorithm |
| Zoom/pan/wheel | Unchanged logic |
| Selection / keyboard | Unchanged |
| Ghost layer | Same data shape via `GraphGhost*` |
| Semantic styling | Still from `graphSemantics` + `semanticStyles` keys |
| Workspace chrome | Unchanged (SOPHIA) |

**Re-validation:** `pnpm check`; `pnpm vitest run src/lib/restormel/graph-reasoning-extensions-smoke.test.ts`; manual `/dev/graph-portability` and map workspace for zoom/pan/wheel/select. No “expansion/collapse” tree control in `GraphCanvas` (N/A).

**Known non-goals:** Moving Svelte files into `ui-graph-svelte` (mechanical follow-up). Non-v0 `graph-core` modules remain contracts-coupled and are **out of Contract v0**.

---

## Related code pointers

- Contract v0: npm `@restormel/graph-core/viewModel` (see Restormel Keys `GRAPH_CORE_V0_SCOPE.md`)
- SOPHIA adapter: `src/lib/graph-kit/adapters/sophiaGraphData.ts` (public), `legacyCanvasAdapter.ts` (internal)
- Canvas: npm `@restormel/ui-graph-svelte`
- Reasoning extensions: npm `@restormel/graph-reasoning-extensions`
- Portability dev route: `src/routes/dev/graph-portability/+page.svelte`
