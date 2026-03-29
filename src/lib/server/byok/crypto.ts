import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export interface EncryptedSecret {
  encryption_mode: 'kms' | 'local';
  ciphertext_b64: string;
  iv_b64?: string;
  tag_b64?: string;
  kms_key_name?: string;
}

function toBase64(value: Uint8Array): string {
  return Buffer.from(value).toString('base64');
}

function fromBase64(value: string): Buffer {
  return Buffer.from(value, 'base64');
}


function getLocalEncryptionKey(): Buffer {
  const configured = process.env.BYOK_LOCAL_ENCRYPTION_KEY?.trim();
  if (configured) {
    // Accept raw text, hex, or base64 and normalize to a 32-byte key via sha256.
    return createHash('sha256').update(configured).digest();
  }

  const fallbackSeed =
    process.env.API_KEY_HASH_SECRET?.trim() ||
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    'sophia-byok-local-fallback';
  return createHash('sha256').update(fallbackSeed).digest();
}

function encryptLocal(plaintext: string): EncryptedSecret {
  const iv = randomBytes(12);
  const key = getLocalEncryptionKey();
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    encryption_mode: 'local',
    ciphertext_b64: toBase64(ciphertext),
    iv_b64: toBase64(iv),
    tag_b64: toBase64(tag)
  };
}

function decryptLocal(secret: EncryptedSecret): string {
  if (!secret.iv_b64 || !secret.tag_b64) {
    throw new Error('Invalid local BYOK payload: missing iv/tag');
  }

  const key = getLocalEncryptionKey();
  const decipher = createDecipheriv('aes-256-gcm', key, fromBase64(secret.iv_b64));
  decipher.setAuthTag(fromBase64(secret.tag_b64));
  const plaintext = Buffer.concat([
    decipher.update(fromBase64(secret.ciphertext_b64)),
    decipher.final()
  ]);
  return plaintext.toString('utf8');
}

export async function encryptByokSecret(plaintext: string): Promise<EncryptedSecret> {
  return encryptLocal(plaintext);
}

export async function decryptByokSecret(secret: EncryptedSecret): Promise<string> {
  if (secret.encryption_mode === 'kms') {
    throw new Error(
      'Legacy BYOK payload uses Cloud KMS encryption. Re-encrypt credentials with scripts/byok-reencrypt-kms-to-local.ts before loading.'
    );
  }

  return decryptLocal(secret);
}
