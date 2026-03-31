import { json, type RequestHandler } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { embedText } from '$lib/server/embeddings';
import type {
  ArrivalReason,
  StartingPath,
  StoaProfile
} from '$lib/types/stoa';
import {
  createStoaProfile,
  getStoaProfile,
  updateStoaProfile
} from '$lib/server/stoa/profile-store';

function isArrivalReason(value: unknown): value is ArrivalReason {
  return (
    value === 'seeking_peace' ||
    value === 'seeking_direction' ||
    value === 'carrying_burden' ||
    value === 'uncertain'
  );
}

function isStartingPath(value: unknown): value is StartingPath {
  return value === 'garden' || value === 'colonnade' || value === 'sea_terrace';
}

export const GET: RequestHandler = async ({ locals }) => {
  const uid = locals.user?.uid;
  // Anonymous visitors: treat as "no profile" so the client can show onboarding without a 401 loop.
  if (!uid) {
    return json(null);
  }
  const profile = await getStoaProfile(uid);
  return json(profile);
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const uid = locals.user?.uid;
  if (!uid) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return json({ error: 'Invalid profile payload' }, { status: 400 });
  }

  const rawArrivalReason = (body as Record<string, unknown>).arrivalReason;
  const rawStartingPath = (body as Record<string, unknown>).startingPath;
  const rawOpeningStruggle = (body as Record<string, unknown>).openingStruggle;

  if (!isArrivalReason(rawArrivalReason) || !isStartingPath(rawStartingPath)) {
    return json({ error: 'Invalid arrival reason or starting path' }, { status: 400 });
  }

  const openingStruggle =
    typeof rawOpeningStruggle === 'string' && rawOpeningStruggle.trim().length > 0
      ? rawOpeningStruggle.trim()
      : null;

  let openingStruggleEmbedding: number[] | null = null;
  if (openingStruggle) {
    openingStruggleEmbedding = await embedText(openingStruggle).catch(() => null);
  }

  const profile = await createStoaProfile(uid, {
    arrivalReason: rawArrivalReason,
    startingPath: rawStartingPath,
    openingStruggle,
    openingStruggleEmbedding,
    firstSessionId: randomUUID()
  });

  return json({ profile, isNewStudent: true });
};

export const PATCH: RequestHandler = async ({ locals, request }) => {
  const uid = locals.user?.uid;
  if (!uid) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return json({ error: 'Invalid profile payload' }, { status: 400 });
  }

  const unsafeKeys = new Set(['userId', 'createdAt']);
  const updates = Object.fromEntries(
    Object.entries(body as Record<string, unknown>).filter(([key]) => !unsafeKeys.has(key))
  ) as Partial<StoaProfile>;

  const profile = await updateStoaProfile(uid, updates);
  return json(profile);
};

