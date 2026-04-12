/**
 * Drizzle schema for Neon (ingestion orchestration, staging, Firestore-shaped docs).
 * Canonical SQL migrations under drizzle/ — keep in sync when changing tables.
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
  primaryKey,
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
    /** Bumped by worker telemetry heartbeats during long model calls (separate from log-driven last_output_at). */
    workerHeartbeatAt: bigint('worker_heartbeat_at', { mode: 'number' }),
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
  sourceTextSnapshot: text('source_text_snapshot'),
  sourceJson: jsonb('source_json').$type<Record<string, unknown> | null>(),
  stageCompleted: text('stage_completed').notNull().default(''),
  costUsdSnapshot: doublePrecision('cost_usd_snapshot'),
  extractionProgress: jsonb('extraction_progress').$type<Record<string, unknown> | null>(),
  groupingProgress: jsonb('grouping_progress').$type<Record<string, unknown> | null>(),
  validationProgress: jsonb('validation_progress').$type<Record<string, unknown> | null>(),
  relationsProgress: jsonb('relations_progress').$type<Record<string, unknown> | null>(),
  embeddingProgress: jsonb('embedding_progress').$type<Record<string, unknown> | null>(),
  /** Mid-remediation checkpoint (ingest orchestration) */
  remediationProgress: jsonb('remediation_progress').$type<Record<string, unknown> | null>(),
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

/** Rolling tallies for ingestion LLM routing (cross-run deprioritization). */
export const ingestLlmModelHealth = pgTable(
  'ingest_llm_model_health',
  {
    provider: text('provider').notNull(),
    modelId: text('model_id').notNull(),
    failureCount: integer('failure_count').notNull().default(0),
    successCount: integer('success_count').notNull().default(0),
    lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    pk: primaryKey({ columns: [t.provider, t.modelId] }),
    updatedIdx: index('idx_ingest_llm_model_health_updated').on(t.updatedAt)
  })
);

/** Per-stage LLM failure/success tallies for ingestion routing (deprioritize bad stage+model pairs). */
export const ingestLlmStageModelHealth = pgTable(
  'ingest_llm_stage_model_health',
  {
    stage: text('stage').notNull(),
    provider: text('provider').notNull(),
    modelId: text('model_id').notNull(),
    failureCount: integer('failure_count').notNull().default(0),
    successCount: integer('success_count').notNull().default(0),
    lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    pk: primaryKey({ columns: [t.stage, t.provider, t.modelId] }),
    stageIdx: index('idx_ingest_llm_stage_model_health_stage').on(t.stage),
    updatedIdx: index('idx_ingest_llm_stage_model_health_updated').on(t.updatedAt)
  })
);

/** Optional cluster-wide cap for concurrent ingest children (see INGEST_GLOBAL_CONCURRENCY_GATE). */
export const ingestConcurrencyGate = pgTable('ingest_concurrency_gate', {
  id: integer('id').primaryKey().default(1),
  slotsInUse: integer('slots_in_use').notNull().default(0)
});

/** Optional per-pipeline-phase caps across processes (embed / store). */
export const ingestPhaseGate = pgTable('ingest_phase_gate', {
  phase: text('phase').primaryKey(),
  slotsInUse: integer('slots_in_use').notNull().default(0)
});

/** Multi-source ingestion job (admin); items spawn child `ingest_runs`. */
export const ingestionJobs = pgTable(
  'ingestion_jobs',
  {
    id: text('id').primaryKey(),
    status: text('status').notNull().default('running'),
    concurrency: integer('concurrency').notNull().default(2),
    actorUid: text('actor_uid'),
    actorEmail: text('actor_email'),
    notes: text('notes'),
    validateLlm: boolean('validate_llm').notNull().default(false),
    /** Subset of `IngestRunPayload.batch_overrides` merged into each child run when the job ticks. */
    workerDefaults: jsonb('worker_defaults').notNull().$type<Record<string, unknown>>().default({}),
    summary: jsonb('summary').notNull().$type<Record<string, unknown>>().default({}),
    pipelineVersion: text('pipeline_version'),
    embeddingFingerprint: text('embedding_fingerprint'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true })
  },
  (t) => ({
    updatedIdx: index('idx_ingestion_jobs_updated').on(t.updatedAt),
    statusIdx: index('idx_ingestion_jobs_status').on(t.status)
  })
);

export const ingestionJobItems = pgTable(
  'ingestion_job_items',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => ingestionJobs.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    sourceType: text('source_type').notNull().default('institutional'),
    status: text('status').notNull().default('pending'),
    childRunId: text('child_run_id'),
    lastError: text('last_error'),
    attempts: integer('attempts').notNull().default(0),
    /** When set, pending item is not eligible for launch until this time (launch throttle backoff). */
    blockedUntil: timestamp('blocked_until', { withTimezone: true }),
    /** Count of “too many concurrent workers” style launch throttles (separate from ingest attempts). */
    launchThrottleCount: integer('launch_throttle_count').notNull().default(0),
    queueRecordId: text('queue_record_id'),
    /** Set when item is terminal `error` after max attempts (DLQ visibility). */
    dlqEnqueuedAt: timestamp('dlq_enqueued_at', { withTimezone: true }),
    /** Result of `classifyIngestJobErrorMessage` at DLQ time: retryable | permanent | unknown */
    lastFailureKind: text('last_failure_kind'),
    /** Terminal bucket: retryable_exhausted | permanent | unknown_exhausted */
    failureClass: text('failure_class'),
    dlqReplayCount: integer('dlq_replay_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    jobIdx: index('idx_ingestion_job_items_job').on(t.jobId),
    jobStatusIdx: index('idx_ingestion_job_items_job_status').on(t.jobId, t.status),
    dlqIdx: index('idx_ingestion_job_items_dlq').on(t.dlqEnqueuedAt)
  })
);

export const ingestionJobEvents = pgTable(
  'ingestion_job_events',
  {
    id: serial('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => ingestionJobs.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    jobSeqUq: uniqueIndex('ingestion_job_events_job_seq_unique').on(t.jobId, t.seq),
    jobSeqIdx: index('idx_ingestion_job_events_job_seq').on(t.jobId, t.seq)
  })
);

/** Durable re-embed corpus job (Surreal claim.embedding → target_dim, e.g. 1024). */
export const reembedJobs = pgTable(
  'reembed_jobs',
  {
    id: text('id').primaryKey(),
    status: text('status').notNull().default('pending'),
    targetDim: integer('target_dim').notNull().default(1024),
    stage: text('stage').notNull().default('pending'),
    processedCount: integer('processed_count').notNull().default(0),
    totalCount: integer('total_count'),
    cursorOffset: integer('cursor_offset').notNull().default(0),
    batchSize: integer('batch_size').notNull().default(50),
    lastError: text('last_error'),
    actorEmail: text('actor_email'),
    summary: jsonb('summary').notNull().$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true })
  },
  (t) => ({
    statusIdx: index('idx_reembed_jobs_status').on(t.status),
    updatedIdx: index('idx_reembed_jobs_updated').on(t.updatedAt)
  })
);

export const reembedJobEvents = pgTable(
  'reembed_job_events',
  {
    id: serial('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => reembedJobs.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    jobSeqUq: uniqueIndex('reembed_job_events_job_seq_unique').on(t.jobId, t.seq),
    jobSeqIdx: index('idx_reembed_job_events_job_seq').on(t.jobId, t.seq)
  })
);

/** Per-source training / export exclusion (canonical URL hash). */
export const sourceTrainingGovernance = pgTable(
  'source_training_governance',
  {
    canonicalUrlHash: text('canonical_url_hash').primaryKey(),
    sourceUrl: text('source_url').notNull(),
    excludeFromModelTraining: boolean('exclude_from_model_training').notNull().default(false),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => ({
    sourceUrlIdx: index('idx_source_training_governance_source_url').on(t.sourceUrl)
  })
);

