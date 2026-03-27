# SurrealDB posture decision (benchmark checklist)

After **Neon staging** holds full ingestion artifacts, SurrealDB remains the graph/query surface until data proves otherwise.

## When to benchmark

- **Scale**: ≥ 50–100 active sources or measurable p95 latency on graph-heavy operator queries.
- **Reliability**: track unexpected SurrealDB restarts, index rebuilds, or data loss incidents on the self-hosted VM.

## Scenarios to measure

1. **Multi-hop graph reads** used in production (replace with concrete query names from your Surreal schema).
2. **Vector + graph hybrid** queries if used alongside embeddings in Surreal.
3. **Ingest Stage 6** duration and failure rate (Surreal write path).
4. **Operational cost**: VM + backup + engineer time vs managed Postgres (Neon) only.

## Decision matrix

| Outcome | Action |
|---------|--------|
| Surreal stable, latency acceptable | Keep Surreal as query engine; Neon holds durability + orchestration. |
| Reliability or latency unacceptable | Plan Postgres graph model (`pgvector` + recursive CTEs / `ltree`) and incremental migration from Neon staging. |

## Artifacts

Record results (date, version, dataset size, query, p50/p95, notes) in your ops log or runbook; link from release notes when the decision is made.
