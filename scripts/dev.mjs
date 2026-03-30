#!/usr/bin/env node
/**
 * Local dev entry: load `.env`, optional GCP ADC for Vertex/logging, then start Vite.
 * App data lives in Neon (`DATABASE_URL`); optional legacy Firestore migration scripts may still use a service account JSON.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

dotenv.config({ path: resolve(root, '.env') });
dotenv.config({ path: resolve(root, '.env.local') });

function resolveCredentialPath(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const abs = isAbsolute(trimmed) ? trimmed : resolve(root, trimmed);
  return existsSync(abs) ? abs : null;
}

/** Prefer explicit env; otherwise common local paths (never committed). */
const credentialCandidates = [
  () => resolveCredentialPath(process.env.GOOGLE_APPLICATION_CREDENTIALS),
  () => resolveCredentialPath(process.env.FIREBASE_SERVICE_ACCOUNT_JSON),
  () => resolveCredentialPath(process.env.FIREBASE_ADMIN_SDK_PATH),
  () => resolve(resolve(root, 'secrets/firebase-adminsdk.json')),
  () => resolve(resolve(root, 'secrets/google-application-credentials.json')),
  () => resolve(resolve(root, '.firebase/service-account.json'))
];

let resolved = null;
for (const tryPath of credentialCandidates) {
  const p = typeof tryPath === 'function' ? tryPath() : tryPath;
  if (p) {
    resolved = p;
    break;
  }
}

if (resolved) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = resolved;
  if (process.env.DEV_VERBOSE_FIREBASE === '1' || process.env.DEV_VERBOSE_FIREBASE === 'true') {
    console.info('[dev] GOOGLE_APPLICATION_CREDENTIALS →', resolved);
  }
} else if (!process.env.FIRESTORE_EMULATOR_HOST?.trim()) {
  console.info(
    '[dev] No GCP service account JSON found (Vertex ADC / legacy scripts only). For Neon-backed dev, set DATABASE_URL.\n' +
      '  Optional: secrets/google-application-credentials.json or GOOGLE_APPLICATION_CREDENTIALS in .env'
  );
}

function parseSurrealTarget() {
  const raw = (process.env.SURREAL_URL || '').trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const host = (parsed.hostname || '').toLowerCase();
  if (!host || !['localhost', '127.0.0.1', '::1'].includes(host)) {
    return null;
  }
  const port = Number(parsed.port || (parsed.protocol.startsWith('ws') ? 80 : 80));
  if (!Number.isFinite(port) || port <= 0) return null;
  return { host, port };
}

function parseAnySurrealTarget() {
  const raw = (process.env.SURREAL_URL || '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return {
      host: (parsed.hostname || '').toLowerCase(),
      port: Number(parsed.port || (parsed.protocol.startsWith('ws') ? 80 : 80))
    };
  } catch {
    return null;
  }
}

function parseSurrealUrlParts(raw) {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return {
      protocol: parsed.protocol,
      host: (parsed.hostname || '').toLowerCase(),
      port: Number(parsed.port || (parsed.protocol.startsWith('ws') ? 80 : 80)),
      path: parsed.pathname || '/rpc'
    };
  } catch {
    return null;
  }
}

function isLocalHost(host) {
  return ['localhost', '127.0.0.1', '::1'].includes((host || '').toLowerCase());
}

function parsePositiveIntEnv(name, fallback) {
  const raw = (process.env[name] || '').trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

async function listRunningComposeServices() {
  return await new Promise((resolvePromise) => {
    const child = spawn('docker', ['compose', 'ps', '--services', '--status', 'running'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf-8');
    });
    child.on('error', () => resolvePromise([]));
    child.on('close', (code) => {
      if (code !== 0) {
        if (stderr.trim()) {
          console.info(`[dev] docker compose ps unavailable: ${stderr.trim()}`);
        }
        resolvePromise([]);
        return;
      }
      const services = stdout
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      resolvePromise(services);
    });
  });
}

async function ensureSurrealTunnelIfConfigured() {
  const enabled = ['1', 'true', 'yes'].includes(
    (process.env.DEV_SURREAL_TUNNEL || '').trim().toLowerCase()
  );
  if (!enabled) return null;

  const target = parseSurrealUrlParts((process.env.SURREAL_URL || '').trim());
  if (!target?.host || !target.port) return null;
  if (isLocalHost(target.host)) return null;

  const instance = (process.env.DEV_SURREAL_TUNNEL_INSTANCE || '').trim();
  const zone = (process.env.DEV_SURREAL_TUNNEL_ZONE || '').trim();
  const project = (process.env.DEV_SURREAL_TUNNEL_PROJECT || process.env.GCP_PROJECT_ID || '').trim();
  const localPort = Number((process.env.DEV_SURREAL_TUNNEL_LOCAL_PORT || '8800').trim());
  if (!instance || !zone || !project || !Number.isFinite(localPort) || localPort <= 0) {
    console.warn(
      '[dev] DEV_SURREAL_TUNNEL enabled but tunnel vars are incomplete. Set DEV_SURREAL_TUNNEL_INSTANCE, DEV_SURREAL_TUNNEL_ZONE, DEV_SURREAL_TUNNEL_PROJECT.'
    );
    return null;
  }

  const alreadyOpen = await isPortOpen('127.0.0.1', localPort);
  if (alreadyOpen) {
    process.env.SURREAL_URL = `http://localhost:${localPort}${target.path}`;
    process.env.DEV_SURREAL_TUNNEL_ACTIVE = '1';
    process.env.DEV_SURREAL_TUNNEL_URL = process.env.SURREAL_URL;
    console.info(
      `[dev] Reusing existing Surreal tunnel on localhost:${localPort} -> ${target.host}:${target.port}`
    );
    return null;
  }

  const tunnelArgs = [
    'compute',
    'ssh',
    instance,
    `--zone=${zone}`,
    `--project=${project}`,
    '--',
    '-N',
    '-L',
    `${localPort}:${target.host}:${target.port}`
  ];
  console.info(
    `[dev] Starting Surreal tunnel localhost:${localPort} -> ${target.host}:${target.port} via ${instance}/${zone}...`
  );
  const tunnelReadyTimeoutMs = parsePositiveIntEnv('DEV_SURREAL_TUNNEL_READY_TIMEOUT_MS', 30000);
  const tunnelPollMs = parsePositiveIntEnv('DEV_SURREAL_TUNNEL_READY_POLL_MS', 500);
  const progressLogEveryMs = 3000;
  const tunnelChild = spawn('gcloud', tunnelArgs, {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  });
  let spawnFailed = false;
  let exited = false;
  let exitCode = null;
  let exitSignal = null;
  tunnelChild.on('error', (err) => {
    spawnFailed = true;
    console.warn(`[dev] Failed to start gcloud tunnel: ${err?.message || String(err)}`);
  });
  tunnelChild.on('exit', (code, signal) => {
    exited = true;
    exitCode = code;
    exitSignal = signal;
  });

  const startedAt = Date.now();
  let lastProgressLog = startedAt;
  while (Date.now() - startedAt < tunnelReadyTimeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const open = await isPortOpen('127.0.0.1', localPort);
    if (open) {
      process.env.SURREAL_URL = `http://localhost:${localPort}${target.path}`;
      process.env.DEV_SURREAL_TUNNEL_ACTIVE = '1';
      process.env.DEV_SURREAL_TUNNEL_URL = process.env.SURREAL_URL;
      console.info('[dev] Surreal tunnel is ready.');
      return tunnelChild;
    }
    if (exited) break;
    if (Date.now() - lastProgressLog >= progressLogEveryMs) {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      console.info(`[dev] Waiting for Surreal tunnel... (${elapsedSeconds}s elapsed)`);
      lastProgressLog = Date.now();
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, tunnelPollMs));
  }

  if (exited) {
    console.warn(
      `[dev] Surreal tunnel process exited before ready (code=${String(exitCode)}, signal=${String(exitSignal)}).`
    );
  } else if (!spawnFailed) {
    console.warn(
      `[dev] Surreal tunnel did not become ready within ${tunnelReadyTimeoutMs}ms; continuing without tunnel override.`
    );
  }
  return null;
}

async function guardAgainstSurrealTargetMismatch() {
  const target = parseAnySurrealTarget();
  if (!target?.host) return;
  const isLocalTarget = ['localhost', '127.0.0.1', '::1'].includes(target.host);
  if (isLocalTarget) return;

  const runningServices = await listRunningComposeServices();
  const hasLocalSurreal = runningServices.includes('surrealdb');
  if (!hasLocalSurreal) return;

  const allow = ['1', 'true', 'yes'].includes(
    (process.env.DEV_ALLOW_SURREAL_TARGET_MISMATCH || '').trim().toLowerCase()
  );
  if (allow) {
    console.warn(
      '[dev] WARNING: local docker `surrealdb` is running while SURREAL_URL points to non-local target.'
    );
    return;
  }

  console.error(
    '[dev] Refusing to start: local docker `surrealdb` is running but SURREAL_URL points to a non-local host.\n' +
      `      SURREAL_URL host: ${target.host}\n` +
      '      This can cause accidental environment confusion.\n' +
      '      Stop local surrealdb (`docker compose stop surrealdb`) or set DEV_ALLOW_SURREAL_TARGET_MISMATCH=1 to override.'
  );
  process.exit(1);
}

function isPortOpen(host, port) {
  return new Promise((resolvePromise) => {
    const socket = net.createConnection({ host, port });
    const done = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolvePromise(ok);
    };
    socket.setTimeout(700);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
  });
}

async function ensureLocalSurrealRunning() {
  const target = parseSurrealTarget();
  if (!target) return null;

  const alreadyRunning = await isPortOpen(target.host, target.port);
  if (alreadyRunning) return null;

  const surrealUser = (process.env.SURREAL_USER || 'root').trim();
  const surrealPass = (process.env.SURREAL_PASS || 'root').trim();
  const surrealStorage = (process.env.SURREAL_DEV_STORAGE || 'memory').trim();
  const extraArgs = (process.env.SURREAL_DEV_ARGS || '').trim();
  const args = ['start', '--bind', `${target.host}:${target.port}`, '--user', surrealUser, '--pass', surrealPass];
  if (extraArgs) args.push(...extraArgs.split(/\s+/).filter(Boolean));
  args.push(surrealStorage);

  console.info(`[dev] Starting local SurrealDB on ${target.host}:${target.port}...`);
  const child = spawn('surreal', args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  });
  let spawnFailed = false;
  let spawnErrCode = '';
  child.on('error', (err) => {
    spawnFailed = true;
    spawnErrCode = String(err?.code || '');
    if (err && err.code === 'ENOENT') {
      console.warn('[dev] `surreal` CLI not found in PATH. Trying Docker Compose fallback...');
    } else {
      console.warn(
        `[dev] Could not start SurrealDB automatically: ${err?.message || String(err)}`
      );
    }
  });

  // Give the process a brief moment to emit ENOENT spawn errors.
  await new Promise((r) => setTimeout(r, 75));
  if (spawnFailed || child.exitCode !== null) {
    if (spawnErrCode === 'ENOENT') {
      const dockerChild = await ensureSurrealViaDocker(target.host, target.port);
      return dockerChild;
    }
    return null;
  }
  let ready = false;
  for (let i = 0; i < 8; i++) {
    // eslint-disable-next-line no-await-in-loop
    ready = await isPortOpen(target.host, target.port);
    if (ready) break;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 350));
  }
  if (!ready) {
    console.warn(
      '[dev] SurrealDB did not become reachable. Ensure `surreal` CLI is installed or start your DB manually.'
    );
    return null;
  } else {
    console.info('[dev] SurrealDB is ready.');
  }

  return child;
}

async function ensureSurrealViaDocker(host, port) {
  const composeArgs = ['compose', 'up', '-d', 'surrealdb'];
  const docker = spawn('docker', composeArgs, {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  });
  let spawnFailed = false;
  docker.on('error', (err) => {
    spawnFailed = true;
    if (err && err.code === 'ENOENT') {
      console.warn(
        '[dev] Docker is not installed or not in PATH. Install Surreal CLI or run SurrealDB manually.'
      );
    } else {
      console.warn(`[dev] Docker compose startup failed: ${err?.message || String(err)}`);
    }
  });

  const composeExitCode = await new Promise((resolvePromise) => {
    docker.on('close', (code) => resolvePromise(code ?? 1));
  });
  if (spawnFailed || composeExitCode !== 0) return null;

  let ready = false;
  for (let i = 0; i < 10; i++) {
    // eslint-disable-next-line no-await-in-loop
    ready = await isPortOpen(host, port);
    if (ready) break;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 400));
  }
  if (!ready) {
    console.warn(
      '[dev] Docker started SurrealDB service but target port is not reachable yet.'
    );
    return null;
  }
  console.info('[dev] SurrealDB is ready via Docker Compose.');
  return null;
}

const viteEntry = resolve(root, 'node_modules/vite/bin/vite.js');
if (!existsSync(viteEntry)) {
  console.error('[dev] Missing vite. Run pnpm install from the repo root.');
  process.exit(1);
}

const surrealTunnelChild = await ensureSurrealTunnelIfConfigured();
await guardAgainstSurrealTargetMismatch();
const surrealChild = await ensureLocalSurrealRunning();
const viteChild = spawn(process.execPath, [viteEntry, 'dev'], {
	cwd: root,
	stdio: 'inherit',
	env: process.env
});

viteChild.on('exit', (code, signal) => {
	if (surrealChild && !surrealChild.killed) {
		surrealChild.kill('SIGTERM');
	}
	if (surrealTunnelChild && !surrealTunnelChild.killed) {
		surrealTunnelChild.kill('SIGTERM');
	}
	if (signal) process.kill(process.pid, signal);
	process.exit(code ?? 1);
});
