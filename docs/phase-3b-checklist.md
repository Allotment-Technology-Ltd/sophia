# SOPHIA Phase 3b: Checklist & Quality Gates

Continuation of ethics knowledge base expansion and production hardening. Reference: [phase-3b-roadmap.md](phase-3b-roadmap.md)

---

## Wave 2 Ingestion (10 sources)

### Source Fetching
- [ ] SEP Consequentialism — fetched & stored
- [ ] SEP Kantian Ethics — fetched & stored
- [ ] SEP Rights — fetched & stored
- [ ] Rawls: Theory of Justice (excerpts) — fetched & stored
- [ ] Nussbaum: Capabilities Approach — fetched & stored
- [ ] Sen: Development as Freedom — fetched & stored
- [ ] Foot: Virtues and Vices — fetched & stored
- [ ] Dennett: Freedom Evolves — fetched & stored
- [ ] Slote: Agent-Based Virtue Ethics — fetched & stored
- [ ] Korsgaard: Self-Constituting Agency — fetched & stored

### Ingestion Pipeline
- [ ] Batch ingestion script configured for Wave 2
- [ ] All 10 sources processed through extraction pass
- [ ] All 10 sources processed through relation extraction
- [ ] All 10 sources processed through argument grouping
- [ ] All 10 sources embedded with Voyage AI
- [ ] All 10 sources validated with Gemini
- [ ] All 10 sources persisted to SurrealDB

### Quality Validation
- [ ] Manual spot-check: 30+ claims from Wave 2 (accuracy > 80%)
- [ ] Manual spot-check: 15+ relations from Wave 2 (accuracy > 75%)
- [ ] Claim-to-relation ratio consistent with Wave 1
- [ ] Cross-wave relations emerging in graph (Wave 1 ↔ Wave 2 arguments)

---

## Wave 3 Ingestion (11 sources)

### Source Fetching
- [ ] SEP Applied Ethics — fetched & stored
- [ ] SEP Bioethics — fetched & stored
- [ ] SEP Environmental Ethics — fetched & stored
- [ ] Shue: Basic Rights — fetched & stored
- [ ] Williams: Ethics and the Limits of Philosophy — fetched & stored
- [ ] MacIntyre: After Virtue — fetched & stored
- [ ] Anscombe: Modern Moral Philosophy — fetched & stored
- [ ] Singer: Animal Liberation (excerpts) — fetched & stored
- [ ] Hooker: Ideal Code, Real World — fetched & stored
- [ ] Besson: The Principle of Subsidiarity — fetched & stored
- [ ] Gardiner: A Perfect Moral Storm — fetched & stored

### Ingestion Pipeline
- [ ] Batch ingestion script extended for Wave 3
- [ ] All 11 sources processed through full pipeline
- [ ] SurrealDB schema handles Wave 3 domains (applied ethics, bioethics, environmental)

### Quality Validation
- [ ] Manual spot-check: 30+ claims from Wave 3 (accuracy > 80%)
- [ ] Full Gemini validation on all Wave 3 sources
- [ ] Cross-wave relation analysis (all three waves interconnected)
- [ ] Quarantined/low-confidence items reviewed and triaged

---

## Advanced Retrieval & Reranking

### Dense Retrieval Setup
- [ ] Voyage AI embedding parameters optimized
- [ ] Vector similarity search working on full knowledge base
- [ ] Embedding quality validated on 10 test queries

### Hybrid Retrieval Implementation
- [ ] BM25 keyword search implemented
- [ ] Vector + BM25 fusion scoring
- [ ] Hybrid search returning top-10 relevant claims

### Reranking Layer
- [ ] Reranking model selected (Cohere or Voyage cross-encoder)
- [ ] Reranking integrated post-retrieval
- [ ] Top-5 relevance score > 0.75 (manual validation)

### Context & Graph Traversal
- [ ] Multi-hop argument chain retrieval (3+ levels)
- [ ] Citation metadata included (source + page reference)
- [ ] Argument grouping visible in context blocks
- [ ] Filtered retrieval by philosophical school working

### Retrieval Performance
- [ ] Query latency < 500ms (p95)
- [ ] 10 test ethics queries returning relevant results
- [ ] Cross-source argument chains working (e.g., Foot → DDE → utilitarian response)
- [ ] Admin dashboard: retrieval metrics & performance stats

---

## Production Hardening

### Database Optimization
- [ ] SurrealDB index strategy for core queries documented
- [ ] Query optimization: slow queries identified and fixed
- [ ] Connection pooling configured
- [ ] Read replica or backup process established

### Caching Layer
- [ ] Redis cache layer for frequent queries (optional but recommended)
- [ ] Cache invalidation strategy
- [ ] Cache hit rate > 60% on typical workloads

### Web Application Hardening
- [ ] Rate limiting on /api/analyse: 10 req/min per IP
- [ ] Request/response compression (gzip/brotli)
- [ ] Health check endpoints (`GET /health`)
- [ ] Error handling: graceful fallbacks for API failures
- [ ] User-friendly error messages (not exposing internal details)
- [ ] Request validation and sanitization

### Logging & Observability
- [ ] Structured logging to Google Cloud Logging
- [ ] Log levels: DEBUG, INFO, WARN, ERROR
- [ ] Query performance logging (slow query threshold: 1s)
- [ ] API request/response logging
- [ ] Error stack traces captured

### Monitoring & Alerting
- [ ] Cloud Run metrics: CPU, memory, request count
- [ ] Cloud Run alerting: >90% CPU, error rate > 1%, latency > 5s
- [ ] SurrealDB health checks (connectivity, response time)
- [ ] API endpoint health: /health returning 200 OK
- [ ] Error rate monitoring: target < 0.1%

### Deployment & Infrastructure
- [ ] Automated backups of SurrealDB knowledge base
- [ ] Backup recovery tested (restore time < 15 min)
- [ ] Blue-green deployment strategy documented
- [ ] Rollback procedure tested
- [ ] SLA documentation: 99.5% uptime target

---

## Quality Gates (ALL must pass before Phase 3b closure)

### Ingestion & Knowledge Base Quality
- [ ] **Extraction Accuracy**: >80% on 30+ sampled claims from Waves 2 & 3
- [ ] **Relation Quality**: >75% genuine logical connections on 15+ sampled relations
- [ ] **Knowledge Base Size**: ≥2,000 claims total (Waves 1-3)
- [ ] **Relation Count**: ≥1,500 relations total
- [ ] **Cross-wave Integration**: Relations connecting all three waves

### Retrieval & Context Quality
- [ ] **Retrieval Relevance**: 10 ethics queries with top-1 result > 0.75 relevance
- [ ] **Multi-hop Traversal**: Graph queries returning 3+ levels of argument chains
- [ ] **Citation Quality**: All retrieved claims include source reference
- [ ] **Diversity**: Retrieved results cover multiple philosophical schools

### Three-Pass Reasoning Integration
- [ ] **Context Injection**: Graph context correctly passed to all three passes
- [ ] **Improvement Metric**: Engine + context beats engine alone on ≥7/10 test cases
- [ ] **Latency**: End-to-end response time < 3 seconds (p95)
- [ ] **Fallback**: System works without SurrealDB (graceful degradation)

### Production Readiness
- [ ] **Availability**: No unplanned downtime in 24-hour test period
- [ ] **Error Rate**: < 0.1% on 1,000+ test requests
- [ ] **Health Checks**: Automated health endpoint passing
- [ ] **Database**: Backups verified and tested
- [ ] **Logging**: All errors captured and alerting configured
- [ ] **Documentation**: Runbooks for common operations (ingestion, backup, recovery)

---

## Implementation Phases

### Week 1: Wave 2 Setup & Ingestion
- [ ] Source list curated and URLs validated
- [ ] Batch ingestion script ready
- [ ] First 5 Wave 2 sources ingested and spot-checked
- [ ] Retrieval baseline tested with Wave 1+2 data

### Week 2: Wave 3 Ingestion & Reranking
- [ ] Remaining 5 Wave 2 sources completed
- [ ] All 11 Wave 3 sources ingested
- [ ] Reranking layer implemented and validated
- [ ] Cross-wave argument chains working

### Week 3: Production Hardening
- [ ] Database optimization completed
- [ ] Rate limiting, compression, health checks deployed
- [ ] Logging and monitoring fully configured
- [ ] Load testing: 100 concurrent users for 10 minutes

### Week 4: Final QA & Release
- [ ] All quality gates verified (passing)
- [ ] Documentation and runbooks complete
- [ ] Tag: `phase-3b-complete` created and released
- [ ] Begin Phase 4 planning

---

## Testing Strategy

### Manual Testing
- [ ] 10 ethics queries manually evaluated for relevance
- [ ] Spot-check 30+ claims per wave for accuracy
- [ ] Spot-check 15+ relations per wave for correctness
- [ ] Test graceful degradation (disable SurrealDB, confirm fallback works)

### Automated Testing
- [ ] Extraction validation (Zod schemas)
- [ ] Relation extraction validation
- [ ] Embedding generation verification
- [ ] Gemini validation scoring

### Performance Testing
- [ ] Load test: 100 concurrent requests to /api/analyse
- [ ] Query latency: p50, p95, p99 measured
- [ ] Database response time: measure for all query types
- [ ] Cache hit rate monitoring

---

## Sign-Off & Closure

**Phase 3b is considered complete when:**
- ✅ All three waves (29 sources) successfully ingested with >80% accuracy
- ✅ Knowledge base: >2,000 claims, >1,500 relations
- ✅ Retrieval system: top-1 relevance > 0.75 on 10 test queries
- ✅ Three-pass reasoning: +context beats -context on ≥7/10 cases
- ✅ Production infrastructure: all hardening requirements met
- ✅ All quality gates passed (documented evidence)
- ✅ GitHub tag `phase-3b-complete` created and released

**Post-Closure Review**:
- [ ] Retrospective: lessons learned from Waves 1-3
- [ ] Recommendations for Phase 4
- [ ] Archive test data and scripts
- [ ] Clean up any temporary utilities

---

*Last Updated: 2026-02-28*
*Status: Scaffolded for Phase 3b*
