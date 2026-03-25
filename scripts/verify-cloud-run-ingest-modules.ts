/**
 * Smoke-test the same TS module graph that `npx tsx scripts/ingest.ts` loads
 * when ADMIN_INGEST_RUN_REAL runs on Cloud Run (production node_modules only).
 *
 * Run after: `pnpm install --prod --frozen-lockfile`
 *   pnpm exec tsx scripts/verify-cloud-run-ingest-modules.ts
 */

await import('../src/lib/server/env.js');
await import('../src/lib/server/sourceIdentity.js');
await import('../src/lib/server/embeddings.js');
await import('../src/lib/server/restormelIngestionRoutes.js');
await import('../src/lib/server/vertex.js');
await import('../src/lib/server/restormel.js');
await import('../src/lib/server/resolve-provider.js');
await import('../src/lib/server/aaif/ingestion-plan.js');
await import('../src/lib/server/ingestion/contracts.js');
await import('../src/lib/server/ingestion/passageSegmentation.js');
await import('../src/lib/server/ingestion/claimTyping.js');
await import('../src/lib/server/prompts/extraction.js');
await import('../src/lib/server/prompts/relations.js');
await import('../src/lib/server/prompts/grouping.js');
await import('../src/lib/server/prompts/validation.js');

console.log('[verify-cloud-run-ingest-modules] OK');
