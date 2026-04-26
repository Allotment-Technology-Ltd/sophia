/**
 * Restormel MCP + AAIF setup status helper.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/restormel/setup-status.ts
 */

import * as fs from 'fs';

type Status = 'ok' | 'missing' | 'warn';

function envStatus(name: string, required = false): { name: string; status: Status; required: boolean } {
	const value = process.env[name]?.trim();
	if (value) return { name, status: 'ok', required };
	return { name, status: required ? 'missing' : 'warn', required };
}

function pretty(label: string, status: Status, detail: string): string {
	const icon = status === 'ok' ? 'OK ' : status === 'missing' ? '!! ' : '-- ';
	return `${icon}${label}: ${detail}`;
}

function main(): void {
	let packageJson: { dependencies?: Record<string, string> } | null = null;
	let mcpConfig: { mcpServers?: Record<string, unknown> } | null = null;
	try {
		packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8')) as {
			dependencies?: Record<string, string>;
		};
	} catch {
		packageJson = null;
	}
	try {
		mcpConfig = JSON.parse(fs.readFileSync('.cursor/mcp.json', 'utf-8')) as {
			mcpServers?: Record<string, unknown>;
		};
	} catch {
		mcpConfig = null;
	}

	const mcpServers = mcpConfig?.mcpServers ?? {};
	const hasMcp = Object.prototype.hasOwnProperty.call(mcpServers, 'restormel');
	const hasAaifDependency = Boolean(packageJson?.dependencies?.['@restormel/aaif']);
	const hasAaifRoute = fs.existsSync('src/routes/api/beta/aaif/+server.ts');
	const hasAaifRuntime = fs.existsSync('src/lib/server/aaif/runtime.ts');

	const envChecks = [
		envStatus('RESTORMEL_GATEWAY_KEY', true),
		envStatus('RESTORMEL_PROJECT_ID', true),
		envStatus('RESTORMEL_ENVIRONMENT_ID', true),
		envStatus('RESTORMEL_KEYS_BASE', true),
		envStatus('RESTORMEL_EVALUATE_URL', true),
		envStatus('GITHUB_PAT', false)
	];

	const status = {
		restormelMcp: {
			configured: hasMcp,
			configPath: '.cursor/mcp.json',
			runCommand: 'pnpm mcp:restormel'
		},
		aaif: {
			packageConfigured: hasAaifDependency,
			routeConfigured: hasAaifRoute,
			runtimeConfigured: hasAaifRuntime,
			endpoint: 'POST /api/beta/aaif'
		},
		env: envChecks
	};

	console.log('Restormel MCP + AAIF setup status\n');
	console.log(pretty('MCP config file', mcpConfig ? 'ok' : 'missing', '.cursor/mcp.json'));
	console.log(pretty('Restormel MCP server entry', hasMcp ? 'ok' : 'missing', hasMcp ? 'present' : 'missing'));
	console.log(pretty('AAIF dependency', hasAaifDependency ? 'ok' : 'missing', '@restormel/aaif'));
	console.log(pretty('AAIF route', hasAaifRoute ? 'ok' : 'missing', 'src/routes/api/beta/aaif/+server.ts'));
	console.log(pretty('AAIF runtime', hasAaifRuntime ? 'ok' : 'missing', 'src/lib/server/aaif/runtime.ts'));
	console.log('');
	console.log('Environment readiness:');
	for (const env of envChecks) {
		const detail = env.required ? '(required)' : '(optional)';
		console.log(pretty(`  ${env.name}`, env.status, detail));
	}

	console.log('\nQuick commands:');
	console.log('  pnpm restormel:setup:status        # this report');
	console.log('  pnpm mcp:restormel                 # run Restormel MCP stdio server');
	console.log('  pnpm smoke:restormel:mcp           # verify MCP tool surface');
	console.log('  pnpm smoke:restormel               # resolve + policy + doctor/validate');
	console.log('  curl -X POST http://localhost:5173/api/beta/aaif -H "Content-Type: application/json" -H "x-api-key: <key>" -d \'{"task":"chat","input":"Test"}\'');

	console.log('\nJSON summary:\n');
	console.log(JSON.stringify(status, null, 2));
}

main();
