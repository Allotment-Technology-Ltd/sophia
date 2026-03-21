# Generic Restormel route starter kit (multi-product)

This document defines a **portable convention** for naming and grouping Restormel **routes** so teams can import a starter set once and reuse it across apps (SOPHIA, other clients, internal tools). Product names stay **out** of route IDs; each app maps its own flows to these capabilities via **configuration**.

## Vocabulary (Restormel Keys)

| Term | What it is |
|------|----------------|
| **Route** | Named bundle of **steps** (ordered provider/model candidates + failover behaviour). This is the closest thing to a user-facing “bundle.” |
| **Step** | One primary (and optional fallback) model path on that route. |
| **Policy** | Project/environment rules (budget, caps, allowlists) evaluated when resolving or listing models—not the route JSON itself, but **paired** with routes. |
| **Environment** | e.g. `production` / `staging`—isolates the same logical routes under different caps and keys. |

## Design principles

1. **Name by capability, not by product** — IDs should read like infrastructure: `llm_reason_primary`, not `sophia_analysis`.
2. **Stable, boring IDs** — `snake_case`, no version in the ID; use **separate routes** or **environments** for experiments (`llm_reason_primary_exp` in staging only).
3. **One route ≈ one job-to-model posture** — e.g. “primary reasoning” vs “cheap reasoning” vs “JSON repair” are different routes, not one mega-route with hidden branching.
4. **Orthogonal axes** — Separate **chat/reasoning** routes from **embedding** routes (different providers, policies, and often different keys).
5. **Apps map, Keys does not guess the app** — Your service reads `MYAPP_ANALYSIS_ROUTE_ID=llm_reason_primary`; Restormel stays agnostic.

## Canonical starter routes (suggested IDs)

Use these as a **template pack** to create routes in a fresh project. Model choices are **yours**; the ID expresses *intent*.

### LLM — multi-pass reasoning (any “think then answer” product)

| Route ID | Intended use | Typical posture |
|----------|----------------|-----------------|
| `llm_reason_primary` | First structured read of a prompt + context | Strong general model; balanced cost |
| `llm_reason_critique` | Second pass: challenge, find gaps, compare | Similar or slightly cheaper than primary; high token volume |
| `llm_reason_synthesize` | Final merge, tone, user-facing answer | Strongest allowed model in the bundle |
| `llm_reason_fast` | Low-latency / high-volume path | Flash/mini-class + aggressive failover |
| `llm_repair_json` | Fix malformed JSON / tool output | Small, fast model; tight timeouts |

### LLM — document / graph pipelines (ingestion, RAG prep, ETL)

| Route ID | Intended use | Typical posture |
|----------|----------------|-----------------|
| `ingest_extract` | Pull structured fields or claims from raw text/HTML | Strong extractor; long context if needed |
| `ingest_relate` | Infer links (support, contradiction, dependency, etc.) | Strong; may match or trail extract |
| `ingest_group` | Cluster or bucket intermediate objects | Often cheaper than extract |
| `ingest_validate` | Cross-check or score quality | **Different family** than extract when possible |
| `ingest_json_repair` | Normalize broken structured output before storage | Same family as `llm_repair_json` or shared route |

### Embeddings (non-chat)

| Route ID | Intended use | Typical posture |
|----------|----------------|-----------------|
| `embed_text_default` | Default semantic vectors | One primary embedding model + optional fallback |
| `embed_text_multilingual` | Mixed-language corpora | Separate route so policies and dims stay explicit |

### Optional — evaluation / governance

| Route ID | Intended use | Typical posture |
|----------|----------------|-----------------|
| `eval_judge` | Score, rubric, or second opinion on another model’s output | Strong reasoning; optional **different vendor** than generator |

**Total core pack:** 13 routes above cover most products without mentioning SOPHIA.

## How SOPHIA (or any app) attaches without renaming Keys

Keep Restormel generic. In **app config** (env, flags, Firestore doc):

```text
# Example — SOPHIA bespoke names point at generic routes
SOPHIA_ROUTE_ANALYSIS=llm_reason_primary
SOPHIA_ROUTE_CRITIQUE=llm_reason_critique
SOPHIA_ROUTE_SYNTHESIS=llm_reason_synthesize
SOPHIA_ROUTE_INGEST_EXTRACT=ingest_extract
# … etc.
```

Another product reuses the **same** `llm_reason_*` routes with different env vars. **No duplicate routes per product** unless policies truly differ—then use **environments** or a suffix like `_strict` / `_economy`.

## Aligning resolve calls (`workload` / `stage` / `task`)

When calling Restormel **resolve**, pass metadata that matches the **taxonomy** (helps observability and future policy scoping):

| Route ID prefix | Suggested `workload` | Suggested `stage` examples |
|-----------------|----------------------|----------------------------|
| `llm_reason_*` | `reasoning` | `primary`, `critique`, `synthesize`, `fast` |
| `ingest_*` | `ingestion` | `extract`, `relate`, `group`, `validate`, `json_repair` |
| `embed_*` | `embedding` | `text`, `multilingual` |
| `eval_*` | `evaluation` | `judge` |

Exact strings can match your Restormel **routing-capabilities** list; consistency matters more than the literal words.

## Policy “bundles” to ship alongside the route pack

Ship **three policy presets** (names illustrative) and attach them per environment:

1. **Economy** — Tight monthly/token caps; `llm_reason_fast` + cheap ingest steps allowed; block frontier models on high-volume stages.
2. **Standard** — Default production; balanced caps; full generic route set.
3. **Premium / research** — Higher caps; allow strongest models on `llm_reason_synthesize` and `ingest_validate`.

Policies to always define for each preset:

- Spend / **budget** caps (per env, per period).
- **Token or request** caps (especially critique + long-context ingest).
- **Allowed providers** (if you need single-vendor compliance).
- **Allowed models** or denylists (optional, if you expose a wide catalog).

## Making the pack “easy to grab”

1. **Document** this file + a one-page table of route IDs (this doc).
2. **Export** from a golden Restormel project (JSON/API dump) or maintain **Infrastructure-as-code** that creates routes + steps.
3. **Publish** a versioned **“Restormel generic route pack v1”** artifact (zip/ repo submodule) that operators import into a new project, then only tune models inside steps.
4. **Do not** rename routes per customer; clone **environment** or **project** if isolation is required.

## Summary

- **Bundles in Keys language = routes (+ their steps), with policies applied at the environment.**
- **Generic multi-purpose naming = capability-based `snake_case` IDs** (`llm_reason_primary`, `ingest_extract`, …).
- **Products integrate via a thin mapping layer** (env/config), so the same Keys project serves many contexts with predictable behaviour.
