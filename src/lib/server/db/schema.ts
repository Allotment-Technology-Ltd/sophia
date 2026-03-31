/**
 * Drizzle schema for Neon (ingestion orchestration, staging, Firestore-shaped docs).
 * Canonical SQL migrations: drizzle/0000_neon_first.sql, drizzle/0002_early_access_waitlist.sql — keep in sync when changing tables.
 */

import {
  bigint,
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex
} from 'drizzle-orm/pg-core';

const vector768 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(768)';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: unknown): number[] {
    if (typeof value !== 'string') return [];
    const s = value.trim();
    const inner = s.startsWith('[') && s.endsWith(']') ? s.slice(1, -1) : s;
    if (!inner) return [];
    return inner.split(',').map((x) => Number(x.trim()));
  }
});

export const ingestRuns = pgTable(
  'ingest_runs',
  {
    id: text('id').primaryKey(),
    status: text('status').notNull().default('running'),
    payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
    payloadVersion: integer('payload_version').notNull().default(1),
    stages: jsonb('stages').notNull().$type<Record<string, unknown>>().default({}),
    error: text('error'),
    sourceUrl: text('source_url').notNull(),
    sourceType: text('source_type').notNull(),
    actorEmail: text('actor_email'),
    resumable: boolean('resumable').notNull().default(false),
    lastFailureStage: text('last_failure_stage'),
    sourceFilePath: text('source_file_path'),
    fetchRetryAttempts: integer('fetch_retry_attempts').notNull().default(0),
    ingestRetryAttempts: integer('ingest_retry_attempts').notNull().default(0),
    syncRetryAttempts: integer('sync_retry_attempts').notNull().default(0),
    currentStageKey: text('current_stage_key'),
    currentAction: text('current_action'),
    lastOutputAt: bigint('last_output_at', { mode: 'number' }),
    cancelledByUser: boolean('cancelled_by_user').notNull().default(false),
    syncStartedAt: timestamp('sync_started_at', { withTimezone: true }),
    syncCompletedAt: timestamp('sync_completed_at', { withTimezone: true }),
    reportEnvelope: jsonb('report_envelope').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    updatedIdx: index('idx_ingest_runs_updated').on(t.updatedAt),
    completedIdx: index('idx_ingest_runs_completed').on(t.completedAt)
  })
);

export const ingestRunLogs = pgTable(
  'ingest_run_logs',
  {
    id: serial('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => ingestRuns.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    line: text('line').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    runSeqUq: uniqueIndex('ingest_run_logs_run_id_seq_unique').on(t.runId, t.seq),
    runSeqIdx: index('idx_ingest_run_logs_run_seq').on(t.runId, t.seq)
  })
);

export const ingestRunIssues = pgTable(
  'ingest_run_issues',
  {
    id: serial('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => ingestRuns.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    kind: text('kind').notNull(),
    severity: text('severity').notNull(),
    stageHint: text('stage_hint'),
    message: text('message').notNull(),
    rawLine: text('raw_line'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    runSeqUq: uniqueIndex('ingest_run_issues_run_id_seq_unique').on(t.runId, t.seq)
  })
);

export const ingestStagingMeta = pgTable('ingest_staging_meta', {
  runId: text('run_id')
    .primaryKey()
    .references(() => ingestRuns.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull().default(''),
  sourceJson: jsonb('source_json').$type<Record<string, unknown> | null>(),
  stageCompleted: text('stage_completed').notNull().default(''),
  costUsdSnapshot: doublePrecision('cost_usd_snapshot'),
  extractionProgress: jsonb('extraction_progress').$type<Record<string, unknown> | null>(),
  groupingProgress: jsonb('grouping_progress').$type<Record<string, unknown> | null>(),
  validationProgress: jsonb('validation_progress').$type<Record<string, unknown> | null>(),
  relationsProgress: jsonb('relations_progress').$type<Record<string, unknown> | null>(),
  embeddingProgress: jsonb('embedding_progress').$type<Record<string, unknown> | null>(),
  validationFull: jsonb('validation_full').$type<Record<string, unknown> | null>(),
  embeddingsJson: jsonb('embeddings_json').$type<number[][] | null>(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const ingestStagingClaims = pgTable(
  'ingest_staging_claims',
  {
    id: serial('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => ingestRuns.id, { onDelete: 'cascade' }),
    positionInSource: integer('position_in_source').notNull(),
    claimText: text('claim_text').notNull(),
    claimData: jsonb('claim_data').notNull().$type<Record<string, unknown>>(),
    embedding: vector768('embedding'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    runPosUq: uniqueIndex('ingest_staging_claims_run_pos').on(t.runId, t.positionInSource),
    runIdx: index('idx_staging_claims_run').on(t.runId)
  })
);

export const ingestStagingRelations = pgTable(
  'ingest_staging_relations',
  {
    id: serial('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => ingestRuns.id, { onDelete: 'cascade' }),
    fromPosition: integer('from_position').notNull(),
    toPosition: integer('to_position').notNull(),
    relationType: text('relation_type').notNull(),
    relationData: jsonb('relation_data').notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    runRelUq: uniqueIndex('ingest_staging_relations_run_unique').on(
      t.runId,
      t.fromPosition,
      t.toPosition,
      t.relationType
    )
  })
);

export const ingestStagingArguments = pgTable(
  'ingest_staging_arguments',
  {
    id: serial('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => ingestRuns.id, { onDelete: 'cascade' }),
    argumentIndex: integer('argument_index').notNull(),
    argumentData: jsonb('argument_data').notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    runArgUq: uniqueIndex('ingest_staging_arguments_run_idx').on(t.runId, t.argumentIndex)
  })
);

export const ingestStagingValidation = pgTable(
  'ingest_staging_validation',
  {
    id: serial('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => ingestRuns.id, { onDelete: 'cascade' }),
    positionInSource: integer('position_in_source').notNull(),
    faithfulnessScore: doublePrecision('faithfulness_score'),
    validationData: jsonb('validation_data').$type<Record<string, unknown> | null>()
  },
  (t) => ({
    uniqueRunPos: uniqueIndex('ingest_staging_validation_run_pos').on(t.runId, t.positionInSource)
  })
);

export const sophiaDocuments = pgTable(
  'sophia_documents',
  {
    path: text('path').primaryKey(),
    topCollection: text('top_collection').notNull(),
    data: jsonb('data').notNull().$type<Record<string, unknown>>().default({}),
    sortCreatedAt: timestamp('sort_created_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    topColIdx: index('idx_sophia_docs_top_collection').on(t.topCollection),
    sortIdx: index('idx_sophia_docs_sort_created').on(t.topCollection, t.sortCreatedAt)
  })
);

export const earlyAccessWaitlist = pgTable(
  'early_access_waitlist',
  {
    id: serial('id').primaryKey(),
    email: text('email').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    sourcePath: text('source_path'),
    userAgent: text('user_agent')
  },
  (t) => ({
    createdIdx: index('idx_early_access_waitlist_created_at').on(t.createdAt)
  })
);
