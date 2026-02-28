# SOPHIA Phase 3a: Ethics Knowledge Base Checklist

## Infrastructure
- [ ] SurrealDB running locally via Docker
- [ ] Schema created (run setup-schema.ts)
- [ ] Voyage AI API key obtained and configured
- [ ] Gemini API key obtained and configured

## Ingestion Pipeline
- [ ] Source fetcher script working (fetch-source.ts)
- [ ] Extraction prompt producing valid JSON
- [ ] Relation extraction prompt producing valid JSON
- [ ] Argument grouping prompt producing valid JSON
- [ ] Zod validation passing on all outputs
- [ ] Embedding generation working (Voyage AI)
- [ ] Gemini validation producing scored results
- [ ] Full pipeline (ingest.ts) runs end-to-end on one source
- [ ] SurrealDB correctly stores claims, relations, arguments with edges

## Wave 1 Ingestion (8 foundational sources)
- [ ] Source 1: SEP Utilitarianism — fetched & ingested
- [ ] Source 2: Mill Utilitarianism — fetched & ingested
- [ ] Source 3: Singer Famine/Affluence — fetched & ingested
- [ ] Source 4: SEP Deontological Ethics — fetched & ingested
- [ ] Source 5: Kant Groundwork — fetched & ingested
- [ ] Source 6: Ross Right and Good — fetched & ingested
- [ ] Source 7: SEP Virtue Ethics — fetched & ingested
- [ ] Source 8: Aristotle Nicomachean Ethics — fetched & ingested
- [ ] Manual review: spot-check 30+ claims from Wave 1 for accuracy
- [ ] Prompt adjustments based on Wave 1 review

## Wave 2 Ingestion (10 sources)
- [ ] Sources 9-18 ingested with updated prompts
- [ ] Spot-check 10% of claims
- [ ] Cross-source relations emerging in graph

## Wave 3 Ingestion (11 sources)
- [ ] Sources 19-29 ingested
- [ ] Full Gemini validation on all sources
- [ ] Quarantined items reviewed

## Retrieval Integration
- [ ] Argument-aware retrieval returning structured context
- [ ] Context block formatting correct
- [ ] Engine integration: graph context injected into all three passes
- [ ] Graceful degradation: engine works without SurrealDB

## Quality Gates (ALL must pass before Phase 3b)
- [ ] Extraction accuracy >80% (spot-checked claims are atomic, correctly typed)
- [ ] Relation accuracy >75% (spot-checked relations are genuine logical connections)
- [ ] Retrieval quality: 5 ethics queries return relevant graph context
- [ ] Three-pass improvement: with graph beats without on ≥6/10 test cases
- [ ] Cross-argument traversal: trolley problem retrieves Foot, DDE, utilitarian counterarguments

## Admin
- [ ] Admin dashboard showing knowledge base stats
- [ ] Source list visible with status

## Deployment
- [ ] SurrealDB accessible in production (Cloud Run or managed)
- [ ] New secrets in Secret Manager (Voyage, Gemini)
- [ ] Deploy.yml updated
