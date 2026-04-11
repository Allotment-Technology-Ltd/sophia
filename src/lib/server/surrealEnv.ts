/**
 * SurrealDB connection URL resolution for workers and scripts.
 *
 * Supports:
 * - **`SURREAL_URL`** — full RPC URL (preferred when set). `https://` is normalised to `wss://`; `/rpc` is appended when missing.
 * - **`SURREAL_INSTANCE` + `SURREAL_HOSTNAME`** — compose `wss://<instance>.<hostname>/rpc` when `SURREAL_URL` is unset (typical `.env.local` for Surreal Cloud).
 * - **`SURREAL_HOSTNAME` only** — `wss://<hostname>/rpc` (rare; use when the host is already fully qualified).
 *
 * Secrets stay in env files / Secret Manager — never committed.
 */

/** Normalise `http(s)://` → `ws(s)://` and ensure a `/rpc` suffix for WebSocket RPC clients. */
export function normalizeSurrealRpcUrl(raw: string): string {
	let u = raw.trim();
	if (!u) return 'ws://localhost:8000/rpc';
	u = u.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');
	if (!/\/rpc\/?$/i.test(u)) {
		u = `${u.replace(/\/$/, '')}/rpc`;
	}
	return u;
}

function stripProtoAndPath(host: string): string {
	const s = host
		.trim()
		.replace(/^wss?:\/\//i, '')
		.replace(/^https?:\/\//i, '')
		.replace(/\/rpc\/?$/i, '')
		.split('/')[0];
	return s ?? '';
}

/**
 * Effective WebSocket RPC URL. Order: `SURREAL_URL` → `SURREAL_INSTANCE`+`SURREAL_HOSTNAME` → hostname only → local default.
 */
export function resolveSurrealRpcUrl(): string {
	const direct = process.env.SURREAL_URL?.trim();
	if (direct) return normalizeSurrealRpcUrl(direct);

	const hostRaw = process.env.SURREAL_HOSTNAME?.trim();
	const instRaw = process.env.SURREAL_INSTANCE?.trim();
	if (hostRaw && instRaw) {
		const host = stripProtoAndPath(hostRaw);
		const inst = stripProtoAndPath(instRaw);
		return normalizeSurrealRpcUrl(`wss://${inst}.${host}`);
	}
	if (hostRaw) {
		return normalizeSurrealRpcUrl(`wss://${stripProtoAndPath(hostRaw)}`);
	}

	return normalizeSurrealRpcUrl('http://localhost:8000/rpc');
}

/** True when any Surreal target env is set (skip connecting when everything is blank). */
export function hasSurrealTargetEnv(): boolean {
	return Boolean(
		process.env.SURREAL_URL?.trim() ||
			process.env.SURREAL_HOSTNAME?.trim() ||
			process.env.SURREAL_INSTANCE?.trim()
	);
}
