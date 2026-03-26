import {
  REASONING_PROVIDER_PLATFORM_API_KEY_ENV,
  type ReasoningProvider
} from '@restormel/contracts/providers';
import { getOperatorByokTargetUid } from './operatorByokTarget';
import { loadByokProviderApiKeys } from './store';

/**
 * Maps operator BYOK (Firestore `users/{OWNER_UIDS[0]}/byokProviders`) into process.env
 * keys (`MISTRAL_API_KEY`, `OPENAI_API_KEY`, …) for the admin `scripts/ingest.ts` worker.
 *
 * This lets ingestion use the same keys as **Admin → Operator BYOK** without duplicating
 * them in Cloud Run Secret Manager.
 */
export async function buildOperatorByokProcessEnv(): Promise<Record<string, string>> {
  const uid = getOperatorByokTargetUid();
  if (!uid) return {};
  const keys = await loadByokProviderApiKeys(uid);
  const out: Record<string, string> = {};
  for (const [provider, key] of Object.entries(keys)) {
    if (!key?.trim()) continue;
    const envName = REASONING_PROVIDER_PLATFORM_API_KEY_ENV[provider as ReasoningProvider];
    if (envName) out[envName] = key.trim();
  }
  return out;
}
