# Phase 2 extraction — context packs (SOPHIA ↔ Restormel)

**Package:** **`@restormel/context-packs`** on npm ([package](https://www.npmjs.com/package/@restormel/context-packs), `^0.1.0`). Pass-specific context pack assembly for dialectical / multi-pass reasoning over a **graph-shaped retrieval result** — no SurrealDB or engine in the library.

**SOPHIA consumer integration:** **Complete**

- Root dependency: `@restormel/context-packs` in `package.json`.
- Re-export: [`src/lib/server/contextPacks.ts`](../../src/lib/server/contextPacks.ts) → npm (types + `buildPassSpecificContextPacks`).
- Adapter: [`src/lib/server/contextPackRetrieval.ts`](../../src/lib/server/contextPackRetrieval.ts) — `contextPackInputFromRetrieval` maps `RetrievalResult` → `ContextPackRetrievalInput` (normalises `conclusion_text` null → undefined).
- Engine: [`src/lib/server/engine.ts`](../../src/lib/server/engine.ts) calls `buildPassSpecificContextPacks(contextPackInputFromRetrieval(retrievalResult), …)`.
- Tests: [`src/lib/server/contextPacks.test.ts`](../../src/lib/server/contextPacks.test.ts).

**Related public docs (graph + reasoning stack, not context-packs internals):** [restormel.dev/graph/docs](https://restormel.dev/graph/docs) — Contract v0, `@restormel/ui-graph-svelte`, `@restormel/graph-reasoning-extensions`, `@restormel/contracts`. Context packs are a **separate** npm package (retrieval-shaped input → LLM text blocks).

## Doc index

| Document | Purpose |
|----------|---------|
| [phase2-context-packs-extraction-scope.md](./phase2-context-packs-extraction-scope.md) | API surface, parity tests, non-goals |
| [phase2-agent-prompt-restormel-engineering.md](./phase2-agent-prompt-restormel-engineering.md) | Historical Restormel agent prompt (publish already done) |
