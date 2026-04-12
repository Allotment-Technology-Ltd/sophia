---
status: archived
owner: adam
source_of_truth: false
last_reviewed: 2026-03-13
---

> Archived during the 2026-03-13 documentation rationalisation. Retained for historical context.

# SOPHIA Wave 1 Ingestion Analysis & Optimization Plan

**Date:** 2026-03-01  
**Status:** Critical Issues Identified  
**Priority:** P0 (GCP Deployment Blocker)

---

## Executive Summary

Wave 1 ingestion is experiencing **three critical failure modes**:

1. **Database Connection Issues** (P0)
   - No connection pooling; single connection per script
   - No reconnection logic on timeout/network failure
   - Sparse health checks (only every 25 claims)
   - Session expiry mid-operation causes silent/cascading failures

2. **Late Error Detection** (P0)  
   - Errors only discovered after entire wave completes
   - No streaming logs to GCP Cloud Logging during Cloud Run execution
   - No real-time monitoring endpoint
   - Difficult to diagnose root cause in post-hoc logs

3. **Performance Bottlenecks** (P1)
   - Sequential extraction phase (Phase A) processes one source at a time
   - No parallelization opportunity for API calls
   - Database operations use individual inserts instead of batch
   - Long ingestion times → higher risk of connection timeout

4. **Data Quality Issues** (P2)
   - 100% of claims are orphaned (no relations extracted)
   - All arguments contain 0 claims (grouping failed)
   - Indicates fundamental failure in stages 2-3 (relation extraction & grouping)
   - Validation stage shows complete disconnection from earlier stages

---

## Root Cause Analysis

### 1. Database Connection Failures

**Problem:** Single connection with no recovery

```typescript
// ingest.ts:605-610
const db = new Surreal();
try {
  await db.connect(SURREAL_URL);
  await db.signin({ username: SURREAL_USER, password: SURREAL_PASS } as any);
  await db.use({ namespace: SURREAL_NAMESPACE, database: SURREAL_DATABASE });
} catch (error) {
  console.error(`[ERROR] Failed to connect...`);
  process.exit(1); // ← FATAL: No retry logic
}
```

**Timeline of failure:**
1. Connection established successfully at start
2. After 10-20 minutes of processing, connection times out (GCP network timeout ~30min)
3. No automatic reconnect → next DB query fails silently
4. `updateIngestionLog()` calls fail → progress tracking lost
5. Eventually main process crashes, but errors already lost

**Why this happens:**
- SurrealDB on GCE uses a static HTTP connection
- GCP load balancers have idle timeout ~20-30 minutes
- Long ingestion runs exceed this timeout
- Single-threaded Node connection doesn't detect stale connections proactively

### 2. Error Detection Gap

**Problem:** Errors only visible after wave completion

```typescript
// ingest-batch.ts:700-878 (main loop)
for (const source of sources) {
  // Phase A runs — if it fails, error is logged
  const phaseAOk = await runPhaseA(ingestSlug, validate, label, fastMode);
  if (!phaseAOk) {
    results.push({ status: 'failed', reason: '...' });
    continue; // Continue to next source — no immediate alert
  }
  // ... rest of pipeline
}
// Summary report printed AFTER all sources processed
// ← Error discovered 10-30 minutes after failure occurred
```

**Why this matters on Cloud Run:**
- No STDOUT/STDERR streaming to Cloud Logging by default
- No webhook/notification channel for failures
- User discovers failure only after wave completes (or times out)
- GCP Cloud Run instances have 12-hour max timeout; wave may miss this
- No way to manually abort and investigate mid-run

### 3. Extraction Phase Bottleneck

**Problem:** Phase A is sequential; no parallelization

```typescript
// ingest-batch.ts:620-660
for (const source of sources) {
  // Phase A: One source at a time (Claude + Voyage)
  const phaseAOk = await runPhaseA(ingestSlug, validate, label, fastMode);
  if (!phaseAOk) continue;
  
  // Hand off Phase B to background; start next Phase A
  const phaseBTask = runPhaseB(...).finally(() => sem.release());
  phaseBTasks.push(phaseBTask);
}
```

**Bottleneck analysis:**
- Each source takes ~3-5 minutes for Phase A (extraction + embedding)
- Wave 1 = 8 sources → ~30 min sequential
- Could extract 4 sources in parallel → ~8 min total
- Currently: Phase A sequential, Phase B async (Gemini concurrency=2)
- **Better strategy:** Extract 4 sources in parallel, validate 2 in parallel = much higher throughput

### 4. Data Quality Failures

**Problem:** Relation extraction and grouping stages are failing silently

From 2026-03-01T08:00:18 quality report:
```
✗ Thin Arguments (≤ 2 claims) — 19 found (EXPECTED: 0-2)
✗ Orphan Claims (no relations) — 91/91 (100% ← CRITICAL)
```

**Indicates:**
- Stage 2 (Relation Extraction) produced no relations
- Stage 3 (Argument Grouping) assigned 0 claims to each argument
- Yet ingestion marked as "complete" — indicates error handling swallowed failures

**Likely causes:**
1. Claude API failures during relation extraction (no visible error logs)
2. JSON parsing failures in grouping stage
3. Database write failures during relation storage (caught but not logged)
4. Progress tracking lost if DB connection dropped mid-stage

---

## Solution Design

### Solution 1: Robust Database Connection Management

Implement connection pooling with automatic reconnection:

**New file:** `src/lib/server/db-pool.ts`
```typescript
interface PooledConnection {
  db: Surreal;
  lastUsed: number;
  isHealthy: boolean;
}

class SurrealDBPool {
  private connections: PooledConnection[] = [];
  private poolSize: number = 3;
  private healthCheckInterval: number = 30000; // 30s
  private idleTimeout: number = 600000; // 10 min

  async getConnection(): Promise<Surreal> {
    // 1. Return existing healthy connection
    // 2. Or create new one if pool not full
    // 3. Health check before returning
  }

  async healthCheck(): Promise<boolean> {
    // SELECT 1 as a quick ping
  }

  async reconnect(): Promise<void> {
    // Re-establish failed connections
  }
}
```

**Updates to ingest.ts and ingest-batch.ts:**
- Use pool instead of single connection
- Wrap DB calls with retry logic:
  ```typescript
  async function queryWithRetry(
    db: Surreal,
    query: string,
    params: any,
    maxRetries: number = 3
  ): Promise<any> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await db.query(query, params);
      } catch (error) {
        if (attempt < maxRetries && isNetworkError(error)) {
          const delay = 1000 * Math.pow(2, attempt);
          console.log(`[RETRY] Attempt ${attempt + 1} after ${delay}ms`);
          await sleep(delay);
          continue;
        }
        throw error;
      }
    }
  }
  ```

**Impact:** 
- Automatic recovery from transient connection failures
- 0-5 second recovery time vs. 30+ minute rerun
- Better error diagnostics

---

### Solution 2: Early Error Detection & Real-Time Monitoring

Implement health check before and during ingestion:

**New file:** `scripts/health-check.ts`
```typescript
async function performHealthChecks() {
  const checks = [
    { name: 'SurrealDB', fn: checkSurrealDB },
    { name: 'Anthropic API', fn: checkAnthropicAPI },
    { name: 'Voyage API', fn: checkVoyageAPI },
    { name: 'Gemini API', fn: checkGeminiAPI }
  ];
  
  const failed = [];
  for (const check of checks) {
    try {
      await check.fn();
      console.log(`✓ ${check.name}`);
    } catch (error) {
      console.error(`✗ ${check.name}: ${error.message}`);
      failed.push(check.name);
    }
  }
  
  if (failed.length > 0) {
    throw new Error(`Health checks failed: ${failed.join(', ')}`);
  }
}
```

**Integration:**
- Call `performHealthChecks()` at start of ingest-batch
- Call every 30 minutes during wave
- Abort wave immediately on critical failure
- Stream logs to GCP Cloud Logging:
  ```typescript
  // In Cloud Run environment
  if (process.env.K_SERVICE) {
    // Use Google Cloud Logging client
    const logging = new LoggingClient();
    logging.write([{
      severity: 'ERROR',
      message: errorMsg,
      timestamp: new Date()
    }]);
  }
  ```

**New file:** `scripts/monitor-wave.ts`
```typescript
// Run in separate Cloud Run sidecar or Cloud Task
// Polls ingestion_log table every 2 minutes
// Checks for:
// - All sources progressing (no stuck stages)
// - Error messages accumulating
// - Wave completion time estimate
// - Sends alerts if issues detected
```

**Impact:**
- Detect failures within 2 minutes instead of 30+ minutes
- Real-time visibility into GCP Cloud Logging
- Automated alerts via Cloud Monitoring/Slack webhook
- Early exit saves API costs ($0.10-0.30 per failed wave)

---

### Solution 3: Parallelized Extraction Phase

Implement parallel Phase A execution:

**Current (sequential):**
```
Source 1: Extract → Relate → Group → Embed (10 min)
Source 2: Extract → Relate → Group → Embed (10 min)
Source 3: Extract → Relate → Group → Embed (10 min)
...
Total: 80 min for 8 sources
```

**Optimized (parallel Phase A, sequential Phase B):**
```
Sources 1-4: Extract in parallel (5 min total) ← 4x parallelism
Then Sources 1-4: Relate+Group+Embed sequential (20 min total)
Then Sources 5-8: Extract in parallel (5 min total)
Then Sources 5-8: Relate+Group+Embed sequential (20 min total)
Total: 50 min for 8 sources (37% faster)
```

**Implementation:**

```typescript
// ingest-batch.ts: new extraction queue
interface ExtractionTask {
  slug: string;
  source: SourceEntry;
  priority: number;
}

const PARALLEL_EXTRACTIONS = 4;
const extractionQueue: ExtractionTask[] = [];
const extractionSemaphore = new Semaphore(PARALLEL_EXTRACTIONS);

// Queue all sources for extraction first
for (const source of sources) {
  extractionQueue.push({
    slug: createSlug(source.title),
    source,
    priority: source.wave // earlier waves first
  });
}

// Phase 1: Extract all sources in parallel
const extractionPromises = extractionQueue.map(task =>
  extractionSemaphore.acquire()
    .then(() => runPhaseAExtraction(task.slug, task.source))
    .finally(() => extractionSemaphore.release())
);

await Promise.all(extractionPromises);

// Phase 2: Relate+Group+Embed sequentially (lower concurrency)
for (const task of extractionQueue) {
  await runPhaseBRelateGroupEmbed(task.slug, task.source);
}

// Phase 3: Validate+Store in parallel with Gemini concurrency
const geminiQueue = extractionQueue.map(task =>
  runPhaseC(task.slug, task.source)
);
await Promise.all(geminiQueue.map((p, i) =>
  (i % GEMINI_CONCURRENCY === 0 ? Promise.resolve() : Promise.resolve())
    .then(() => p)
));
```

**Impact:**
- Wave 1 (8 sources): 80 min → 50 min (37% faster)
- Wave 2 (10 sources): 100 min → 60 min (40% faster)
- Cost reduction: ~30% fewer API calls (fewer retries due to faster completion)

---

### Solution 4: Batch Database Operations

Replace sequential inserts with batch operations:

**Current (slow):**
```typescript
for (let i = 0; i < allClaims.length; i++) {
  if (i > 0 && i % 25 === 0) {
    await ensureDbConnected(db);
  }
  const claim = allClaims[i];
  const result = await db.query(`CREATE claim CONTENT...`, { ... });
  // ← 91 separate DB round-trips for 91 claims
}
```

**Optimized (fast):**
```typescript
// Batch claims into groups of 50
const claimBatches = chunk(allClaims, 50);
for (const batch of claimBatches) {
  const createStatements = batch
    .map((claim, idx) => `($${idx}_text, $${idx}_type, ...)`)
    .join(',');
  
  const params = {};
  batch.forEach((claim, idx) => {
    params[`${idx}_text`] = claim.text;
    params[`${idx}_type`] = claim.claim_type;
    // ...
  });
  
  // Single query creates 50 claims in parallel
  await db.query(
    `CREATE claim CONTENT (${createStatements})`,
    params
  );
}
// ← 2 DB round-trips for 91 claims
```

**Impact:**
- Claim creation: 91 queries → 2 queries (45x fewer)
- Relation creation: 69 queries → 2 queries (34x fewer)
- Storage stage time: 15 min → 2 min (7x faster)
- Total wave time: reduced by 10-15%

---

### Solution 5: Improved Error Logging

Add detailed error context at every stage:

**Current:**
```typescript
if (result.status !== 0) return { success: false };
```

**Enhanced:**
```typescript
if (result.status !== 0) {
  // Capture full error context
  const errorContext = {
    timestamp: new Date().toISOString(),
    source: source.title,
    stage: 'Phase A',
    exitCode: result.status,
    stdout: result.stdout.slice(-500), // Last 500 chars
    stderr: result.stderr.slice(-500),
    duration: Date.now() - startTime,
    dbConnectionState: await db.isConnected()
  };
  
  // Log to Cloud Logging if in Cloud Run
  if (process.env.K_SERVICE) {
    await logging.write([{
      severity: 'ERROR',
      jsonPayload: errorContext,
      timestamp: new Date()
    }]);
  }
  
  // Save to local file for debugging
  fs.appendFileSync(
    'logs/errors.jsonl',
    JSON.stringify(errorContext) + '\n'
  );
  
  return { success: false, errorContext };
}
```

**Impact:**
- Reduce debugging time from 2-4 hours to 15-30 minutes
- Identify patterns across failures (DB vs. API vs. data)
- Enable automatic retry decisions based on error type

---

## Implementation Roadmap

### Phase 1: Critical Fixes (1-2 days) — MUST DO FIRST

**P0 Blocker:** Database connection reliability
1. Add health check utility
2. Implement retry wrapper for all DB queries
3. Add connection validation before critical stages
4. Test with simulated connection failure

**P0 Blocker:** Error visibility
1. Implement streaming logs to GCP Cloud Logging
2. Add early exit on critical API failures
3. Create health check script
4. Test Cloud Run deployment with failure scenarios

### Phase 2: Performance (2-3 days)

**P1 Optimization:** Parallel extraction
1. Refactor ingest-batch to use extraction queue
2. Implement Semaphore for concurrency control
3. Test with 4 parallel sources
4. Benchmark: expect 35-40% speedup

**P1 Optimization:** Batch database operations
1. Create batch insert utility
2. Update claim/relation/argument creation
3. Test with Wave 1 data
4. Benchmark: expect 60-70% faster storage phase

### Phase 3: Monitoring (1-2 days)

1. Create monitor-wave script
2. Deploy as Cloud Task/Workflow
3. Setup Slack webhook alerts
4. Create dashboard (Cloud Monitoring or Grafana)

---

## Success Criteria

| Metric | Current | Target | Timeline |
|--------|---------|--------|----------|
| **Wave 1 Success Rate** | 0% (all failed) | 100% | Phase 1 (2 days) |
| **Wave 1 Duration** | 80+ min (timeout) | 45-50 min | Phase 2 (5 days) |
| **Error Detection Time** | 30+ min | <2 min | Phase 1 (2 days) |
| **Data Quality (Relation Coverage)** | 0% | >75% | Phase 1 (2 days) |
| **Time-to-Debug on Failure** | 2-4 hours | 15-30 min | Phase 1+3 (4 days) |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|-----------|
| DB connection still fails after retry | Low | High | Test with GCP load balancer; consider CloudSQL Proxy |
| Parallel extraction causes API throttling | Medium | Medium | Implement exponential backoff; monitor API limits |
| Batch operations hit statement size limit | Low | Medium | Split batches into smaller groups; monitor SurrealDB logs |
| Data quality issues persist | Medium | High | Run pre-flight validation; add schema validation |

---

## Appendix: Testing Checklist

- [ ] Health check succeeds for all 4 APIs
- [ ] Simulated DB timeout recovers gracefully
- [ ] Phase A extraction runs in parallel without conflicts
- [ ] Batch inserts produce identical results to sequential inserts
- [ ] Cloud Logging receives error messages in real time
- [ ] Store phase completes in <2 minutes for 91 claims
- [ ] Wave 1 completes successfully in <50 minutes
- [ ] Quality report shows >75% claim relation coverage
- [ ] No orphaned claims in final data
