/**
 * Configure Restormel route steps from the CLI (Dashboard API, same as Sophia admin proxies).
 *
 * Requires (see .env):
 *   RESTORMEL_GATEWAY_KEY
 *   RESTORMEL_PROJECT_ID
 *   RESTORMEL_KEYS_BASE (optional; defaults to https://restormel.dev)
 *   RESTORMEL_ENVIRONMENT_ID (optional; default production)
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/restormel/route-steps.ts list-routes
 *   npx tsx --env-file=.env scripts/restormel/route-steps.ts get-steps <routeId>
 *   npx tsx --env-file=.env scripts/restormel/route-steps.ts apply-steps <routeId> steps.json
 *   cat steps.json | npx tsx --env-file=.env scripts/restormel/route-steps.ts apply-steps <routeId>
 *   npx tsx --env-file=.env scripts/restormel/route-steps.ts capabilities
 */

import * as fs from 'fs';
import type { RestormelStepRecord } from '../../src/lib/server/restormel.js';
import {
	restormelGetRoutingCapabilities,
	restormelListRouteSteps,
	restormelListRoutes,
	restormelReplaceRouteSteps
} from '../../src/lib/server/restormel.js';

function printHelp(): void {
	console.log(`restormel route-steps

Commands:
  list-routes              Print routes for RESTORMEL_PROJECT_ID as JSON
  get-steps <routeId>      Print current steps array (same shape as admin editor)
  apply-steps <routeId> [file]
                           POST steps to Restormel. JSON is a steps array [...] or { "steps": [...] }.
                           If [file] is omitted, read JSON from stdin.
  capabilities             Print routing-capabilities (workloads, stages)

Environment:
  RESTORMEL_GATEWAY_KEY, RESTORMEL_PROJECT_ID (required)
  RESTORMEL_KEYS_BASE (optional)
`);
}

async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return Buffer.concat(chunks).toString('utf-8').trim();
}

function normalizeStepsPayload(parsed: unknown): unknown {
	if (Array.isArray(parsed)) return parsed;
	if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { steps?: unknown }).steps)) {
		return (parsed as { steps: unknown[] }).steps;
	}
	throw new Error('Expected a JSON array of steps, or an object with a "steps" array');
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	const cmd = argv[0];

	if (!cmd || cmd === '-h' || cmd === '--help') {
		printHelp();
		process.exit(cmd ? 0 : 1);
	}

	try {
		switch (cmd) {
			case 'list-routes': {
				const { data } = await restormelListRoutes();
				console.log(JSON.stringify(data, null, 2));
				return;
			}
			case 'capabilities': {
				const res = await restormelGetRoutingCapabilities();
				console.log(JSON.stringify(res.data, null, 2));
				return;
			}
			case 'get-steps': {
				const routeId = argv[1];
				if (!routeId) {
					console.error('Usage: get-steps <routeId>');
					process.exit(1);
				}
				const { data } = await restormelListRouteSteps(routeId);
				const steps = Array.isArray(data) ? data : [];
				console.log(JSON.stringify(steps, null, 2));
				return;
			}
			case 'apply-steps': {
				const routeId = argv[1];
				const file = argv[2];
				if (!routeId) {
					console.error('Usage: apply-steps <routeId> [file]');
					process.exit(1);
				}
				const raw = file ? await fs.promises.readFile(file, 'utf-8') : await readStdin();
				if (!raw) {
					console.error('No JSON input: pass a file path or pipe JSON on stdin.');
					process.exit(1);
				}
				const parsed = JSON.parse(raw) as unknown;
				const body = normalizeStepsPayload(parsed);
				const response = await restormelReplaceRouteSteps(routeId, body as RestormelStepRecord[]);
				console.log(JSON.stringify(response.data, null, 2));
				return;
			}
			default:
				console.error(`Unknown command: ${cmd}`);
				printHelp();
				process.exit(1);
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		console.error(`[route-steps] ${msg}`);
		process.exit(1);
	}
}

void main();
