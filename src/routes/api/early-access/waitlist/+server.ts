import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { earlyAccessWaitlist } from '$lib/server/db/schema';
import { getDrizzleDb } from '$lib/server/db/neon';

const MAX_EMAIL_LEN = 254;
const WINDOW_MS = 60_000;
const MAX_SUBMITS_PER_WINDOW = 5;

const ipBuckets = new Map<string, { count: number; windowStart: number }>();

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

function allowSubmit(ip: string): boolean {
  const now = Date.now();
  const bucket = ipBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    ipBuckets.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= MAX_SUBMITS_PER_WINDOW) return false;
  bucket.count += 1;
  return true;
}

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed.length > MAX_EMAIL_LEN) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

export const POST: RequestHandler = async ({ request }) => {
  const ip = clientIp(request);
  if (!allowSubmit(ip)) {
    return json({ error: 'Too many requests. Try again in a minute.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const email = normalizeEmail(record.email);
  if (!email) {
    return json({ error: 'Please enter a valid email address.' }, { status: 400 });
  }

  const sourcePath =
    typeof record.sourcePath === 'string' ? record.sourcePath.slice(0, 512) : null;
  const userAgent = request.headers.get('user-agent')?.slice(0, 512) ?? null;

  let db: ReturnType<typeof getDrizzleDb>;
  try {
    db = getDrizzleDb();
  } catch (err: unknown) {
    console.error('[early-access-waitlist] database unavailable:', err);
    return json(
      {
        error:
          'Waitlist signup is temporarily unavailable (database not configured). Please email admin@usesophia.app or try again later.'
      },
      { status: 503 }
    );
  }

  try {
    await db.insert(earlyAccessWaitlist).values({
      email,
      sourcePath,
      userAgent
    });
  } catch (err: unknown) {
    const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : '';
    if (code === '23505') {
      return json({ ok: true, alreadyRegistered: true });
    }
    console.error('[early-access-waitlist] insert failed:', err);
    return json({ error: 'Could not save your email right now. Please try again later.' }, { status: 500 });
  }

  return json({ ok: true, alreadyRegistered: false });
};
