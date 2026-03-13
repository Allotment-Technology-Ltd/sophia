---
status: archived
owner: adam
source_of_truth: false
last_reviewed: 2026-03-13
---

> Archived during the 2026-03-13 documentation rationalisation. Retained for historical context.

# SOPHIA Phase 3b Roadmap

## Overview
Phase 3b extends the Phase 3a foundation with advanced retrieval capabilities, additional source ingestion (Waves 2 & 3), and production hardening. Estimated duration: 3-4 weeks.

---

## Phase 3b Objectives

### 1. Extended Source Ingestion
Ingest philosophical sources beyond the foundational Wave 1, building out the ethics knowledge base.

#### Wave 2 Sources (10 sources)
- [ ] SEP Consequentialism
- [ ] SEP Kantian Ethics
- [ ] SEP Rights
- [ ] Rawls: Theory of Justice (excerpts)
- [ ] Nussbaum: Capabilities Approach
- [ ] Sen: Development as Freedom
- [ ] Foot: Virtues and Vices
- [ ] Dennett: Freedom Evolves
- [ ] Slote: Agent-Based Virtue Ethics
- [ ] Korsgaard: Self-Constituting Agency

#### Wave 3 Sources (11 sources)
- [ ] SEP Applied Ethics
- [ ] SEP Bioethics
- [ ] SEP Environmental Ethics
- [ ] Shue: Basic Rights
- [ ] Williams: Ethics and the Limits of Philosophy
- [ ] MacIntyre: After Virtue
- [ ] Anscombe: Modern Moral Philosophy
- [ ] Singer: Animal Liberation (excerpts)
- [ ] Hooker: Ideal Code, Real World
- [ ] Besson: The Principle of Subsidiarity
- [ ] Gardiner: A Perfect Moral Storm

**Deliverables**:
- [ ] All 21 Wave 2 & 3 sources ingested via batch pipeline
- [ ] ~1,500+ additional claims in knowledge base
- [ ] Cross-wave relation extraction verified
- [ ] Quality spot-checks: 10% sampling pass accuracy threshold

---

### 2. Advanced Retrieval & Reranking

#### Dense Retrieval Improvements
- [ ] Optimize Voyage AI embedding generation for philosophical discourse
- [ ] Implement hybrid retrieval: BM25 + vector search
- [ ] Add reranking layer (Cohere or Voyage cross-encoder)
- [ ] Multi-hop graph traversal for deep argument exploration

#### Context Formatting
- [ ] Improve claim → context block formatting
- [ ] Add citation metadata (source + page reference)
- [ ] Implement argument chain visualization
- [ ] Support filtered retrieval by philosophical school/domain

**Deliverables**:
- [ ] Retrieval latency < 500ms for typical queries
- [ ] Top-5 results have >80% relevance (manual eval)
- [ ] Graph traversal returning 3+ levels of related arguments
- [ ] Admin dashboard retrieval performance metrics

---

### 3. Production Hardening

#### Database & Performance
- [ ] SurrealDB query optimization and indexing
- [ ] Connection pooling and session management
- [ ] Implement caching layer (Redis) for frequent queries
- [ ] Database backup and recovery procedures

#### Web Application
- [ ] Rate limiting on /api/analyse endpoint
- [ ] Request/response compression (gzip)
- [ ] Add health check endpoints for Cloud Run
- [ ] Implement structured logging for debugging
- [ ] Error handling and user-friendly error messages

#### Monitoring & Observability
- [ ] Cloud Run metrics: CPU, memory, request latency
- [ ] Error logging: Google Cloud Logging integration
- [ ] Query performance monitoring
- [ ] User engagement analytics (non-PII)

**Deliverables**:
- [ ] 99.5% uptime SLA documented
- [ ] Response time < 3s for typical queries
- [ ] Error rate < 0.1%
- [ ] Monitoring dashboard in Google Cloud Console

---

### 4. Quality Gates for Phase 3b

All of the following must pass before Phase 3b closure:

- [ ] **Ingestion Accuracy**: >80% extraction accuracy on Wave 2 & 3 spot checks (30+ claims sampled)
- [ ] **Relation Quality**: >75% genuine logical connections in sampled relations
- [ ] **Retrieval Performance**:
  - [ ] 10 ethics queries return relevant context
  - [ ] Top-1 relevance score > 0.75 (manual evaluation)
  - [ ] Multi-hop traversal returning 3+ argument levels
- [ ] **Three-Pass Improvement**: Engine + graph context beats engine alone on ≥7/10 test cases
- [ ] **Knowledge Base Size**: ≥2,000 claims, ≥1,500 relations across all waves
- [ ] **Production Readiness**:
  - [ ] Automated health checks passing
  - [ ] Database backups verified
  - [ ] Error handling for all failure modes
  - [ ] Monitoring alerts configured

---

## Implementation Plan

### Week 1: Wave 2 Ingestion & Retrieval Foundation
1. Fetch and parse Wave 2 sources
2. Run batch ingestion pipeline
3. Implement hybrid retrieval (BM25 + vector)
4. Performance baseline testing

### Week 2: Wave 3 Ingestion & Reranking
1. Fetch and parse Wave 3 sources
2. Complete batch ingestion
3. Implement reranking layer
4. Spot-check quality metrics

### Week 3: Production Hardening
1. Database optimization and caching
2. Web app hardening (rate limiting, compression)
3. Monitoring setup
4. Load testing

### Week 4: Quality Assurance & Closure
1. Comprehensive quality gate testing
2. Documentation and runbooks
3. Tag Phase 3b completion
4. Begin Phase 4 planning

---

## Dependencies & Risks

### Dependencies
- Voyage AI API availability and rate limits
- Google Gemini API consistency
- SurrealDB stability on GCE VM
- Source document availability and parsing accuracy

### Risks & Mitigation
| Risk | Mitigation |
|------|-----------|
| Degraded retrieval with large knowledge base | Implement caching and indexing early; load test with full dataset |
| Source parsing failures | Maintain error logs; implement manual review workflow for failed sources |
| API rate limiting | Implement exponential backoff and queue management |
| Knowledge base inconsistency | Verify schema constraints; run integrity checks nightly |

---

## Success Criteria

✅ **Phase 3b is complete when:**
1. All three waves (29 sources) successfully ingested
2. Knowledge base contains >2,000 claims with high accuracy
3. Retrieval system returns relevant philosophical context
4. Production infrastructure passes all hardening requirements
5. All quality gates passed and documented
6. GitHub tag `phase-3b-complete` created and released

---

## Notes & Considerations

- **Ethics Scope**: Maintain focus on philosophical ethics (normative, metaethics, applied)
- **Source Quality**: Prioritize peer-reviewed and authoritative texts
- **Graph Quality**: Ensure cross-source relations are genuine logical connections
- **Graceful Degradation**: System must function with read-only SurrealDB
- **Future Extensibility**: Design retrieval for future expansion to other philosophical domains (epistemology, metaphysics, etc.)

---

## Next Steps (Post Phase 3b)

### Phase 4: Advanced Features
- Knowledge graph visualization
- Argument provenance and citation tracking
- User authentication and conversation history
- Advanced analytics

### Phase 5: Expansion
- Multi-language content
- Additional philosophical domains
- Community contributions
- Open API

---

*Last Updated: 2026-02-28*
*Status: In Planning (Post Phase 3a)*
