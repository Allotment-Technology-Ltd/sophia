/**
 * In-memory tracking for ingestion runs spawned from the admin ingest page.
 * Manages background processes and state updates via polling.
 */

import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'child_process';
import { randomBytes } from 'crypto';
import { EventEmitter } from 'events';
import { buildEnvFileArgs, findFetchedSourceFile } from '$lib/server/adminOperations';

export interface IngestRunPayload {
  source_url: string;
  source_type: string;
  validate: boolean;
  /** Preferred embedding profile (wizard / Restormel); pipeline may still use server defaults. */
  embedding_model?: string;
  model_chain: {
    extract: string;
    relate: string;
    group: string;
    validate: string;
  };
}

export interface StageStatus {
  status: 'idle' | 'running' | 'done' | 'error' | 'skipped';
  summary?: string;
}

export interface IngestRunState {
  id: string;
  status: 'running' | 'done' | 'error';
  stages: Record<string, StageStatus>;
  logLines: string[];
  error?: string;
  process?: ChildProcess;
  createdAt: number;
  completedAt?: number;
}

/** Admin wizard / ingest UI types → `scripts/fetch-source.ts` types. */
function normalizeSourceTypeForFetch(sourceType: string): string {
  const map: Record<string, string> = {
    gutenberg_text: 'book',
    journal_article: 'paper',
    web_article: 'institutional'
  };
  return map[sourceType] ?? sourceType;
}

function ingestRunUsesRealChildProcess(): boolean {
  const v = (process.env.ADMIN_INGEST_RUN_REAL ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function appendProcessOutput(runId: string, chunk: Buffer, manager: IngestRunManager): void {
  const text = chunk.toString('utf-8');
  for (const line of text.split(/\n/)) {
    const trimmed = line.replace(/\r$/, '');
    if (trimmed.length > 0) manager.addLog(runId, trimmed);
  }
}

class IngestRunManager extends EventEmitter {
  private runs: Map<string, IngestRunState> = new Map();
  private maxLogLines = 500;

  /**
   * Create and spawn a new ingestion run
   */
  createRun(payload: IngestRunPayload, actorEmail: string): string {
    const runId = randomBytes(8).toString('hex');

    const state: IngestRunState = {
      id: runId,
      status: 'running',
      stages: {
        fetch: { status: 'idle' },
        extract: { status: 'idle' },
        relate: { status: 'idle' },
        group: { status: 'idle' },
        embed: { status: 'idle' },
        validate: { status: payload.validate ? 'idle' : 'skipped' },
        store: { status: 'idle' }
      },
      logLines: [],
      createdAt: Date.now()
    };

    this.runs.set(runId, state);
    this.spawnIngestionProcess(runId, payload, actorEmail);
    return runId;
  }

  /**
   * Get the current state of a run
   */
  getState(runId: string): IngestRunState | undefined {
    return this.runs.get(runId);
  }

  /**
   * Add a log line to the run (called by process handlers)
   */
  addLog(runId: string, line: string): void {
    const state = this.runs.get(runId);
    if (state) {
      state.logLines.push(line);
      if (state.logLines.length > this.maxLogLines) {
        state.logLines.shift();
      }
    }
  }

  /**
   * Update stage status (called by process handlers)
   */
  updateStageStatus(
    runId: string,
    stage: string,
    status: StageStatus['status'],
    summary?: string
  ): void {
    const state = this.runs.get(runId);
    if (state) {
      state.stages[stage] = { status, summary };
    }
  }

  /**
   * Mark run as complete
   */
  completeRun(runId: string): void {
    const state = this.runs.get(runId);
    if (state) {
      state.status = 'done';
      state.completedAt = Date.now();
    }
  }

  /**
   * Mark run as failed
   */
  failRun(runId: string, error: string): void {
    const state = this.runs.get(runId);
    if (state) {
      state.status = 'error';
      state.error = error;
      state.completedAt = Date.now();
    }
  }

  /**
   * Spawn the background ingestion process
   */
  private spawnIngestionProcess(runId: string, payload: IngestRunPayload, actorEmail: string): void {
    this.addLog(runId, `Ingestion started by ${actorEmail}`);
    this.addLog(runId, `Source: ${payload.source_url}`);
    this.addLog(runId, `Type: ${payload.source_type}`);
    this.addLog(
      runId,
      `Models: extract=${payload.model_chain.extract}, relate=${payload.model_chain.relate}, group=${payload.model_chain.group}`
    );
    if (payload.validate) {
      this.addLog(runId, `Validation: enabled (model=${payload.model_chain.validate})`);
    }
    if (payload.embedding_model?.trim()) {
      this.addLog(runId, `Embedding preference: ${payload.embedding_model.trim()}`);
    }

    if (ingestRunUsesRealChildProcess()) {
      this.addLog(
        runId,
        `Running fetch-source + ingest via npx tsx (fetch type: ${normalizeSourceTypeForFetch(payload.source_type)}).`
      );
      this.runRealIngestionPipeline(runId, payload);
    } else {
      this.addLog(
        runId,
        'Simulated pipeline progress. Set ADMIN_INGEST_RUN_REAL=1 to run fetch-source + ingest.ts on the server.'
      );
      this.simulateIngestionProgress(runId, payload);
    }
  }

  private runRealIngestionPipeline(runId: string, payload: IngestRunPayload): void {
    const fetchType = normalizeSourceTypeForFetch(payload.source_type);
    const fetchArgs = [
      'tsx',
      ...buildEnvFileArgs(),
      'scripts/fetch-source.ts',
      payload.source_url,
      fetchType
    ];

    this.updateStageStatus(runId, 'fetch', 'running');
    const fetchChild = spawn('npx', fetchArgs, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'pipe'
    }) as ChildProcessWithoutNullStreams;

    const runState = this.runs.get(runId);
    if (runState) runState.process = fetchChild;

    fetchChild.stdout.on('data', (chunk: Buffer) => appendProcessOutput(runId, chunk, this));
    fetchChild.stderr.on('data', (chunk: Buffer) => appendProcessOutput(runId, chunk, this));

    fetchChild.on('error', (err: Error) => {
      const s = this.runs.get(runId);
      if (s) s.process = undefined;
      this.updateStageStatus(runId, 'fetch', 'error');
      this.failRun(runId, `fetch-source failed to start: ${err.message}`);
    });

    fetchChild.on('close', (code: number | null) => {
      const s = this.runs.get(runId);
      if (s) s.process = undefined;
      if (code !== 0) {
        this.updateStageStatus(runId, 'fetch', 'error');
        this.failRun(runId, `fetch-source exited with code ${code ?? 1}`);
        return;
      }
      this.updateStageStatus(runId, 'fetch', 'done');
      const sourceFile = findFetchedSourceFile(payload.source_url);
      if (!sourceFile) {
        this.failRun(
          runId,
          'fetch-source succeeded but no matching data/sources/*.txt was found for this URL (canonical hash mismatch?).'
        );
        return;
      }
      this.startIngestChild(runId, payload, sourceFile);
    });
  }

  private startIngestChild(runId: string, payload: IngestRunPayload, sourceFile: string): void {
    const pipelineStages = ['extract', 'relate', 'group', 'embed'] as const;
    for (const stage of pipelineStages) {
      this.updateStageStatus(runId, stage, 'running');
    }
    if (payload.validate) {
      this.updateStageStatus(runId, 'validate', 'running');
    }
    this.updateStageStatus(runId, 'store', 'running');

    const ingestArgs = ['tsx', ...buildEnvFileArgs(), 'scripts/ingest.ts', sourceFile];
    if (payload.validate) ingestArgs.push('--validate');

    const ingestChild = spawn('npx', ingestArgs, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'pipe'
    }) as ChildProcessWithoutNullStreams;

    const runState = this.runs.get(runId);
    if (runState) runState.process = ingestChild;

    ingestChild.stdout.on('data', (chunk: Buffer) => appendProcessOutput(runId, chunk, this));
    ingestChild.stderr.on('data', (chunk: Buffer) => appendProcessOutput(runId, chunk, this));

    ingestChild.on('error', (err: Error) => {
      const s = this.runs.get(runId);
      if (s) s.process = undefined;
      this.markPipelineStagesError(runId, payload);
      this.failRun(runId, `ingest.ts failed to start: ${err.message}`);
    });

    ingestChild.on('close', (code: number | null) => {
      const s = this.runs.get(runId);
      if (s) s.process = undefined;
      const terminalStages = [
        ...pipelineStages,
        ...(payload.validate ? (['validate'] as const) : []),
        'store'
      ] as const;
      if (code === 0) {
        for (const stage of terminalStages) {
          this.updateStageStatus(runId, stage, 'done');
        }
        this.addLog(runId, 'Ingestion pipeline finished successfully.');
        this.completeRun(runId);
      } else {
        for (const stage of terminalStages) {
          this.updateStageStatus(runId, stage, 'error');
        }
        this.failRun(runId, `ingest.ts exited with code ${code ?? 1}`);
      }
    });
  }

  private markPipelineStagesError(runId: string, payload: IngestRunPayload): void {
    for (const stage of ['extract', 'relate', 'group', 'embed'] as const) {
      this.updateStageStatus(runId, stage, 'error');
    }
    if (payload.validate) {
      this.updateStageStatus(runId, 'validate', 'error');
    }
    this.updateStageStatus(runId, 'store', 'error');
  }

  /**
   * Simulate ingestion progress (default when ADMIN_INGEST_RUN_REAL is unset)
   */
  private simulateIngestionProgress(runId: string, payload: IngestRunPayload): void {
    const stages = [
      'fetch',
      'extract',
      'relate',
      'group',
      'embed',
      payload.validate ? 'validate' : null,
      'store'
    ].filter(Boolean) as string[];
    let stageIndex = 0;

    const progressInterval = setInterval(() => {
      const state = this.runs.get(runId);
      if (!state) {
        clearInterval(progressInterval);
        return;
      }

      if (stageIndex < stages.length) {
        const stage = stages[stageIndex];

        if (stageIndex > 0) {
          const prevStage = stages[stageIndex - 1];
          this.updateStageStatus(runId, prevStage, 'done');
        }

        this.updateStageStatus(runId, stage, 'running');
        this.addLog(runId, `Starting stage: ${stage}`);

        const duration = Math.random() * 3000 + 2000;
        setTimeout(() => {
          stageIndex++;
        }, duration);
      } else {
        for (const stage of stages) {
          if (state.stages[stage].status === 'running') {
            this.updateStageStatus(runId, stage, 'done');
          }
        }
        this.addLog(runId, 'All stages complete!');
        this.completeRun(runId);
        clearInterval(progressInterval);
      }
    }, 1000);
  }
}

// Export singleton
export const ingestRunManager = new IngestRunManager();
