import { eq } from 'drizzle-orm';
import { decryptByokSecret, encryptByokSecret, type EncryptedSecret } from '$lib/server/byok/crypto';
import { adminRestormelGateway } from '$lib/server/db/schema';
import { getDrizzleDb } from '$lib/server/db/neon';

const ROW_ID = 'default';

function fingerprintLast4(key: string): string {
  const t = key.trim();
  if (t.length === 0) return '';
  if (t.length <= 4) return '****';
  return t.slice(-4);
}

/** Decrypted gateway key when a DB row stores one; `null` means use env / no override. */
export async function getStoredRestormelGatewayKeyOverride(): Promise<string | null> {
  if (!process.env.DATABASE_URL?.trim()) return null;
  try {
    const db = getDrizzleDb();
    const [row] = await db
      .select()
      .from(adminRestormelGateway)
      .where(eq(adminRestormelGateway.id, ROW_ID))
      .limit(1);
    if (!row?.gatewayKeyEncrypted) return null;
    const plain = await decryptByokSecret(row.gatewayKeyEncrypted as unknown as EncryptedSecret);
    const trimmed = plain.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
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
}

export async function getRestormelGatewayConnectionSummary(
  envGatewayKey: string
): Promise<RestormelGatewayConnectionSummary> {
  const envTrim = envGatewayKey.trim();
  let hasDatabaseRow = false;
  let override: string | null = null;

  if (process.env.DATABASE_URL?.trim()) {
    try {
      const db = getDrizzleDb();
      const [row] = await db
        .select()
        .from(adminRestormelGateway)
        .where(eq(adminRestormelGateway.id, ROW_ID))
        .limit(1);
      hasDatabaseRow = Boolean(row?.gatewayKeyEncrypted);
      if (row?.gatewayKeyEncrypted) {
        try {
          const plain = await decryptByokSecret(row.gatewayKeyEncrypted as unknown as EncryptedSecret);
          override = plain.trim() || null;
        } catch {
          override = null;
        }
      }
    } catch {
      hasDatabaseRow = false;
    }
  }

  if (override) {
    return {
      source: 'database',
      last4: fingerprintLast4(override),
      configured: true,
      hasDatabaseRow
    };
  }
  if (envTrim) {
    return {
      source: 'environment',
      last4: fingerprintLast4(envTrim),
      configured: true,
      hasDatabaseRow
    };
  }
  return {
    source: 'none',
    last4: null,
    configured: false,
    hasDatabaseRow
  };
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
