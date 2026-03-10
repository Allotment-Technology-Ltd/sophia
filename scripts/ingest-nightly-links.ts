/**
 * SOPHIA — Nightly Deferred Link Ingestion Worker
 *
 * Pulls approved links from link_ingestion_queue, materializes source files,
 * runs full ingestion, and updates queue status per item.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/ingest-nightly-links.ts
 *   npx tsx --env-file=.env scripts/ingest-nightly-links.ts --dry-run
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { Surreal } from 'surrealdb';
import { extractFromSource } from '../src/lib/server/enrichment/sourceExtractor.js';

type QueueStatus = 'queued' | 'pending_review' | 'approved' | 'ingesting' | 'ingested' | 'failed' | 'rejected';

interface QueueRow {
  id: string;
  canonical_url: string;
  canonical_url_hash: string;
  hostname?: string;
  visibility_scope?: 'public_shared' | 'private_user_only';
  owner_uid?: string | null;
  contributor_uid?: string | null;
  title_hint?: string;
  last_submitted_at?: string;
  status?: QueueStatus;
  attempt_count?: number;
}

const BATCH_SIZE = Math.max(1, Number.parseInt(process.env.NIGHTLY_INGEST_BATCH_SIZE ?? '20', 10) || 20);
const MAX_RETRIES = Math.max(1, Number.parseInt(process.env.NIGHTLY_INGEST_MAX_RETRIES ?? '3', 10) || 3);
const RETRY_BASE_MS = Math.max(100, Number.parseInt(process.env.NIGHTLY_INGEST_RETRY_BASE_MS ?? '1000', 10) || 1000);
const SOURCE_MAX_BYTES = Math.max(50_000, Number.parseInt(process.env.NIGHTLY_INGEST_SOURCE_MAX_BYTES ?? '2000000', 10) || 2_000_000);
const SOURCE_MAX_LATENCY_MS = Math.max(
  1000,
  Number.parseInt(process.env.NIGHTLY_INGEST_SOURCE_MAX_LATENCY_MS ?? '20000', 10) || 20_000
);
const VALIDATE_ON_INGEST = (process.env.NIGHTLY_INGEST_VALIDATE ?? 'false').toLowerCase() === 'true';
const NIGHTLY_INGEST_ESTIMATED_COST_GBP = Math.max(
  0,
  Number.parseFloat(process.env.NIGHTLY_INGEST_ESTIMATED_COST_GBP ?? '1') || 1
);
const NIGHTLY_INGEST_BUDGET_GBP = Math.max(
  0,
  Number.parseFloat(process.env.NIGHTLY_INGEST_BUDGET_GBP ?? '0') || 0
);
const WORK_DIR = process.cwd();
const NIGHTLY_SOURCE_DIR = path.join(WORK_DIR, 'data', 'sources', 'nightly');
const SURREAL_URL = process.env.SURREAL_URL || 'http://localhost:8000/rpc';
const SURREAL_USER = process.env.SURREAL_USER || 'root';
const SURREAL_PASS = process.env.SURREAL_PASS || 'root';
const SURREAL_NAMESPACE = process.env.SURREAL_NAMESPACE || 'sophia';
const SURREAL_DATABASE = process.env.SURREAL_DATABASE || 'sophia';
const db = new Surreal();

function parseDryRunFlag(): boolean {
  return process.argv.slice(2).includes('--dry-run');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeTail(text: string, max = 600): string {
  if (!text) return '';
  return text.length <= max ? text : text.slice(text.length - max);
}

function estimateTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.3);
}

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 56);
  return slug || 'source';
}

function inferSourceType(urlString: string): 'sep_entry' | 'iep_entry' | 'book' | 'paper' | 'institutional' {
  const url = new URL(urlString);
  const host = url.hostname.toLowerCase();
  const pathname = url.pathname.toLowerCase();
  if (host === 'plato.stanford.edu' || host.endsWith('.plato.stanford.edu')) return 'sep_entry';
  if (host === 'iep.utm.edu' || host.endsWith('.iep.utm.edu')) return 'iep_entry';
  if (host === 'gutenberg.org' || host.endsWith('.gutenberg.org')) return 'book';
  if (pathname.endsWith('.pdf') || host === 'arxiv.org' || host.endsWith('.arxiv.org')) return 'paper';
  return 'institutional';
}

function deriveTitle(row: QueueRow, urlString: string): string {
  if (row.title_hint?.trim()) return row.title_hint.trim();
  const url = new URL(urlString);
  const tail = url.pathname.split('/').filter(Boolean).pop();
  if (tail) return decodeURIComponent(tail).replace(/[-_]+/g, ' ').slice(0, 140);
  return url.hostname;
}

async function listApprovedQueueRows(limit: number): Promise<QueueRow[]> {
  const rows = await runQuery(
    `SELECT id, canonical_url, canonical_url_hash, hostname, visibility_scope, owner_uid, contributor_uid, title_hint, last_submitted_at, status, attempt_count
     FROM link_ingestion_queue
     WHERE status = 'approved'
       AND (deletion_state = NONE OR deletion_state = 'active')
     ORDER BY last_submitted_at ASC
     LIMIT $limit`,
    { limit }
  );
  return extractRows<QueueRow>(rows);
}

async function updateQueueStatus(
  rowId: string,
  updates: {
    status: QueueStatus;
    attemptCount?: number;
    lastError?: string | null;
    markIngestedAt?: boolean;
  }
): Promise<void> {
  await runQuery(
    `UPDATE type::thing($id) MERGE {
      status: $status,
      attempt_count: $attempt_count,
      updated_at: time::now(),
      last_error: $last_error,
      ingested_at: if $mark_ingested_at then time::now() else ingested_at end
    } RETURN AFTER`,
    {
      id: rowId,
      status: updates.status,
      attempt_count: updates.attemptCount ?? null,
      last_error: updates.lastError ?? null,
      mark_ingested_at: updates.markIngestedAt ?? false
    }
  );
}

async function connectDb(): Promise<void> {
  await db.connect(SURREAL_URL);
  await db.signin({ username: SURREAL_USER, password: SURREAL_PASS } as any);
  await db.use({ namespace: SURREAL_NAMESPACE, database: SURREAL_DATABASE });
}

async function runQuery(sql: string, vars?: Record<string, unknown>): Promise<unknown> {
  return await db.query(sql, vars);
}

function extractRows<T>(result: unknown): T[] {
  if (!Array.isArray(result) || result.length === 0) return [];
  const first = result[0] as any;
  if (Array.isArray(first)) return first as T[];
  if (Array.isArray(first?.result)) return first.result as T[];
  if (first?.result && typeof first.result === 'object') return [first.result as T];
  if (typeof first === 'object') return result as T[];
  return [];
}

async function materializeSourceFiles(row: QueueRow): Promise<string> {
  const sourceType = inferSourceType(row.canonical_url);
  const mimeType =
    sourceType === 'paper' || row.canonical_url.toLowerCase().endsWith('.pdf')
      ? 'application/pdf'
      : 'text/html';

  const extracted = await extractFromSource({
    url: row.canonical_url,
    mimeType,
    budget: {
      maxBytes: SOURCE_MAX_BYTES,
      maxLatencyMs: SOURCE_MAX_LATENCY_MS
    }
  });

  const text = extracted.text.trim();
  if (text.length < 200) {
    throw new Error(`source extraction too short (${text.length} chars)`);
  }

  fs.mkdirSync(NIGHTLY_SOURCE_DIR, { recursive: true });

  const title = deriveTitle(row, row.canonical_url);
  const slug = `nightly-${slugify(title)}-${row.canonical_url_hash.slice(0, 10)}`;
  const txtPath = path.join(NIGHTLY_SOURCE_DIR, `${slug}.txt`);
  const metaPath = path.join(NIGHTLY_SOURCE_DIR, `${slug}.meta.json`);

  fs.writeFileSync(txtPath, text, 'utf-8');
  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      {
        title,
        author: [],
        source_type: sourceType,
        url: row.canonical_url,
        visibility_scope: row.visibility_scope ?? 'public_shared',
        owner_uid: row.owner_uid ?? undefined,
        contributor_uid: row.contributor_uid ?? undefined,
        deletion_state: 'active',
        fetched_at: new Date().toISOString(),
        word_count: text.split(/\s+/).filter(Boolean).length,
        char_count: text.length,
        estimated_tokens: estimateTokens(text)
      },
      null,
      2
    ),
    'utf-8'
  );

  return txtPath;
}

async function runIngestPipeline(txtPath: string): Promise<void> {
  const args = ['exec', 'tsx', 'scripts/ingest.ts', txtPath];
  if (VALIDATE_ON_INGEST) {
    args.push('--validate');
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn('pnpm', args, {
      cwd: WORK_DIR,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const data = chunk.toString();
      stdout += data;
      process.stdout.write(`[INGEST] ${data}`);
    });
    child.stderr.on('data', (chunk) => {
      const data = chunk.toString();
      stderr += data;
      process.stderr.write(`[INGEST][ERR] ${data}`);
    });

    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ingest.ts exited with code ${code}. stderr tail: ${safeTail(stderr)} stdout tail: ${safeTail(stdout)}`));
    });
  });
}

async function processRow(row: QueueRow, dryRun: boolean): Promise<{ success: boolean; attemptsUsed: number; error?: string }> {
  const baseAttempt = row.attempt_count ?? 0;
  let lastError = '';

  for (let attemptOffset = 1; attemptOffset <= MAX_RETRIES; attemptOffset += 1) {
    const attemptCount = baseAttempt + attemptOffset;
    await updateQueueStatus(row.id, {
      status: 'ingesting',
      attemptCount,
      lastError: null
    });

    try {
      if (!dryRun) {
        const txtPath = await materializeSourceFiles(row);
        await runIngestPipeline(txtPath);
      }

      await updateQueueStatus(row.id, {
        status: 'ingested',
        attemptCount,
        lastError: null,
        markIngestedAt: true
      });
      return { success: true, attemptsUsed: attemptOffset };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      const terminal = attemptOffset >= MAX_RETRIES;
      await updateQueueStatus(row.id, {
        status: terminal ? 'failed' : 'approved',
        attemptCount,
        lastError
      });
      if (!terminal) {
        const delayMs = RETRY_BASE_MS * Math.pow(2, attemptOffset - 1);
        console.warn(
          `[NIGHTLY] retrying ${row.canonical_url} in ${delayMs}ms (${attemptOffset}/${MAX_RETRIES})`
        );
        await sleep(delayMs);
      }
    }
  }

  return { success: false, attemptsUsed: MAX_RETRIES, error: lastError };
}

async function main(): Promise<void> {
  const dryRun = parseDryRunFlag();
  console.log('[NIGHTLY] Starting deferred ingestion worker');
  console.log(
    `[NIGHTLY] Config batch=${BATCH_SIZE} maxRetries=${MAX_RETRIES} retryBaseMs=${RETRY_BASE_MS} validate=${VALIDATE_ON_INGEST} dryRun=${dryRun} estimatedCostPerIngestGBP=${NIGHTLY_INGEST_ESTIMATED_COST_GBP} budgetGBP=${NIGHTLY_INGEST_BUDGET_GBP || 'unlimited'}`
  );
  await connectDb();

  try {
    const rows = await listApprovedQueueRows(BATCH_SIZE);
    if (rows.length === 0) {
      console.log('[NIGHTLY] No approved rows in queue');
      return;
    }

    let succeeded = 0;
    let failed = 0;
    let attempts = 0;
    let estimatedSpend = 0;

    for (const row of rows) {
      if (
        NIGHTLY_INGEST_BUDGET_GBP > 0 &&
        estimatedSpend + NIGHTLY_INGEST_ESTIMATED_COST_GBP > NIGHTLY_INGEST_BUDGET_GBP
      ) {
        console.warn(
          `[NIGHTLY] Budget guard triggered; stopping batch before ${row.id}. estimatedSpendGBP=${estimatedSpend.toFixed(2)} budgetGBP=${NIGHTLY_INGEST_BUDGET_GBP.toFixed(2)}`
        );
        break;
      }

      console.log(`[NIGHTLY] Processing ${row.id} -> ${row.canonical_url}`);
      const result = await processRow(row, dryRun);
      attempts += result.attemptsUsed;
      estimatedSpend += NIGHTLY_INGEST_ESTIMATED_COST_GBP;
      if (result.success) {
        succeeded += 1;
        console.log(`[NIGHTLY] Success ${row.id}`);
      } else {
        failed += 1;
        console.error(`[NIGHTLY] Failed ${row.id}: ${result.error ?? 'unknown error'}`);
      }
    }

    console.log(
      `[NIGHTLY] Completed batch processed=${rows.length} succeeded=${succeeded} failed=${failed} attempts=${attempts} estimated_spend_gbp=${estimatedSpend.toFixed(2)}`
    );
  } finally {
    try {
      await db.close();
    } catch {
      // ignore close errors
    }
  }
}

main().catch((err) => {
  console.error('[NIGHTLY] Worker failed:', err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
