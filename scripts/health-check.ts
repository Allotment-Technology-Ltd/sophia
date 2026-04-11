/**
 * Health Checks for SOPHIA Ingestion Pipeline
 *
 * Validates all external dependencies before starting ingestion
 * - Database connectivity and permissions
 * - API authentication and quota
 * - Rate limits and availability
 *
 * Usage:
 *   const health = new HealthChecker(config);
 *   await health.checkAll();  // Throws on any failure
 */

import Anthropic from '@anthropic-ai/sdk';
import { VoyageAIClient } from 'voyageai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Surreal } from 'surrealdb';

export interface HealthCheckConfig {
	surreal_url: string;
	surreal_user: string;
	surreal_pass: string;
	anthropic_api_key: string;
	voyage_api_key: string;
	google_ai_api_key?: string;
}

export interface HealthStatus {
	service: string;
	healthy: boolean;
	details: string;
	latencyMs: number;
}

export class HealthChecker {
	private config: HealthCheckConfig;
	private results: Map<string, HealthStatus> = new Map();

	constructor(config: HealthCheckConfig) {
		this.config = config;
	}

	/**
	 * Run all health checks
	 */
	async checkAll(): Promise<HealthStatus[]> {
		const checks = [
			this.checkSurrealDB(),
			this.checkAnthropicAPI(),
			this.checkVoyageAPI(),
			this.checkGeminiAPI()
		];

		const results = await Promise.allSettled(checks);
		const statuses: HealthStatus[] = [];

		for (const result of results) {
			if (result.status === 'fulfilled') {
				statuses.push(result.value);
				this.results.set(result.value.service, result.value);
			} else {
				const error = result.reason as Error;
				statuses.push({
					service: 'Unknown',
					healthy: false,
					details: error.message,
					latencyMs: 0
				});
			}
		}

		// Print summary
		this.printSummary(statuses);

		// Fail if any critical service is down
		const failures = statuses.filter(
			(s) => !s.healthy && ['SurrealDB', 'Claude API', 'Voyage API'].includes(s.service)
		);

		if (failures.length > 0) {
			throw new Error(
				`Critical services unavailable: ${failures.map((f) => f.service).join(', ')}`
			);
		}

		return statuses;
	}

	/**
	 * Check SurrealDB connectivity
	 */
	private async checkSurrealDB(): Promise<HealthStatus> {
		const start = Date.now();
		const service = 'SurrealDB';

		try {
			const db = new Surreal();
			await db.connect(this.config.surreal_url);
			await db.signin({
				username: this.config.surreal_user,
				password: this.config.surreal_pass
			} as any);

			// Try a simple query
			const result = await db.query('SELECT 1 as test');
			await db.close();

			return {
				service,
				healthy: true,
				details: `Connected (latency: ${Date.now() - start}ms)`,
				latencyMs: Date.now() - start
			};
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			return {
				service,
				healthy: false,
				details: `Connection failed: ${msg}`,
				latencyMs: Date.now() - start
			};
		}
	}

	/**
	 * Check Anthropic Claude API
	 */
	private async checkAnthropicAPI(): Promise<HealthStatus> {
		const start = Date.now();
		const service = 'Claude API';

		try {
			const client = new Anthropic({
				apiKey: this.config.anthropic_api_key
			});

			// Quick API call to verify authentication and quota
			const response = await client.messages.create({
				model: 'claude-opus-4-1-20250805',
				max_tokens: 10,
				messages: [
					{
						role: 'user',
						content: 'Say "ok"'
					}
				]
			});

			const latency = Date.now() - start;

			return {
				service,
				healthy: response.content.length > 0,
				details: `API working (latency: ${latency}ms, input_tokens: ${response.usage.input_tokens})`,
				latencyMs: latency
			};
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);

			// Distinguish between auth failures and rate limits
			let details = `API error: ${msg}`;
			if (msg.includes('401') || msg.includes('authentication')) {
				details = 'Authentication failed (check ANTHROPIC_API_KEY)';
			} else if (msg.includes('429')) {
				details = 'Rate limited — wait before retrying';
			}

			return {
				service,
				healthy: false,
				details,
				latencyMs: Date.now() - start
			};
		}
	}

	/**
	 * Check Voyage AI Embedding API
	 */
	private async checkVoyageAPI(): Promise<HealthStatus> {
		const start = Date.now();
		const service = 'Voyage API';

		try {
			const client = new VoyageAIClient({
				apiKey: this.config.voyage_api_key
			});

			// Quick embedding API call
			const response = await client.embed({
				model: 'voyage-3-lite',
				input: ['health check'],
				outputDimension: 512
			});

			const latency = Date.now() - start;

			return {
				service,
				healthy: response.data.length > 0,
				details: `API working (latency: ${latency}ms, tokens: ${response.usage?.totalTokens || '?'})`,
				latencyMs: latency
			};
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);

			let details = `API error: ${msg}`;
			if (msg.includes('401') || msg.includes('authentication')) {
				details = 'Authentication failed (check VOYAGE_API_KEY)';
			} else if (msg.includes('429')) {
				details = 'Rate limited — wait before retrying';
			}

			return {
				service,
				healthy: false,
				details,
				latencyMs: Date.now() - start
			};
		}
	}

	/**
	 * Check Google Gemini API (optional — only if validation enabled)
	 */
	private async checkGeminiAPI(): Promise<HealthStatus> {
		const start = Date.now();
		const service = 'Gemini API';

		try {
			if (!this.config.google_ai_api_key) {
				return {
					service,
					healthy: true,
					details: 'Skipped (validation not enabled)',
					latencyMs: 0
				};
			}

			const client = new GoogleGenerativeAI(this.config.google_ai_api_key);
			const model = client.getGenerativeModel({ model: 'gemini-3-flash-preview' });

			const response = await model.generateContent({
				contents: [
					{
						role: 'user',
						parts: [{ text: 'Say ok' }]
					}
				],
				generationConfig: { temperature: 0.1 }
			});

			const latency = Date.now() - start;

			return {
				service,
				healthy: true,
				details: `API working (latency: ${latency}ms)`,
				latencyMs: latency
			};
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);

			let details = `API error: ${msg}`;
			if (msg.includes('401') || msg.includes('authentication')) {
				details = 'Authentication failed (check GOOGLE_AI_API_KEY)';
			} else if (msg.includes('429')) {
				details = 'Rate limited — wait before retrying';
			}

			// Gemini is optional, so don't fail hard
			return {
				service,
				healthy: false,
				details: `${details} (non-critical, validation will be skipped if needed)`,
				latencyMs: Date.now() - start
			};
		}
	}

	/**
	 * Print health check summary to console
	 */
	private printSummary(statuses: HealthStatus[]): void {
		console.log('\n╔════════════════════════════════════════════════════════╗');
		console.log('║          INGESTION PIPELINE HEALTH CHECK              ║');
		console.log('╚════════════════════════════════════════════════════════╝\n');

		for (const status of statuses) {
			const icon = status.healthy ? '✓' : '✗';
			const service = status.service.padEnd(20);
			console.log(`${icon} ${service} ${status.details}`);
		}

		const healthy = statuses.filter((s) => s.healthy).length;
		console.log(`\n${healthy}/${statuses.length} services healthy\n`);
	}

	/**
	 * Get detailed status for a specific service
	 */
	getStatus(service: string): HealthStatus | undefined {
		return this.results.get(service);
	}
}

/**
 * Quick health check for scripting
 */
export async function runHealthCheck(config: HealthCheckConfig): Promise<void> {
	const checker = new HealthChecker(config);
	await checker.checkAll();
	console.log('[HEALTH] All critical services operational\n');
}
