import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';

export interface EncryptedSecret {
  encryption_mode: 'kms' | 'local';
  ciphertext_b64: string;
  iv_b64?: string;
  tag_b64?: string;
  kms_key_name?: string;
}

const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform']
});

function toBase64(value: Uint8Array): string {
  return Buffer.from(value).toString('base64');
}

function fromBase64(value: string): Buffer {
  return Buffer.from(value, 'base64');
}

async function callKmsEncrypt(keyName: string, plaintext: Buffer): Promise<Buffer> {
  const url = `https://cloudkms.googleapis.com/v1/${keyName}:encrypt`;
  const client = await auth.getClient();
  const headers = await client.getRequestHeaders(url);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      plaintext: plaintext.toString('base64')
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`KMS encrypt failed (${response.status}): ${text}`);
  }

  const body = (await response.json()) as { ciphertext?: string };
  if (!body.ciphertext) {
    throw new Error('KMS encrypt response missing ciphertext');
  }

  return fromBase64(body.ciphertext);
}

async function callKmsDecrypt(keyName: string, ciphertext: Buffer): Promise<Buffer> {
  const url = `https://cloudkms.googleapis.com/v1/${keyName}:decrypt`;
  const client = await auth.getClient();
  const headers = await client.getRequestHeaders(url);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ciphertext: ciphertext.toString('base64')
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`KMS decrypt failed (${response.status}): ${text}`);
  }

  const body = (await response.json()) as { plaintext?: string };
  if (!body.plaintext) {
    throw new Error('KMS decrypt response missing plaintext');
  }

  return fromBase64(body.plaintext);
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
  const kmsKeyName = process.env.BYOK_KMS_KEY_NAME?.trim();
  if (kmsKeyName) {
    const ciphertext = await callKmsEncrypt(kmsKeyName, Buffer.from(plaintext, 'utf8'));
    return {
      encryption_mode: 'kms',
      ciphertext_b64: toBase64(ciphertext),
      kms_key_name: kmsKeyName
    };
  }

  return encryptLocal(plaintext);
}

export async function decryptByokSecret(secret: EncryptedSecret): Promise<string> {
  if (secret.encryption_mode === 'kms') {
    const keyName = secret.kms_key_name?.trim() || process.env.BYOK_KMS_KEY_NAME?.trim();
    if (!keyName) {
      throw new Error('BYOK KMS payload missing key name and BYOK_KMS_KEY_NAME is unset');
    }
    const plaintext = await callKmsDecrypt(keyName, fromBase64(secret.ciphertext_b64));
    return plaintext.toString('utf8');
  }

  return decryptLocal(secret);
}
