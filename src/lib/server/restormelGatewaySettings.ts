import { eq } from 'drizzle-orm';
import { decryptByokSecret, encryptByokSecret, type EncryptedSecret } from './byok/crypto.js';
import { adminRestormelGateway } from './db/schema.js';
import { getDrizzleDb } from './db/neon.js';

const ROW_ID = 'default';

function fingerprintLast4(key: string): string {
  const t = key.trim();
  if (t.length === 0) return '';
  if (t.length <= 4) return '****';
  return t.slice(-4);
}

export type RestormelGatewayDbState =
  | { status: 'unconfigured' }
  | { status: 'unavailable'; message: string }
  | { status: 'no_row' }
  | { status: 'empty_ciphertext' }
  | { status: 'ok'; key: string }
  | { status: 'decrypt_failed'; message: string };

/**
 * Distinguish DB/connection issues (caller may fall back to env) from a row that exists but
 * cannot be decrypted (env must not silently override a broken stored key).
 */
export async function loadRestormelGatewayDatabaseState(): Promise<RestormelGatewayDbState> {
  if (!process.env.DATABASE_URL?.trim()) return { status: 'unconfigured' };

  let row: typeof adminRestormelGateway.$inferSelect | undefined;
  try {
    const db = getDrizzleDb();
    [row] = await db
      .select()
      .from(adminRestormelGateway)
      .where(eq(adminRestormelGateway.id, ROW_ID))
      .limit(1);
  } catch (e) {
    return {
      status: 'unavailable',
      message: e instanceof Error ? e.message : String(e)
    };
  }

  if (!row?.gatewayKeyEncrypted) return { status: 'no_row' };

  try {
    const plain = await decryptByokSecret(row.gatewayKeyEncrypted as unknown as EncryptedSecret);
    const trimmed = plain.trim();
    if (trimmed.length === 0) return { status: 'empty_ciphertext' };
    return { status: 'ok', key: trimmed };
  } catch (e) {
    return {
      status: 'decrypt_failed',
      message: e instanceof Error ? e.message : String(e)
    };
  }
}

/**
 * Returns the decrypted key when a usable row exists; otherwise `null` for callers that may
 * fall back to `RESTORMEL_GATEWAY_KEY`. Throws if ciphertext exists but decrypt failed — the
 * deployment should fix BYOK/encryption (or clear the row), not run with a mismatched env key.
 */
export async function getStoredRestormelGatewayKeyOverride(): Promise<string | null> {
  const state = await loadRestormelGatewayDatabaseState();
  if (state.status === 'ok') return state.key;
  if (state.status === 'decrypt_failed' || state.status === 'empty_ciphertext') {
    const detail =
      state.status === 'empty_ciphertext'
        ? 'Stored Restormel gateway key decrypted to an empty value.'
        : state.message;
    throw new Error(
      'Restormel gateway key in Neon (admin_restormel_gateway) is present but not usable. ' +
        'Check BYOK / `BYOK_ENCRYPTION_KEY` (or local secrets) for this host, re-save the key in admin, or clear the row. ' +
        `Details: ${detail}`
    );
  }
  return null;
}

export type RestormelGatewayKeySource = 'database' | 'environment' | 'none';

export interface RestormelGatewayConnectionSummary {
  source: RestormelGatewayKeySource;
  /** Last four characters of the effective key, for display only. */
  last4: string | null;
  /** True when either DB or env supplies a key. */
  configured: boolean;
  /** True when a DB row holds ciphertext (override path active when decrypt succeeds). */
  hasDatabaseRow: boolean;
  /** Ciphertext is stored but could not be decrypted. Admin Restormel calls will fail until fixed. */
  storageDecryptFailed: boolean;
  storageDecryptError: string | null;
  /** Database was unreachable or the query failed; effective key may come from env only. */
  databaseReadFailed: boolean;
  /**
   * Set when a broken stored key blocks the gateway: `RESTORMEL_GATEWAY_KEY` exists in env but
   * is not used until storage is fixed or cleared (avoids a silent project/key mismatch).
   */
  ignoredEnvironmentKeyLast4: string | null;
}

export async function getRestormelGatewayConnectionSummary(
  envGatewayKey: string
): Promise<RestormelGatewayConnectionSummary> {
  const envTrim = envGatewayKey.trim();
  const state = await loadRestormelGatewayDatabaseState();
  const hasCiphertextRow =
    state.status === 'ok' ||
    state.status === 'decrypt_failed' ||
    state.status === 'empty_ciphertext';

  if (state.status === 'unavailable') {
    return {
      source: envTrim ? 'environment' : 'none',
      last4: envTrim ? fingerprintLast4(envTrim) : null,
      configured: Boolean(envTrim),
      hasDatabaseRow: false,
      storageDecryptFailed: false,
      storageDecryptError: null,
      databaseReadFailed: true,
      ignoredEnvironmentKeyLast4: null
    };
  }

  if (state.status === 'ok') {
    return {
      source: 'database',
      last4: fingerprintLast4(state.key),
      configured: true,
      hasDatabaseRow: true,
      storageDecryptFailed: false,
      storageDecryptError: null,
      databaseReadFailed: false,
      ignoredEnvironmentKeyLast4: null
    };
  }

  if (state.status === 'decrypt_failed' || state.status === 'empty_ciphertext') {
    const errMsg =
      state.status === 'decrypt_failed' ? state.message : 'Stored value was empty after decrypt';
    return {
      source: 'none',
      last4: null,
      configured: false,
      hasDatabaseRow: hasCiphertextRow,
      storageDecryptFailed: true,
      storageDecryptError: errMsg,
      databaseReadFailed: false,
      ignoredEnvironmentKeyLast4: envTrim ? fingerprintLast4(envTrim) : null
    };
  }

  if (state.status === 'unconfigured' || state.status === 'no_row') {
    if (envTrim) {
      return {
        source: 'environment',
        last4: fingerprintLast4(envTrim),
        configured: true,
        hasDatabaseRow: false,
        storageDecryptFailed: false,
        storageDecryptError: null,
        databaseReadFailed: false,
        ignoredEnvironmentKeyLast4: null
      };
    }
    return {
      source: 'none',
      last4: null,
      configured: false,
      hasDatabaseRow: false,
      storageDecryptFailed: false,
      storageDecryptError: null,
      databaseReadFailed: false,
      ignoredEnvironmentKeyLast4: null
    };
  }

  const unhandled: never = state;
  return unhandled;
}

export async function upsertRestormelGatewayKey(gatewayKey: string, updatedByUid: string): Promise<void> {
  const db = getDrizzleDb();
  const trimmed = gatewayKey.trim();
  if (!trimmed) {
    throw new Error('Gateway key cannot be empty');
  }
  const enc = await encryptByokSecret(trimmed);
  await db
    .insert(adminRestormelGateway)
    .values({
      id: ROW_ID,
      gatewayKeyEncrypted: enc as unknown as Record<string, unknown>,
      updatedByUid: updatedByUid
    })
    .onConflictDoUpdate({
      target: adminRestormelGateway.id,
      set: {
        gatewayKeyEncrypted: enc as unknown as Record<string, unknown>,
        updatedAt: new Date(),
        updatedByUid: updatedByUid
      }
    });
}

export async function clearRestormelGatewayKey(): Promise<void> {
  const db = getDrizzleDb();
  await db.delete(adminRestormelGateway).where(eq(adminRestormelGateway.id, ROW_ID));
}
