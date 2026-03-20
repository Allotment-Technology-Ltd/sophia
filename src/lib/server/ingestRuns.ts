/**
 * In-memory tracking for ingestion runs spawned from the admin ingest page.
 * Manages background processes and state updates via polling.
 */

import { spawn, type ChildProcess } from 'child_process';
import { randomBytes } from 'crypto';
import { EventEmitter } from 'events';

export interface IngestRunPayload {
  source_url: string;
  source_type: string;
  validate: boolean;
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
        fetch:    { status: 'idle' },
        extract:  { status: 'idle' },
        relate:   { status: 'idle' },
        group:    { status: 'idle' },
        embed:    { status: 'idle' },
        validate: { status: payload.validate ? 'idle' : 'skipped' },
        store:    { status: 'idle' }
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
    const state = this.runs.get(runId)!;

    this.addLog(runId, `Ingestion started by ${actorEmail}`);
    this.addLog(runId, `Source: ${payload.source_url}`);
    this.addLog(runId, `Type: ${payload.source_type}`);
    this.addLog(runId, `Models: extract=${payload.model_chain.extract}, relate=${payload.model_chain.relate}, group=${payload.model_chain.group}`);
    if (payload.validate) {
      this.addLog(runId, `Validation: enabled (model=${payload.model_chain.validate})`);
    }

    // Spawn a child process that runs ingest-batch.ts with appropriate flags
    // For now, we'll simulate the process with a mock that progresses through stages
    // In production, this would spawn: tsx scripts/ingest-batch.ts --source-url ... --model-chain ...
    // and listen to stdout/stderr

    // Mock implementation: simulate pipeline progress
    this.simulateIngestionProgress(runId, payload);
  }

  /**
   * Simulate ingestion progress (mock for now)
   * In production, this would listen to actual child process output
   */
  private simulateIngestionProgress(runId: string, payload: IngestRunPayload): void {
    const stages = ['fetch', 'extract', 'relate', 'group', 'embed', payload.validate ? 'validate' : null, 'store'].filter(Boolean) as string[];
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
          // Mark previous stage as done
          const prevStage = stages[stageIndex - 1];
          this.updateStageStatus(runId, prevStage, 'done');
        }

        // Start current stage
        this.updateStageStatus(runId, stage, 'running');
        this.addLog(runId, `Starting stage: ${stage}`);

        // Simulate some work
        const duration = Math.random() * 3000 + 2000; // 2-5 seconds per stage
        setTimeout(() => {
          stageIndex++;
        }, duration);
      } else {
        // All stages done
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
