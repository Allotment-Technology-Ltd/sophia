import type { BillingProfile, FounderOfferProfile } from './types';

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export const FOUNDER_PROGRAM_ID = (process.env.FOUNDER_PROGRAM_ID ?? 'founder-launch-2026').trim();
export const FOUNDER_OFFER_LIMIT = parsePositiveInt(process.env.FOUNDER_OFFER_LIMIT, 50);
export const FOUNDER_PREMIUM_MONTHS = parsePositiveInt(process.env.FOUNDER_PREMIUM_MONTHS, 12);
export const FOUNDER_BONUS_CENTS = parsePositiveInt(process.env.FOUNDER_BONUS_CENTS, 1000);

export interface FounderOfferSummary {
  programId: string;
  slot: number;
  grantedAt: string;
  expiresAt: string;
  bonusWalletCents: number;
  noticePending: boolean;
  noticeSeenAt: string | null;
  active: boolean;
  limit: number;
  premiumMonths: number;
}

function parseIso(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function parseSlot(value: unknown): number | null {
  if (!Number.isFinite(value)) return null;
  const slot = Math.floor(Number(value));
  if (slot <= 0) return null;
  return slot;
}

export function normalizeFounderOffer(input: unknown): FounderOfferProfile | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  const programId =
    typeof obj.program_id === 'string' && obj.program_id.trim().length > 0
      ? obj.program_id.trim()
      : FOUNDER_PROGRAM_ID;
  const slot = parseSlot(obj.slot);
  const grantedAt = parseIso(obj.granted_at);
  const expiresAt = parseIso(obj.expires_at);
  const bonusWalletCents = Number.isFinite(obj.bonus_wallet_cents)
    ? Math.max(0, Math.floor(Number(obj.bonus_wallet_cents)))
    : FOUNDER_BONUS_CENTS;
  const noticePending = obj.notice_pending === false ? false : true;
  const noticeSeenAt = parseIso(obj.notice_seen_at);

  if (!slot || !grantedAt || !expiresAt) return null;

  return {
    program_id: programId,
    slot,
    granted_at: grantedAt,
    expires_at: expiresAt,
    bonus_wallet_cents: bonusWalletCents,
    notice_pending: noticePending,
    notice_seen_at: noticeSeenAt
  };
}

export function addMonthsIso(now: Date, months: number): string {
  const next = new Date(now);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next.toISOString();
}

export function founderOfferSummaryFromProfile(
  profile: BillingProfile | null | undefined,
  now = new Date()
): FounderOfferSummary | null {
  const founderOffer = normalizeFounderOffer(profile?.founder_offer);
  if (!founderOffer) return null;

  const expiresAtMs = Date.parse(founderOffer.expires_at);
  const active = Number.isFinite(expiresAtMs) ? expiresAtMs > now.getTime() : false;

  return {
    programId: founderOffer.program_id,
    slot: founderOffer.slot,
    grantedAt: founderOffer.granted_at,
    expiresAt: founderOffer.expires_at,
    bonusWalletCents: founderOffer.bonus_wallet_cents,
    noticePending: founderOffer.notice_pending !== false,
    noticeSeenAt: founderOffer.notice_seen_at ?? null,
    active,
    limit: FOUNDER_OFFER_LIMIT,
    premiumMonths: FOUNDER_PREMIUM_MONTHS
  };
}

export function founderOfferEligible(profile: BillingProfile): boolean {
  const existing = normalizeFounderOffer(profile.founder_offer);
  if (existing) return false;
  if (profile.tier !== 'free') return false;
  if (typeof profile.paddle_subscription_id === 'string' && profile.paddle_subscription_id.trim().length > 0) {
    return false;
  }
  return true;
}
