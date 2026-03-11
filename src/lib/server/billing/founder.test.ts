import { describe, expect, it } from 'vitest';
import {
  founderOfferEligible,
  founderOfferSummaryFromProfile,
  normalizeFounderOffer
} from './founder';
import type { BillingProfile } from './types';

describe('founder billing helpers', () => {
  it('normalizes founder offer payloads', () => {
    const offer = normalizeFounderOffer({
      program_id: 'launch',
      slot: 4,
      granted_at: '2026-03-11T10:00:00.000Z',
      expires_at: '2027-03-11T10:00:00.000Z',
      bonus_wallet_cents: 1000
    });

    expect(offer).not.toBeNull();
    expect(offer?.program_id).toBe('launch');
    expect(offer?.slot).toBe(4);
    expect(offer?.notice_pending).toBe(true);
  });

  it('reports founder offer activity from profile', () => {
    const profile: BillingProfile = {
      tier: 'premium',
      status: 'active',
      currency: 'GBP',
      founder_offer: {
        program_id: 'launch',
        slot: 1,
        granted_at: '2026-03-11T10:00:00.000Z',
        expires_at: '2027-03-11T10:00:00.000Z',
        bonus_wallet_cents: 1000,
        notice_pending: false
      }
    };

    const summary = founderOfferSummaryFromProfile(profile, new Date('2026-08-01T00:00:00.000Z'));
    expect(summary?.active).toBe(true);
    expect(summary?.slot).toBe(1);
  });

  it('only marks free accounts without founder or subscription as eligible', () => {
    const freeProfile: BillingProfile = {
      tier: 'free',
      status: 'active',
      currency: 'GBP'
    };
    const paidProfile: BillingProfile = {
      tier: 'premium',
      status: 'active',
      currency: 'GBP'
    };
    const founderProfile: BillingProfile = {
      tier: 'premium',
      status: 'active',
      currency: 'GBP',
      founder_offer: {
        program_id: 'launch',
        slot: 2,
        granted_at: '2026-03-11T10:00:00.000Z',
        expires_at: '2027-03-11T10:00:00.000Z',
        bonus_wallet_cents: 1000,
        notice_pending: true
      }
    };

    expect(founderOfferEligible(freeProfile)).toBe(true);
    expect(founderOfferEligible(paidProfile)).toBe(false);
    expect(founderOfferEligible(founderProfile)).toBe(false);
  });
});
