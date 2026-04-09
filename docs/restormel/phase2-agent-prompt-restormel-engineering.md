# Agent prompt — `@restormel/context-packs` (Phase 2 extraction)

Copy everything below the line into your Restormel Keys / platform agent or ticket.

---

You are implementing **`@restormel/context-packs`** in the **Restormel Keys** monorepo: a **pure**, **dependency-light** library that turns a **minimal graph-shaped retrieval payload** into three **pass-specific text blocks** (analysis, critique, synthesis) plus **diagnostic stats** for token budgets, role mix, reply chains, and unresolved tensions.

SOPHIA today implements this in `src/lib/server/contextPacks.ts` and will **consume your npm package** once published. Treat the SOPHIA files listed below as the **behavioural spec** (logic and tests), not as code to import at runtime.

## Objectives

1. **Implement** `buildPassSpecificContextPacks(input, options?)` with **identical behaviour** to SOPHIA’s current function: same scoring, relation prioritisation, argument pick heuristics, token estimation (`ceil(length/4)`), truncation loop, empty-pack copy, and synthesis “signals” section.
2. **Input type** must be **`ContextPackRetrievalInput` only** — structurally the same as SOPHIA `src/lib/server/contextPackRetrieval.ts`:
   - `ContextPackClaim`: `id`, `text`, `claim_type`, `source_title`, optional `confidence`
   - `ContextPackRelation`: `from_index`, `to_index`, `relation_type`
   - `ContextPackArgument`: `name`, `tradition`, `summary`, optional `key_premises`, optional `conclusion_text` (used for scoring)
   - `seed_claim_ids: string[]`
3. **Exports** (names stable for consumers):
   - `buildPassSpecificContextPacks`
   - `ContextPackPass`, `ContextPackRole`, `ContextPackStats`, `ContextPack`, `PassSpecificContextPacks`
   - `ContextPackRetrievalInput`, `ContextPackClaim`, `ContextPackRelation`, `ContextPackArgument`
4. **Options:** `depthMode?: 'quick' | 'standard' | 'deep'` with token budgets exactly as in SOPHIA (`quick` / `standard` / `deep` tables for each pass).
5. **Tests:** Port **`src/lib/server/contextPacks.test.ts`** from SOPHIA into the package; CI must run them on every PR touching the package.

## Documentation requirements (ship before first publish)

| Deliverable | Content |
|-------------|---------|
| **README.md** | Problem statement; minimal code example; input/output types; note that **SOPHIA** maps full `RetrievalResult` via `contextPackInputFromRetrieval` (reference path only). |
| **CHANGELOG.md** | Semver policy; classify token budget / output format changes explicitly. |
| **package.json `exports`** | Document supported import paths; ESM + types. |
| **TSDoc** on public API | Especially `ContextPackStats` fields (`reply_chain_count`, `unresolved_tension_count`, `role_counts`, etc.). |
| **Release notes** | Version, breaking vs additive changes, link to SOPHIA Phase 2 doc for integrators. |

**OpenAPI:** not applicable (library only). If you add a **Cloud API** later that returns packs, that API must be documented in Restormel Keys OpenAPI separately (**upstream-first** for Sophia).

## Acceptance criteria

- `pnpm test` (or repo equivalent) in Keys passes for the new package.
- Dropping the SOPHIA test file’s fixture JSON into a Keys test produces **the same** assertions as SOPHIA `contextPacks.test.ts` (claim counts, role inequalities, tension stats, `CLAIM [c:001]` substring, token cap under `quick` depth).
- **No imports** from SOPHIA, Surreal, or `@restormel/contracts` in v0.
- Package is safe for **browser bundling** (no Node-only APIs).

## Non-goals

- Do not port `retrieval.ts`, `engine.ts`, or SSE handlers.
- Do not add Zod unless you need it for **external** API validation; internal types can stay TypeScript-only.
- Do not merge this package into `@restormel/graph-reasoning-extensions` — keep context packing **separate** from reasoning-object compare/eval.

## Reference (SOPHIA — read-only spec)

| File | Role |
|------|------|
| `src/lib/server/contextPacks.ts` | Full implementation to mirror |
| `src/lib/server/contextPackRetrieval.ts` | Portable input types + `contextPackInputFromRetrieval` (SOPHIA keeps this adapter; **optional** to duplicate as docs-only in Keys) |
| `src/lib/server/contextPacks.test.ts` | Parity tests to port |
| `docs/restormel/phase2-context-packs-extraction-scope.md` | Scope + doc checklist |
| `docs/restormel/PHASE2-EXTRACTION-STATUS.md` | Status / integration steps |

## Deliverable summary for PR

- New package under `packages/context-packs` (or agreed path).
- README + CHANGELOG + tests green.
- First npm version (e.g. `0.1.0`) with release note; communicate version to SOPHIA for `package.json` bump.

---

_End of prompt._
