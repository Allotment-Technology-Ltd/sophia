# GPU / self-hosted inference — evidence review (template)

**When to fill this in:** after 2–4 weeks of production or benchmark metrics following scale work (global concurrency, phase gates, SEP bulk runs).

## Metrics to capture

- **Cost:** USD per 1M input/output tokens by provider (Vertex vs alternatives).
- **Latency:** p50 / p95 for extraction, relations, validation, embedding stages.
- **Reliability:** rate of 429 / `RESOURCE_EXHAUSTED`, retries, and failed job items.

## Decision

| Option | When it wins |
|--------|----------------|
| Stay on managed APIs (Vertex, OpenAI, …) | Quotas sufficient; cost acceptable; ops simplicity preferred. |
| Self-hosted GPU (vLLM, TEI, …) | Sustained volume where BYOK + dedicated inference beats managed **and** team can operate serving. |

## Outcome (fill after review)

- **Decision:**
- **Owner / date:**
- **Links:** benchmarks, dashboards, related PRs.

See also [ingestion-credits-and-workers.md](./ingestion-credits-and-workers.md) (GPU section).
