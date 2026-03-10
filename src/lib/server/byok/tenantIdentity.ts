import { createHmac, timingSafeEqual } from 'node:crypto';

interface TenantIdentityResolution {
  ownerUid: string | undefined;
  source: 'api_key_owner' | 'signed_header';
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const left = Buffer.from(a, 'hex');
    const right = Buffer.from(b, 'hex');
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function validateTimestamp(ts: string): boolean {
  const timestampMs = Number(ts);
  if (!Number.isFinite(timestampMs)) return false;
  const skewMs = Math.abs(Date.now() - timestampMs);
  return skewMs <= 5 * 60 * 1000;
}

export function resolveByokOwnerUid(
  request: Request,
  fallbackOwnerUid: string | undefined
): TenantIdentityResolution {
  const headerUid = request.headers.get('x-sophia-tenant-uid')?.trim();
  const headerTs = request.headers.get('x-sophia-tenant-ts')?.trim();
  const headerSig = request.headers.get('x-sophia-tenant-sig')?.trim();
  const secret = process.env.ZUPLO_TENANT_SIGNING_SECRET?.trim();

  if (!headerUid || !headerTs || !headerSig || !secret) {
    return {
      ownerUid: fallbackOwnerUid,
      source: 'api_key_owner'
    };
  }

  if (!validateTimestamp(headerTs)) {
    return {
      ownerUid: fallbackOwnerUid,
      source: 'api_key_owner'
    };
  }

  const payload = `${headerUid}.${headerTs}`;
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  const valid = safeEqualHex(expected, headerSig.toLowerCase());

  if (!valid) {
    return {
      ownerUid: fallbackOwnerUid,
      source: 'api_key_owner'
    };
  }

  return {
    ownerUid: headerUid,
    source: 'signed_header'
  };
}
