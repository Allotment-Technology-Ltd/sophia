# Phase 2 — Context packs extraction scope

**Status:** **`@restormel/context-packs`** is **published** on npm; SOPHIA consumes it via [`src/lib/server/contextPacks.ts`](../../src/lib/server/contextPacks.ts) and [`contextPackRetrieval.ts`](../../src/lib/server/contextPackRetrieval.ts).

**Intent (achieved):** **`buildPassSpecificContextPacks`** and its **public types** live in Restormel’s npm package so other apps can assemble **analysis / critique / synthesis** text blocks from a portable retrieval-shaped graph **without** importing SOPHIA’s `retrieval.ts` or Surreal drivers.

**Public graph / reasoning docs (companion, not the context-pack API):** [restormel.dev/graph/docs](https://restormel.dev/graph/docs) — Contract v0, canvas, reasoning extensions, contracts. Context packs are **not** part of the graph canvas; they sit between **retrieval results** and **LLM passes**.

---

## 1. Public API (minimum)

| Export | Description |
|--------|-------------|
| `buildPassSpecificContextPacks(input, options?)` | Returns `{ analysis, critique, synthesis }` packs with `block` + `stats`. |
| `ContextPack`, `PassSpecificContextPacks`, `ContextPackStats` | Output shapes (stable fields; additive semver). |
| `ContextPackPass`, `ContextPackRole` | Literal unions for passes and rhetorical roles. |
| Input types | `ContextPackRetrievalInput`, `ContextPackClaim`, `ContextPackRelation`, `ContextPackArgument` — **mirror** SOPHIA [`contextPackRetrieval.ts`](../../src/lib/server/contextPackRetrieval.ts). |

**Input contract:** The builder must accept **only** `ContextPackRetrievalInput` (claims, relations, arguments, `seed_claim_ids`). It must **not** depend on `RetrievalResult`, trace objects, thinker context, or degradation flags.

**Options:** `depthMode?: 'quick' | 'standard' | 'deep'` — token budgets must match SOPHIA behaviour (see implementation).

---

## 2. Behavioural parity

1. **Port tests** from SOPHIA [`contextPacks.test.ts`](../../src/lib/server/contextPacks.test.ts) into the Restormel package (same fixture data, same assertions on role counts, tension stats, token ceiling, block prefixes).
2. **Golden optional:** snapshot the three `block` strings for the standard fixture on first import; only update snapshots when behaviour change is intentional and documented.

---

## 3. Dependencies

- **Default:** **zero** dependency on `@restormel/contracts` (context packs are retrieval-graph + token budgeting only).
- **Peer:** none required for v0.
- **Runtime:** Node and browser-safe (no `fs`, no DB); pure functions only.

---

## 4. Documentation requirements (Restormel Keys)

Ship **before** or **with** first publish:

1. **`README.md`** — what the package does, `buildPassSpecificContextPacks` example, link to this SOPHIA scope doc or a copied “consumer contract” section.
2. **`CHANGELOG.md`** — semver rules; call out any change to token budgets or output string format as **minor** or **major** appropriately.
3. **Package `exports`** in `package.json` — explicit subpaths if you split `types` vs `index`; document the supported import paths (e.g. `@restormel/context-packs` only for v0).
4. **TypeDoc or TSDoc** on public functions and on each field of `ContextPackStats` (engine metadata and UI depend on these names).
5. **Release notes** — note compatibility with SOPHIA engine `onMetadata.context_pack_stats` field names (`analysis_tokens`, `critique_tokens`, etc.) — those are **SOPHIA-side** mappings today; the package only owns `ContextPackStats`.

---

## 5. Non-goals (Phase 2)

- No extraction of `engine.ts`, `retrieval.ts`, or SSE wiring.
- No new persisted schema version (unlike contracts trace schema).
- No LLM calls inside the package.
- No coupling to GraphCanvas / graph-core DTOs.

---

## 6. SOPHIA integration (post-publish)

1. Depend on published semver; delete in-repo duplicate implementation **or** keep a thin file that re-exports from npm for one release if needed.
2. Preserve **`contextPackInputFromRetrieval`** in SOPHIA to map `RetrievalResult` → `ContextPackRetrievalInput` (or move to `@restormel/context-packs/sophia` only if multiple consumers need it — default is **stay in SOPHIA** per upstream-first).

---

## 7. References

- [Restormel retrieval / GraphRAG producer note](./04-delivery/restormel-retrieval-graphrag-producer-note.md) (context-pack row).
- [Phase 1 extraction status](./PHASE1-EXTRACTION-STATUS.md) (Phase 2 pointer).
- [Phase 2 agent prompt](./phase2-agent-prompt-restormel-engineering.md).
