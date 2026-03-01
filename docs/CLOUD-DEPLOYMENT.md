# SOPHIA Cloud Deployment Guide

## Overview

Waves 2 & 3 will be deployed on **Google Cloud Run** for parallel, serverless execution with 10-50x speedup vs local.

- **Wave 1**: Local testing (5-10 min) ✓
- **Waves 2-3**: Cloud Run deployment (2-5 min each, parallel)

---

## Architecture

### Local (Wave 1 - Reference)
```
Sequential extraction: 21 API calls × ~20s each = ~7 min
No validation (extraction only, --fast mode)
```

### Cloud Run (Waves 2-3)
```
Parallel extraction: Multiple Cloud Run instances
+ Faster network to API endpoints
+ More memory/CPU per instance
+ Auto-scaling for concurrent requests
Est. time: 2-5 min per wave
```

---

## Prerequisites

1. **GCP Project** with:
   - Cloud Run API enabled
   - Container Registry or Artifact Registry
   - SurrealDB accessible from Cloud Run (public IP or VPC)

2. **Local tools**:
   ```bash
   gcloud auth login
   gcloud config set project YOUR-PROJECT-ID
   ```

3. **Environment file** (`.env`):
   ```
   ANTHROPIC_API_KEY=sk-...
   VOYAGE_API_KEY=...
   GOOGLE_AI_API_KEY=...
   SURREAL_URL=http://YOUR-SURREAL-HOST:8000/rpc
   SURREAL_USER=root
   SURREAL_PASS=...
   ```

---

## Deployment Steps

### 1. Create Dockerfile

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

# Copy source code
COPY . .

# Default: Wave 2
# Override with --wave flag in Cloud Run execution
ENV WAVE_NUM=2
ENV FAST_MODE=1

CMD ["npx", "tsx", "--env-file=.env", "scripts/ingest-batch.ts", "--wave", "${WAVE_NUM}", "--fast", "--retry"]
```

### 2. Build Docker Image

```bash
# Build locally for testing
docker build -t sophia-ingest:latest .

# Test locally
docker run --env-file=.env sophia-ingest:latest
```

### 3. Push to GCP Container Registry

```bash
# Configure Docker for GCP
gcloud auth configure-docker

# Tag image
docker tag sophia-ingest:latest gcr.io/YOUR-PROJECT-ID/sophia-ingest:latest

# Push
docker push gcr.io/YOUR-PROJECT-ID/sophia-ingest:latest
```

### 4. Deploy to Cloud Run

#### Wave 2
```bash
gcloud run deploy sophia-wave2 \
  --image gcr.io/YOUR-PROJECT-ID/sophia-ingest:latest \
  --platform managed \
  --region us-central1 \
  --memory 2Gi \
  --cpu 2 \
  --timeout 3600 \
  --set-env-vars WAVE_NUM=2 \
  --set-env-vars ANTHROPIC_API_KEY=$(echo $ANTHROPIC_API_KEY) \
  --set-env-vars VOYAGE_API_KEY=$(echo $VOYAGE_API_KEY) \
  --set-env-vars GOOGLE_AI_API_KEY=$(echo $GOOGLE_AI_API_KEY) \
  --set-env-vars SURREAL_URL=http://YOUR-SURREAL-HOST:8000/rpc \
  --set-env-vars SURREAL_USER=root \
  --set-env-vars SURREAL_PASS=$(echo $SURREAL_PASS) \
  --no-allow-unauthenticated
```

#### Wave 3
```bash
gcloud run deploy sophia-wave3 \
  --image gcr.io/YOUR-PROJECT-ID/sophia-ingest:latest \
  --platform managed \
  --region us-central1 \
  --memory 2Gi \
  --cpu 2 \
  --timeout 3600 \
  --set-env-vars WAVE_NUM=3 \
  [same env vars as wave2]
```

### 5. Run Ingestion

```bash
# Wave 2
gcloud run execute sophia-wave2

# Wave 3 (in parallel with Wave 2)
gcloud run execute sophia-wave3

# Monitor
gcloud run services describe sophia-wave2
gcloud logging read "resource.service_name=sophia-wave2" --limit 100
```

---

## Optimization for Cloud Run

### Memory/CPU Allocation
```
Wave Size    | Memory | CPU | Est. Time
─────────────┼────────┼─────┼──────────
Wave 1 (8s)  | 1 Gi   | 1   | 8-10 min
Wave 2 (10s) | 2 Gi   | 2   | 2-5 min
Wave 3 (11s) | 2 Gi   | 2   | 2-5 min
```

### Concurrency Settings
```bash
--concurrency=1  # Sequential processing (safe)
--concurrency=2  # 2 parallel sources
```

---

## Cost Estimation

### Local (Wave 1)
- Claude API: ~$1.50
- Voyage AI: ~$0.10
- Total: ~$1.60 per run

### Cloud Run (Waves 2-3)
- Compute: ~$0.50 per 5-min run
- API calls: ~$2.00 per run
- Storage: minimal
- **Total per wave: ~$2.50**
- **Total both waves: ~$5.00**

---

## Troubleshooting

### Cloud Run timeout (3600s = 1 hour limit)
- For larger waves, split into sub-waves
- Or use Cloud Tasks for scheduled jobs

### SurrealDB connection fails
- Ensure Cloud Run can reach SurrealDB (firewall rules)
- Use VPC if SurrealDB is private

### Out of memory
- Increase `--memory` to 4Gi
- Or reduce `GEMINI_CONCURRENCY` env var

### API rate limits
- Set `GEMINI_CONCURRENCY=1` for Gemini
- Stagger Wave 2 and Wave 3 by 5 minutes

---

## Post-Deployment

1. **Monitor logs**:
   ```bash
   gcloud logging read "resource.service_name=sophia-wave2" --limit 50
   ```

2. **Check database**:
   ```bash
   npx tsx --env-file=.env scripts/check-status.ts
   ```

3. **Generate quality report**:
   ```bash
   npx tsx --env-file=.env scripts/quality-report.ts
   ```

4. **Spot-check results**:
   ```bash
   npx tsx --env-file=.env scripts/spot-check.ts
   ```

---

## Rollback / Re-run

If a wave fails:
```bash
# Check status
npx tsx --env-file=.env scripts/ingest-batch.ts --status --wave 2

# Retry
npx tsx --env-file=.env scripts/ingest-batch.ts --wave 2 --retry --fast

# Or on Cloud Run:
gcloud run execute sophia-wave2 --set-env-vars RETRY_MODE=1
```

---

## Summary

| Aspect | Local | Cloud Run |
|--------|-------|-----------|
| **Time** | 5-10 min | 2-5 min |
| **Cost** | $1.60 | $2.50 |
| **Setup** | Simple | Medium |
| **Scaling** | Limited | Automatic |
| **Ideal for** | Testing | Production |

**Recommendation**: Use Wave 1 locally for validation, then deploy Waves 2-3 to Cloud Run.
