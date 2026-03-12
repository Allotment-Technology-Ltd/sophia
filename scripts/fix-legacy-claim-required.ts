import { Buffer } from 'node:buffer';

function baseUrl(): string {
  const raw = process.env.SURREAL_URL || 'http://localhost:8800';
  return raw.replace(/^ws:\/\//i, 'http://').replace(/^wss:\/\//i, 'https://').replace(/\/rpc\/?$/, '').replace(/\/sql\/?$/, '').replace(/\/$/, '');
}
function authHeader(): string {
  const user = process.env.SURREAL_USER || 'root';
  const pass = process.env.SURREAL_PASS || 'root';
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}
function ns(): string { return process.env.SURREAL_NAMESPACE || 'sophia'; }
function dbName(): string { return process.env.SURREAL_DATABASE || 'sophia'; }

async function queryRows<T = Record<string, unknown>>(sql: string, vars: Record<string, unknown> = {}): Promise<T[]> {
  const sets = Object.entries(vars).map(([k,v]) => `LET $${k} = ${JSON.stringify(v)};`).join(' ');
  const res = await fetch(`${baseUrl()}/sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      Accept: 'application/json',
      Authorization: authHeader(),
      'surreal-ns': ns(),
      'surreal-db': dbName()
    },
    body: `${sets} ${sql}`
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = await res.json() as Array<{status:string;result?:unknown;detail?:string}>;
  const last = payload[payload.length - 1];
  if (!last || last.status !== 'OK') throw new Error(last?.detail || 'Query failed');
  return Array.isArray(last.result) ? (last.result as T[]) : [];
}

async function countMissing(): Promise<number> {
  const r = await queryRows<{count:number}>("SELECT count() AS count FROM claim WHERE claim_origin = NONE GROUP ALL");
  return Number(r[0]?.count || 0);
}

async function main() {
  const batchSize = Number(process.env.LEGACY_FIX_BATCH_SIZE || '300');
  let remaining = await countMissing();
  console.log(`[LEGACY-CLAIM-FIX] missing claim_origin rows: ${remaining}`);
  let batch = 0;
  while (remaining > 0) {
    batch += 1;
    await queryRows(
      `UPDATE (
         SELECT id
         FROM claim
         WHERE claim_origin = NONE
         ORDER BY id ASC
         LIMIT $limit
       )
       SET claim_origin = 'source_grounded',
           claim_scope = 'descriptive',
           review_state = 'candidate',
           verification_state = 'unverified'
       RETURN NONE`,
      { limit: batchSize }
    );
    remaining = await countMissing();
    console.log(`[LEGACY-CLAIM-FIX] batch=${batch} attempted=${batchSize} remaining=${remaining}`);
  }
  console.log('[LEGACY-CLAIM-FIX] done');
}

main().catch((error) => {
  console.error('[LEGACY-CLAIM-FIX] Fatal:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
