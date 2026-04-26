import { eq } from 'drizzle-orm';
import { decryptByokSecret, encryptByokSecret, type EncryptedSecret } from './byok/crypto.js';
import { adminAppAiDefaults } from './db/schema.js';
import { getDrizzleDb } from './db/neon.js';
import { isReasoningProvider, type ReasoningProvider } from '@restormel/contracts/providers';

const ROW_ID = 'default';
const CACHE_TTL_MS = 60_000;

export interface AppAiDefaultsRow {
  defaultRestormelSharedRouteId: string | null;
  degradedPrimaryProvider: ReasoningProvider | null;
  degradedReasoningModelStandard: string | null;
  degradedReasoningModelDeep: string | null;
  degradedExtractionModel: string | null;
  /** Decrypted when row holds ciphertext; null when absent or decrypt fails. */
  defaultOpenaiApiKey: string | null;
  hasOpenaiCiphertext: boolean;
}

const emptyRow: AppAiDefaultsRow = {
  defaultRestormelSharedRouteId: null,
  degradedPrimaryProvider: null,
  degradedReasoningModelStandard: null,
  degradedReasoningModelDeep: null,
  degradedExtractionModel: null,
  defaultOpenaiApiKey: null,
  hasOpenaiCiphertext: false
};

let cache: { at: number; row: AppAiDefaultsRow } | null = null;

/** Sync mirror of last loaded Neon default OpenAI key (for `vertex.getPlatformApiKey` without async). */
let neonDefaultOpenAiKeySync: string | undefined;

let degradedSync: {
  primary: ReasoningProvider | null;
  reasoningStd: string | null;
  reasoningDeep: string | null;
  extraction: string | null;
} = {
  primary: null,
  reasoningStd: null,
  reasoningDeep: null,
  extraction: null
};

export function invalidateAppAiDefaultsCache(): void {
  cache = null;
  neonDefaultOpenAiKeySync = undefined;
  degradedSync = { primary: null, reasoningStd: null, reasoningDeep: null, extraction: null };
}

/** Prefer this over `process.env.OPENAI_API_KEY` when set (see `getPlatformApiKey` in vertex). */
export function getNeonDefaultOpenAiApiKeySync(): string | undefined {
  return neonDefaultOpenAiKeySync;
}

export function getDegradedPrimaryProviderOverride(): ReasoningProvider | null {
  return degradedSync.primary;
}

export function getDegradedModelOverride(
  kind: 'extraction' | 'reasoning_standard' | 'reasoning_deep'
): string | undefined {
  if (kind === 'extraction') return degradedSync.extraction?.trim() || undefined;
  if (kind === 'reasoning_standard') return degradedSync.reasoningStd?.trim() || undefined;
  return degradedSync.reasoningDeep?.trim() || undefined;
}

function fingerprintLast4(key: string): string {
  const t = key.trim();
  if (t.length === 0) return '';
  if (t.length <= 4) return '****';
  return t.slice(-4);
}

async function loadRowFromDb(): Promise<AppAiDefaultsRow> {
  if (!process.env.DATABASE_URL?.trim()) {
    return { ...emptyRow };
  }
  try {
    const db = getDrizzleDb();
    const [row] = await db
      .select()
      .from(adminAppAiDefaults)
      .where(eq(adminAppAiDefaults.id, ROW_ID))
      .limit(1);
    if (!row) return { ...emptyRow };

    const route = row.defaultRestormelSharedRouteId?.trim() || null;
    const pRaw = row.degradedPrimaryProvider?.trim().toLowerCase() || '';
    const degradedPrimaryProvider =
      pRaw && isReasoningProvider(pRaw) ? (pRaw as ReasoningProvider) : null;

    let defaultOpenaiApiKey: string | null = null;
    const hasOpenaiCiphertext = Boolean(row.defaultOpenaiApiKeyEncrypted);
    if (row.defaultOpenaiApiKeyEncrypted) {
      try {
        const plain = await decryptByokSecret(row.defaultOpenaiApiKeyEncrypted as unknown as EncryptedSecret);
        const t = plain.trim();
        defaultOpenaiApiKey = t.length > 0 ? t : null;
      } catch {
        defaultOpenaiApiKey = null;
      }
    }

    return {
      defaultRestormelSharedRouteId: route,
      degradedPrimaryProvider,
      degradedReasoningModelStandard: row.degradedReasoningModelStandard?.trim() || null,
      degradedReasoningModelDeep: row.degradedReasoningModelDeep?.trim() || null,
      degradedExtractionModel: row.degradedExtractionModel?.trim() || null,
      defaultOpenaiApiKey,
      hasOpenaiCiphertext
    };
  } catch {
    return { ...emptyRow };
  }
}

/** Cached defaults for routing + vertex (60s). */
export async function getAppAiDefaults(): Promise<AppAiDefaultsRow> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return cache.row;
  }
  const row = await loadRowFromDb();
  neonDefaultOpenAiKeySync = row.defaultOpenaiApiKey?.trim() || undefined;
  degradedSync = {
    primary: row.degradedPrimaryProvider,
    reasoningStd: row.degradedReasoningModelStandard,
    reasoningDeep: row.degradedReasoningModelDeep,
    extraction: row.degradedExtractionModel
  };
  cache = { at: now, row };
  return row;
}

/**
 * Best-effort refresh on each request (TTL-bounded). Keeps `getAppAiDefaults()` warm for server routes.
 */
export async function refreshAppAiDefaultsCacheIfStale(): Promise<void> {
  await getAppAiDefaults();
}

/** Summary for admin UI (no secrets). */
export async function getAppAiDefaultsAdminSummary(): Promise<{
  databaseAvailable: boolean;
  defaultRestormelSharedRouteId: string | null;
  degradedPrimaryProvider: string | null;
  degradedReasoningModelStandard: string | null;
  degradedReasoningModelDeep: string | null;
  degradedExtractionModel: string | null;
  defaultOpenaiKeyConfigured: boolean;
  defaultOpenaiKeyLast4: string | null;
  openaiDecryptFailed: boolean;
}> {
  const row = await getAppAiDefaults();
  return {
    databaseAvailable: Boolean(process.env.DATABASE_URL?.trim()),
    defaultRestormelSharedRouteId: row.defaultRestormelSharedRouteId,
    degradedPrimaryProvider: row.degradedPrimaryProvider,
    degradedReasoningModelStandard: row.degradedReasoningModelStandard,
    degradedReasoningModelDeep: row.degradedReasoningModelDeep,
    degradedExtractionModel: row.degradedExtractionModel,
    defaultOpenaiKeyConfigured: Boolean(row.defaultOpenaiApiKey),
    defaultOpenaiKeyLast4: row.defaultOpenaiApiKey ? fingerprintLast4(row.defaultOpenaiApiKey) : null,
    openaiDecryptFailed: row.hasOpenaiCiphertext && !row.defaultOpenaiApiKey
  };
}

export async function upsertAppAiDefaults(options: {
  defaultRestormelSharedRouteId?: string | null;
  degradedPrimaryProvider?: string | null;
  degradedReasoningModelStandard?: string | null;
  degradedReasoningModelDeep?: string | null;
  degradedExtractionModel?: string | null;
  defaultOpenaiApiKey?: string | null;
  clearDefaultOpenaiApiKey?: boolean;
  updatedByUid: string;
}): Promise<void> {
  const db = getDrizzleDb();
  const current = await loadRowFromDb();

  const nextRoute =
    options.defaultRestormelSharedRouteId !== undefined
      ? options.defaultRestormelSharedRouteId?.trim() || null
      : current.defaultRestormelSharedRouteId;

  const nextDegP =
    options.degradedPrimaryProvider !== undefined
      ? options.degradedPrimaryProvider?.trim().toLowerCase() || null
      : current.degradedPrimaryProvider;
  if (nextDegP && !isReasoningProvider(nextDegP)) {
    throw new Error(`degradedPrimaryProvider must be a known ReasoningProvider, got "${nextDegP}"`);
  }

  const nextStd =
    options.degradedReasoningModelStandard !== undefined
      ? options.degradedReasoningModelStandard?.trim() || null
      : current.degradedReasoningModelStandard;
  const nextDeep =
    options.degradedReasoningModelDeep !== undefined
      ? options.degradedReasoningModelDeep?.trim() || null
      : current.degradedReasoningModelDeep;
  const nextExt =
    options.degradedExtractionModel !== undefined
      ? options.degradedExtractionModel?.trim() || null
      : current.degradedExtractionModel;

  let encFinal: Record<string, unknown> | null;
  if (options.clearDefaultOpenaiApiKey) {
    encFinal = null;
  } else if (typeof options.defaultOpenaiApiKey === 'string' && options.defaultOpenaiApiKey.trim()) {
    encFinal = (await encryptByokSecret(options.defaultOpenaiApiKey.trim())) as unknown as Record<
      string,
      unknown
    >;
  } else {
    const [existing] = await db
      .select({ defaultOpenaiApiKeyEncrypted: adminAppAiDefaults.defaultOpenaiApiKeyEncrypted })
      .from(adminAppAiDefaults)
      .where(eq(adminAppAiDefaults.id, ROW_ID))
      .limit(1);
    encFinal = (existing?.defaultOpenaiApiKeyEncrypted as Record<string, unknown> | null) ?? null;
  }

  await db
    .insert(adminAppAiDefaults)
    .values({
      id: ROW_ID,
      defaultRestormelSharedRouteId: nextRoute,
      degradedPrimaryProvider: nextDegP,
      degradedReasoningModelStandard: nextStd,
      degradedReasoningModelDeep: nextDeep,
      degradedExtractionModel: nextExt,
      defaultOpenaiApiKeyEncrypted: encFinal,
      updatedByUid: options.updatedByUid
    })
    .onConflictDoUpdate({
      target: adminAppAiDefaults.id,
      set: {
        defaultRestormelSharedRouteId: nextRoute,
        degradedPrimaryProvider: nextDegP,
        degradedReasoningModelStandard: nextStd,
        degradedReasoningModelDeep: nextDeep,
        degradedExtractionModel: nextExt,
        defaultOpenaiApiKeyEncrypted: encFinal,
        updatedAt: new Date(),
        updatedByUid: options.updatedByUid
      }
    });

  invalidateAppAiDefaultsCache();
}
