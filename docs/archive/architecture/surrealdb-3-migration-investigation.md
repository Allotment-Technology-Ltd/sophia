---
status: archived
owner: adam
source_of_truth: false
last_reviewed: 2026-03-13
---

> Archived during the 2026-03-13 documentation rationalisation. Retained for historical context.

# SurrealDB 3.0 Migration Investigation (SOPHIA)

_Date: March 12, 2026_

## Scope

Assess whether SOPHIA should migrate from SurrealDB 2.x to SurrealDB 3.x, with emphasis on practical benefits, migration cost, and delivery risk for the current architecture.

## Current Baseline (Repository Evidence)

- Runtime and scripts are currently aligned to SurrealDB 2.x semantics.
- `package.json` pins JS client dependency to `"surrealdb": "^2.0.0"`.
- SurrealQL usage in app and scripts has multiple `type::thing(...)` usages (18 references in `src/` + `scripts/`).
- Schema/index docs and setup scripts still declare `MTREE` vector index usage.
- Retrieval code includes a v2-specific workaround: KNN query in subquery first, then apply post-filters.

## Confirmed Upstream State (Official)

- SurrealDB 3.0.0 released on **July 31, 2025**.
- SurrealDB 3.0.1 released on **August 5, 2025** (includes `/sql` endpoint fixes).
- Official migration guidance states:
  - 3.x binaries cannot directly read 2.x storage layout.
  - Upgrade from 2.x requires migration workflow (diagnostics + export/import path).
  - For migration tooling, `surreal v2 export --v3` requires SurrealDB **3.0.3+**.

## Benefits for SOPHIA

### 1) Better Retrieval and Ingestion Throughput Headroom

Why it matters here:
- SOPHIA depends on vector + graph retrieval in hot paths and runs batch ingestion pipelines heavily.

3.x improvements relevant to this:
- New internal query planner/streaming execution in 3.0.
- Concurrent writes on HNSW vector index in 3.0.

Expected impact for SOPHIA:
- Better scaling margin as claim count and relation density rise.
- Lower risk of ingestion bottlenecks when nightly jobs and maintenance scripts overlap with user traffic.

### 2) Cleaner Future State for Vector Indexing

Why it matters here:
- Current schema still uses `MTREE` declarations in setup and maintenance scripts.

3.x direction:
- Migration docs flag MTREE deprecation path with conversion guidance in migration tooling.
- HNSW is the forward path and is where 3.0 write-concurrency improvements land.

Expected impact for SOPHIA:
- Align index strategy with the actively-optimized path instead of legacy semantics.
- Reduce future migration debt if vector workloads continue to grow.

### 3) New Transaction/API Surface for Control-Plane Work

Why it matters here:
- SOPHIA has review/promotion workflows, ingestion writes, and administrative operations that would benefit from stronger multi-step write semantics and API layering.

3.0 additions relevant to this:
- Client-side transaction support.
- `DEFINE API` stabilized.
- GraphQL support marked stable.

Expected impact for SOPHIA:
- Safer multi-record mutation paths in review and ingestion control-plane tooling.
- Optional simplification for external/internal API exposure strategies over time.

### 4) Opportunity to Remove v2-Specific Query Workarounds

Why it matters here:
- Retrieval currently documents a SurrealDB v2 KNN filtering limitation and compensates with subquery logic.

Potential 3.x gain:
- Query planner/runtime upgrades may allow simplification or better plans for these query shapes.

Expected impact for SOPHIA:
- Potential latency reduction and cleaner retrieval query code, pending benchmark confirmation.

## Migration Costs and Risks

### A) Breaking SurrealQL Changes Affect Existing Code

Observed repository exposure:
- `type::thing(...)` appears in runtime and script paths.

Official guidance:
- 2.x -> 3.x migration docs call out function-name changes and manual migration requirements for certain query patterns.

Risk:
- Direct upgrade without query audit/patching can break runtime and operational scripts.

### B) Storage Migration Is Mandatory

Official guidance:
- 3.x cannot directly open 2.x data directories.

Risk:
- Requires planned export/import migration runbook and rollback posture.

### C) Index and Query Semantics Need Revalidation

Observed repository exposure:
- MTREE declarations and v2-specific retrieval assumptions are embedded in code/docs.

Risk:
- Functional correctness may remain but performance and query plans can shift, requiring benchmark and acceptance gates before production cutover.

### D) Client Library Version Drift

Observed repository exposure:
- JS client currently pinned to major v2.

Risk:
- Server upgrade without coordinated client/runtime validation increases operational uncertainty.

## Recommendation

Proceed with migration to SurrealDB 3.x, but as a **controlled modernization stream**, not an in-place lift.

Rationale:
- Benefits are meaningful for SOPHIA’s trajectory (larger graph, heavier ingestion, stricter control-plane workflows).
- Current codebase has enough 2.x coupling that unmanaged migration would be fragile.

## Proposed Delivery Plan

### Phase 0: Compatibility Audit (1-2 days)

- Enumerate SurrealQL patterns that require migration edits (`type::thing`, index declarations, any deprecated syntax).
- Prepare automated codemod/checklist for query updates in `src/` and `scripts/`.

### Phase 1: Staging Migration Dry Run (1-2 days)

- Stand up SurrealDB `>= 3.0.3` staging instance.
- Execute official v2->v3 export/import migration path.
- Run schema setup and ingestion smoke tests.

### Phase 2: Code and Schema Adaptation (2-4 days)

- Update SurrealQL function usage where required by migration guide.
- Update vector index definitions toward 3.x-preferred form (HNSW path) and revalidate retrieval behavior.
- Bump and validate JS client compatibility.

### Phase 3: Benchmark and Acceptance Gate (1-2 days)

- Compare v2 vs v3 on:
  - retrieval p50/p95 latency,
  - ingestion throughput,
  - error rate,
  - retrieval quality parity (no regression in faithfulness/provenance checks).

### Phase 4: Production Cutover with Rollback (1 day)

- Freeze ingestion briefly.
- Execute migration runbook.
- Verify health checks, admin counts, retrieval correctness.
- Keep rollback snapshot/export available until post-cutover soak completes.

## Go/No-Go Criteria

Go only if all are true:
- No functional regressions in retrieval and review workflows.
- Ingestion throughput is neutral or improved.
- Runtime error rate is not worse than v2 baseline.
- Data integrity checks pass (source/claim/relation counts and spot-check traces).

## Bottom Line

Migrating to SurrealDB 3.x is likely net-positive for SOPHIA, especially for scaling and long-term maintainability, but only with an explicit migration workstream (query compatibility + data migration + benchmark gating). Immediate in-place upgrade is not advised.

## Sources

- SurrealDB Releases: https://surrealdb.com/releases
- SurrealDB 3.0 migration guide: https://surrealdb.com/docs/surrealdb/faqs/migrating-to-3_x
- SurrealDB upgrading docs (3.x): https://surrealdb.com/docs/surrealdb/installation/upgrading
