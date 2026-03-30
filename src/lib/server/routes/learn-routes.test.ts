import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mockListLessonsBySection: vi.fn(),
  mockGetLessonById: vi.fn(),
  mockGenerateShortAnswerReview: vi.fn(),
  mockGenerateEssayFeedback: vi.fn(),
  mockGenerateEssayRevision: vi.fn(),
  mockGenerateProgressRecommendation: vi.fn(),
  mockComputeSkills: vi.fn(),
  mockComputeTrajectory: vi.fn(),
  mockCreateEssaySubmission: vi.fn(),
  mockCreateEssayVersion: vi.fn(),
  mockIsLessonCompleted: vi.fn(),
  mockMarkLessonCompleted: vi.fn(),
  mockUpdateEssaySubmission: vi.fn(),
  mockGetEssaySubmission: vi.fn(),
  mockGetLatestEssayVersion: vi.fn(),
  mockListCompletedLessonIds: vi.fn(),
  mockListProgressEssays: vi.fn(),
  mockSaveProgressSnapshot: vi.fn(),
  mockLoadByokProviderApiKeys: vi.fn(),
  mockConsumeLearnEntitlement: vi.fn(),
  mockGetLearnEntitlementSummary: vi.fn()
}));

vi.mock('$lib/server/learn/content', () => ({
  listLessonsBySection: mocks.mockListLessonsBySection,
  getLessonById: mocks.mockGetLessonById
}));

vi.mock('$lib/server/learn/pipeline', () => ({
  generateShortAnswerReview: mocks.mockGenerateShortAnswerReview,
  generateEssayFeedback: mocks.mockGenerateEssayFeedback,
  generateEssayRevision: mocks.mockGenerateEssayRevision,
  generateProgressRecommendation: mocks.mockGenerateProgressRecommendation,
  computeSkillScoresFromHistory: mocks.mockComputeSkills,
  computeTrajectoryDelta: mocks.mockComputeTrajectory,
  resolveRequestedProvider: vi.fn(() => 'auto')
}));

vi.mock('$lib/server/learn/store', () => ({
  createEssaySubmission: mocks.mockCreateEssaySubmission,
  createEssayVersion: mocks.mockCreateEssayVersion,
  isLessonCompleted: mocks.mockIsLessonCompleted,
  markLessonCompleted: mocks.mockMarkLessonCompleted,
  updateEssaySubmission: mocks.mockUpdateEssaySubmission,
  getEssaySubmission: mocks.mockGetEssaySubmission,
  getLatestEssayVersion: mocks.mockGetLatestEssayVersion,
  listCompletedLessonIds: mocks.mockListCompletedLessonIds,
  listProgressEssays: mocks.mockListProgressEssays,
  saveProgressSnapshot: mocks.mockSaveProgressSnapshot
}));

vi.mock('$lib/server/byok/store', () => ({
  loadByokProviderApiKeys: mocks.mockLoadByokProviderApiKeys
}));

vi.mock('$lib/server/learn/entitlements', () => ({
  consumeLearnEntitlement: mocks.mockConsumeLearnEntitlement,
  getLearnEntitlementSummary: mocks.mockGetLearnEntitlementSummary
}));

import { GET as getLessons } from '../../../routes/api/learn/lessons/+server';
import { GET as getLessonById } from '../../../routes/api/learn/lessons/[id]/+server';
import { POST as postShortReview } from '../../../routes/api/learn/short-review/+server';
import { POST as postEssayReview } from '../../../routes/api/learn/essay/review/+server';
import { POST as postEssayRevise } from '../../../routes/api/learn/essay/[id]/revise/+server';
import { GET as getProgress } from '../../../routes/api/learn/progress/+server';
import { GET as getLearnEntitlements, POST as postLearnEntitlements } from '../../../routes/api/learn/entitlements/+server';

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

describe('Learn routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENABLE_LEARN_MODULE = 'true';

    mocks.mockListLessonsBySection.mockResolvedValue({ lessons: [{ id: 'ethics_intro_01' }], nextCursor: null });
    mocks.mockGetLessonById.mockResolvedValue({ id: 'ethics_intro_01' });
    mocks.mockGenerateShortAnswerReview.mockResolvedValue({
      analysis: 'a',
      critique: 'b',
      synthesis: 'c',
      micro_score: 7,
      encouragement: 'keep going'
    });
    mocks.mockGenerateEssayFeedback.mockResolvedValue({
      domain: 'ethics',
      analysis_summary: 'summary',
      critique_points: ['p1', 'p2'],
      synthesis_suggestions: 'suggestions',
      referenced_thinkers: ['Kant'],
      score_rationale: 'rationale',
      recommended_lessons: ['ethics_intro_02'],
      summary_score: 78,
      dimension_scores: {
        clarity: 77,
        coherence: 76,
        critique_depth: 75,
        originality: 74
      },
      pass_feedback: {
        analysis: 'analysis',
        critique: 'critique',
        synthesis: 'synthesis'
      }
    });
    mocks.mockGenerateEssayRevision.mockImplementation(mocks.mockGenerateEssayFeedback);
    mocks.mockGenerateProgressRecommendation.mockResolvedValue('Focus on counterarguments.');
    mocks.mockComputeSkills.mockReturnValue({
      clarity: 71,
      coherence: 72,
      critique_depth: 73,
      originality: 74
    });
    mocks.mockComputeTrajectory.mockReturnValue(6);
    mocks.mockCreateEssaySubmission.mockResolvedValue({ id: 'sub_1' });
    mocks.mockCreateEssayVersion.mockResolvedValue({ id: 'ver_1' });
    mocks.mockIsLessonCompleted.mockResolvedValue(false);
    mocks.mockGetEssaySubmission.mockResolvedValue({ id: 'sub_1', question: 'Q', latest_version: 1 });
    mocks.mockGetLatestEssayVersion.mockResolvedValue({ feedback: null });
    mocks.mockListCompletedLessonIds.mockResolvedValue(['ethics_intro_01']);
    mocks.mockListProgressEssays.mockResolvedValue([
      {
        id: 'sub_1',
        created_at: new Date().toISOString(),
        summary_score: 78,
        dimension_scores: {
          clarity: 77,
          coherence: 76,
          critique_depth: 75,
          originality: 74
        }
      }
    ]);
    mocks.mockLoadByokProviderApiKeys.mockResolvedValue({});
    mocks.mockConsumeLearnEntitlement.mockResolvedValue({
      allowed: true,
      summary: {
        tier: 'premium',
        monthKey: '2026-03',
        microLessonsUsed: 1,
        shortReviewsUsed: 1,
        essayReviewsUsed: 1,
        microLessonsRemaining: null,
        shortReviewsRemaining: null,
        essayReviewsRemaining: 9
      }
    });
    mocks.mockGetLearnEntitlementSummary.mockResolvedValue({
      tier: 'premium',
      monthKey: '2026-03',
      microLessonsUsed: 1,
      shortReviewsUsed: 1,
      essayReviewsUsed: 1,
      microLessonsRemaining: null,
      shortReviewsRemaining: null,
      essayReviewsRemaining: 9
    });
  });

  it('enforces auth on lessons route', async () => {
    const response = await getLessons({
      url: new URL('http://localhost/api/learn/lessons?section=daily'),
      locals: {}
    } as never);

    expect(response.status).toBe(401);
  });

  it('lists lessons for authenticated user', async () => {
    const response = await getLessons({
      url: new URL('http://localhost/api/learn/lessons?section=daily'),
      locals: { user: { uid: 'u1' } }
    } as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.lessons.length).toBeGreaterThan(0);
  });

  it('returns lesson by id', async () => {
    const response = await getLessonById({
      params: { id: 'ethics_intro_01' },
      locals: { user: { uid: 'u1' } }
    } as never);

    expect(response.status).toBe(200);
  });

  it('validates short review word count bounds', async () => {
    const response = await postShortReview({
      request: jsonRequest({ question: 'Q?', response_text: 'tiny response' }),
      locals: { user: { uid: 'u1' } }
    } as never);

    expect(response.status).toBe(400);
  });

  it('accepts essay review and returns feedback payload', async () => {
    const text = Array.from({ length: 120 }).map((_, i) => `word${i}`).join(' ');
    const response = await postEssayReview({
      request: jsonRequest({ question: 'Should justice prioritize equality?', text }),
      locals: { user: { uid: 'u1' } }
    } as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.feedback.summary_score).toBe(78);
  });

  it('revises existing essay and increments version', async () => {
    const revisedText = Array.from({ length: 130 }).map((_, i) => `revised${i}`).join(' ');
    const response = await postEssayRevise({
      params: { id: 'sub_1' },
      request: jsonRequest({ revised_text: revisedText, question: 'Revised prompt question' }),
      locals: { user: { uid: 'u1' } }
    } as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.version_number).toBe(2);
  });

  it('returns progress payload', async () => {
    const response = await getProgress({ locals: { user: { uid: 'u1' } } } as never);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.skills.clarity).toBe(71);
    expect(body.recommendation).toContain('counterarguments');
  });

  it('returns 404 when feature flag disabled', async () => {
    process.env.ENABLE_LEARN_MODULE = 'false';
    const response = await getProgress({ locals: { user: { uid: 'u1' } } } as never);
    expect(response.status).toBe(404);
  });

  it('returns learn entitlements summary', async () => {
    const response = await getLearnEntitlements({ locals: { user: { uid: 'u1' } } } as never);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.summary.tier).toBe('premium');
  });

  it('returns 410 for removed learn credit payment actions', async () => {
    const response = await postLearnEntitlements({
      locals: { user: { uid: 'u1' } },
      request: jsonRequest({ action: 'convert_wallet_to_scholar_credits', credits: 1 })
    } as never);

    expect(response.status).toBe(410);
    const body = await response.json();
    expect(body.error).toBe('learn_credit_payments_removed');
  });
});
