---
status: reference
owner: adam
source_of_truth: false
last_reviewed: 2026-03-13
---

> Supporting schema reference only. Use docs/sophia/architecture.md for the live architecture summary.

# SOPHIA — Argument Graph Schema

## Why a Graph, Not a Vector Store?

Standard RAG (Retrieval-Augmented Generation) stores source text as chunks and retrieves by semantic similarity. For philosophical reasoning, this has a fundamental limitation: the most semantically similar chunk to "utilitarian objections" is likely another utilitarian argument — not the deontological objection to it.

Philosophical reasoning requires *argumentative structure*: thesis + objection + reply. A flat vector store does not preserve this. SOPHIA stores knowledge as a typed graph where claims are nodes and logical relations are edges, enabling retrieval of complete argumentative chains.

## Database: SurrealDB v2

SurrealDB is used because it supports:
- **Graph queries**: multi-hop traversal via typed edges
- **Vector search**: embedding similarity in the same query path
- **Document storage**: structured fields with schema enforcement
- **Single query path**: no need to join results from separate databases

## Tables

### `source`

Represents a single philosophical source text.

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Source title |
| `author` | array\<string\> | Author name(s) |
| `year` | int? | Publication year |
| `source_type` | enum | `book`, `paper`, `sep_entry`, `iep_entry`, `article`, `institutional` |
| `url` | string? | Original URL |
| `ingested_at` | datetime | When ingested (auto) |
| `claim_count` | int? | Number of claims extracted |
| `status` | enum | `pending`, `ingested`, `validated`, `quarantined` |

### `claim`

The atomic unit of philosophical knowledge.

| Field | Type | Description |
|-------|------|-------------|
| `text` | string | The claim in natural language |
| `claim_type` | enum | `thesis`, `premise`, `objection`, `response`, `definition`, `thought_experiment`, `empirical`, `methodological` |
| `domain` | enum | Philosophical domain (e.g., `ethics`, `epistemology`) |
| `source` | record\<source\> | The source this claim was extracted from |
| `position_in_source` | int | Ordinal position within source (for provenance) |
| `confidence` | float | Extraction confidence (0–1) from Claude |
| `gemini_validated` | bool | Whether Gemini cross-validation passed |
| `embedding` | array\<float\> | Voyage AI embedding vector |

### `relation`

A typed logical relation between two claims.

| Field | Type | Description |
|-------|------|-------------|
| `from` | record\<claim\> | Source claim |
| `to` | record\<claim\> | Target claim |
| `relation_type` | enum | See relation types below |
| `strength` | enum? | `strong`, `moderate`, `weak` |
| `note` | string? | Explanation of the relation |

**Relation types:**

| Type | Meaning |
|------|---------|
| `supports` | The `from` claim provides evidence for or strengthens `to` |
| `contradicts` | The `from` claim is logically incompatible with `to` |
| `responds_to` | The `from` claim is a direct reply to an objection in `to` |
| `depends_on` | The `from` claim logically requires `to` to be true |
| `part_of` | The `from` claim is a component premise of argument `to` |
| `exemplifies` | The `from` claim is a concrete example of the abstract `to` |

### `argument`

A named philosophical argument — a cluster of claims with a conclusion.

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Argument name (e.g., "The Utility Monster Objection") |
| `tradition` | string? | Philosophical tradition (e.g., "Utilitarian") |
| `domain` | enum | Philosophical domain |
| `summary` | string | 1–2 sentence summary |
| `conclusion` | string | The conclusion claim text |
| `key_premises` | array\<string\> | Premise claim IDs |

## SurrealQL Examples

### Vector search for semantically similar claims

```sql
SELECT id, text, claim_type, source.title, confidence
FROM claim
WHERE embedding <|10,COSINE|> $query_embedding
ORDER BY embedding <|10,COSINE|> $query_embedding
```

### Graph traversal from a seed claim

```sql
-- Find claims that contradict or respond_to any of the seed claims
SELECT
  out.id AS id,
  out.text AS text,
  relation_type,
  out.claim_type AS claim_type
FROM relation
WHERE in IN $seed_claim_ids
  AND relation_type IN ['contradicts', 'responds_to', 'supports']
FETCH out
```

### Retrieve argument structure for a set of claims

```sql
SELECT
  id, name, tradition, domain, summary, conclusion, key_premises
FROM argument
WHERE key_premises CONTAINSANY $claim_ids
```

### Full retrieval pipeline (simplified)

```sql
-- 1. Vector search
LET $seeds = (
  SELECT id FROM claim
  WHERE embedding <|10,COSINE|> $query_embedding
);

-- 2. Graph expansion
LET $related = (
  SELECT out.id AS id FROM relation
  WHERE in IN $seeds.id
  FETCH out
);

-- 3. Fetch claims and their arguments
SELECT
  id, text, claim_type, domain,
  source.title AS source_title,
  source.author AS source_author,
  confidence
FROM claim
WHERE id IN array::union($seeds.id, $related.id);
```

## Retrieval Result Shape

The `RetrievalResult` returned to the engine:

```typescript
interface RetrievalResult {
  claims: RetrievedClaim[];       // Ordered by relevance
  relations: RetrievedRelation[]; // Edges between the returned claims
  arguments: RetrievedArgument[]; // Argument structures containing the claims
}
```

This is formatted into a natural language context block injected into each LLM prompt:

```
[PHILOSOPHICAL KNOWLEDGE BASE CONTEXT]
(5 claims, 3 relations, 2 arguments retrieved)

CLAIMS:
[C1] "Maximising aggregate utility can justify harming innocent individuals"
     Type: objection | Domain: ethics | Source: SEP Utilitarianism | Confidence: 0.94
...

RELATIONS:
[C2] contradicts [C1]: "Rights function as side-constraints, not as utilities to be summed"
...

ARGUMENTS:
[A1] The Rights Objection to Utilitarianism (Deontological)
     Conclusion: Utility maximisation cannot override individual rights
     Key premises: C2, C3, C4
```

## Schema Setup

```bash
# Create all tables and indexes (idempotent — safe to re-run)
pnpm tsx scripts/setup-schema.ts
```
