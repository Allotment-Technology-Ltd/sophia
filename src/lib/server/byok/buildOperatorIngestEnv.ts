import {
  REASONING_PROVIDER_PLATFORM_API_KEY_ENV,
  type ReasoningProvider
} from '@restormel/contracts/providers';
import { getAppAiDefaults } from '../appAiDefaults.js';
import { getOperatorByokTargetUid } from './operatorByokTarget';
import { loadByokProviderApiKeys } from './store';

function byokProviderToIngestEnvName(provider: string): string | undefined {
  if (provider === 'voyage') return 'VOYAGE_API_KEY';
  return REASONING_PROVIDER_PLATFORM_API_KEY_ENV[provider as ReasoningProvider];
}

function knownIngestPlatformApiKeyEnvNames(): string[] {
  const names = new Set<string>(
    Object.values(REASONING_PROVIDER_PLATFORM_API_KEY_ENV).filter(
      (n): n is string => typeof n === 'string' && n.length > 0
    )
  );
  names.add('VOYAGE_API_KEY');
  return [...names];
}

/**
 * After operator BYOK from `sophia_documents` is applied, fill missing provider keys from `process.env`
 * (e.g. `.env.local` for dev). Set `INGEST_PREFER_LOCAL_PROVIDER_KEYS=1` to use local env
 * whenever set, even when sophia_documents already has a value (prod keys not copied locally).
 */
function applyIngestProviderKeyResolution(out: Record<string, string>): void {
  const preferLocal = ['1', 'true', 'yes'].includes(
    (process.env.INGEST_PREFER_LOCAL_PROVIDER_KEYS ?? '').trim().toLowerCase()
  );
  for (const envName of knownIngestPlatformApiKeyEnvNames()) {
    const fromEnv = process.env[envName]?.trim();
    if (!fromEnv) continue;
    if (preferLocal || !out[envName]?.trim()) {
      out[envName] = fromEnv;
    }
  }
}

/**
 * Maps operator BYOK (`users/{OWNER_UIDS[0]}/byokProviders` in `sophia_documents`) into process.env
 * keys (`MISTRAL_API_KEY`, `OPENAI_API_KEY`, …) for the admin `scripts/ingest.ts` worker.
 *
 * This lets ingestion use the same keys as **Admin → Operator BYOK** without duplicating
 * them in Cloud Run Secret Manager.
 *
 * Local dev: keys in `.env` / `.env.local` are merged when the store has no value for that
 * provider, or always when `INGEST_PREFER_LOCAL_PROVIDER_KEYS=1`.
 */
export async function buildOperatorByokProcessEnv(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const uid = getOperatorByokTargetUid();
  if (uid) {
    // Ingestion validates provider reachability at call time. Include pending/invalid operator
    // keys so a stale validation status does not silently omit required worker env like VOYAGE_API_KEY.
    const keys = await loadByokProviderApiKeys(uid, { allowPending: true, allowInvalid: true });
    for (const [provider, key] of Object.entries(keys)) {
      if (!key?.trim()) continue;
      const envName = byokProviderToIngestEnvName(provider);
      if (envName) out[envName] = key.trim();
    }
  }
  if (!out.OPENAI_API_KEY?.trim()) {
    const defaults = await getAppAiDefaults();
    const neonOpenai = defaults.defaultOpenaiApiKey?.trim();
    if (neonOpenai) out.OPENAI_API_KEY = neonOpenai;
  }
  applyIngestProviderKeyResolution(out);
  return out;
}
