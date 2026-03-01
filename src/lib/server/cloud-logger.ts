/**
 * Google Cloud Logging Integration
 *
 * When running on Cloud Run, streams logs to Google Cloud Logging
 * for real-time visibility and integration with Cloud Monitoring.
 *
 * Falls back to console.log if not on Cloud Run.
 *
 * Usage:
 *   const logger = new CloudLogger();
 *   await logger.error('Something failed', { source: 'wave1', stage: 'extraction' });
 */

import { LoggingClient } from '@google-cloud/logging';

type Severity = 'DEBUG' | 'INFO' | 'NOTICE' | 'WARNING' | 'ERROR' | 'CRITICAL';

export interface LogEntry {
	message: string;
	severity?: Severity;
	metadata?: Record<string, any>;
	timestamp?: Date;
}

export class CloudLogger {
	private isCloudRun: boolean;
	private client: LoggingClient | null = null;
	private logName: string;

	constructor() {
		// Detect if running in Cloud Run
		this.isCloudRun = !!process.env.K_SERVICE;
		this.logName = process.env.K_SERVICE || 'sophia-ingestion';

		if (this.isCloudRun) {
			try {
				this.client = new LoggingClient();
			} catch (error) {
				console.warn('[LOGGER] Failed to initialize Cloud Logging client:', error);
				this.isCloudRun = false;
			}
		}
	}

	/**
	 * Log at specified severity level
	 */
	async log(entry: LogEntry): Promise<void> {
		const severity = entry.severity || 'INFO';

		if (this.isCloudRun && this.client) {
			await this.logToCloud(entry.message, severity, entry.metadata);
		} else {
			this.logToConsole(entry.message, severity);
		}
	}

	async info(message: string, metadata?: Record<string, any>): Promise<void> {
		await this.log({ message, severity: 'INFO', metadata });
	}

	async warn(message: string, metadata?: Record<string, any>): Promise<void> {
		await this.log({ message, severity: 'WARNING', metadata });
	}

	async error(message: string, metadata?: Record<string, any>): Promise<void> {
		await this.log({ message, severity: 'ERROR', metadata });
	}

	async critical(message: string, metadata?: Record<string, any>): Promise<void> {
		await this.log({ message, severity: 'CRITICAL', metadata });
	}

	/**
	 * Stream log to Google Cloud Logging
	 */
	private async logToCloud(
		message: string,
		severity: Severity,
		metadata?: Record<string, any>
	): Promise<void> {
		if (!this.client) return;

		try {
			const entry = this.client.entry(
				{
					severity,
					jsonPayload: {
						message,
						...metadata,
						timestamp: new Date().toISOString(),
						service: this.logName
					}
				},
				{
					labels: {
						service: this.logName,
						job: process.env.CLOUD_RUN_TASK_NAME || 'unknown'
					}
				}
			);

			await this.client.log(this.logName).write(entry);
		} catch (error) {
			console.warn('[LOGGER] Failed to write to Cloud Logging:', error);
		}
	}

	/**
	 * Fallback: log to console
	 */
	private logToConsole(message: string, severity: Severity): void {
		const timestamp = new Date().toISOString();
		const prefix = `[${severity}] ${timestamp}`;

		switch (severity) {
			case 'ERROR':
			case 'CRITICAL':
				console.error(`${prefix} ${message}`);
				break;
			case 'WARNING':
				console.warn(`${prefix} ${message}`);
				break;
			default:
				console.log(`${prefix} ${message}`);
		}
	}
}

/**
 * Global logger instance
 */
export const logger = new CloudLogger();

/**
 * Log error context for debugging
 */
export async function logIngestionError(
	source: string,
	stage: string,
	error: Error | string,
	context?: Record<string, any>
): Promise<void> {
	const message = typeof error === 'string' ? error : error.message;

	await logger.error(`Ingestion failure: ${source}`, {
		source,
		stage,
		error: message,
		stack: typeof error === 'object' ? error.stack : undefined,
		...context
	});
}

/**
 * Log successful stage completion
 */
export async function logStageComplete(
	source: string,
	stage: string,
	details?: Record<string, any>
): Promise<void> {
	await logger.info(`Stage complete: ${source} → ${stage}`, {
		source,
		stage,
		...details
	});
}
