import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ShortReviewRequestSchema, countWords } from '$lib/types/learn';
import {
  isLearnModuleEnabled,
  learnModuleDisabledResponse,
  requireUid,
  unauthorizedResponse
} from '$lib/server/learn/http';
import { generateShortAnswerReview, resolveRequestedProvider } from '$lib/server/learn/pipeline';
import {
  createEssaySubmission,
  createEssayVersion,
  isLessonCompleted,
  markLessonCompleted,
  updateEssaySubmission
} from '$lib/server/learn/store';
import { loadByokProviderApiKeys } from '$lib/server/byok/store';
import { hasOwnerRole } from '$lib/server/authRoles';
import { consumeLearnEntitlement } from '$lib/server/learn/entitlements';
import { getLessonById } from '$lib/server/learn/content';
import { formatWordRange, resolveShortReviewWordRange } from '$lib/utils/learnWordRange';

const LEGACY_SHORT_REVIEW_RANGE = { min: 20, max: 220 };

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!isLearnModuleEnabled()) return learnModuleDisabledResponse();
  const uid = requireUid(locals);
  if (!uid) return unauthorizedResponse();
  const learnQuotaBypass = hasOwnerRole(locals.user);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = ShortReviewRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid_request', detail: parsed.error.flatten() }, { status: 400 });
  }

  const lesson = parsed.data.lesson_id ? await getLessonById(parsed.data.lesson_id).catch(() => null) : null;
  const targetWordRange = lesson ? resolveShortReviewWordRange(lesson) : LEGACY_SHORT_REVIEW_RANGE;
  const wordCount = countWords(parsed.data.response_text);
  if (wordCount < targetWordRange.min || wordCount > targetWordRange.max) {
    return json(
      {
        error: `response_text must be between ${formatWordRange(targetWordRange)} words`,
        target_word_range: targetWordRange
      },
      { status: 400 }
    );
  }

  let lessonQuotaSummary: Awaited<ReturnType<typeof consumeLearnEntitlement>>['summary'] | null = null;
  if (parsed.data.lesson_id) {
    const alreadyCompleted = await isLessonCompleted(uid, parsed.data.lesson_id);
    if (!alreadyCompleted) {
      const lessonQuota = await consumeLearnEntitlement(uid, 'micro_lesson', {
        bypassQuota: learnQuotaBypass
      });
      if (!lessonQuota.allowed) {
        return json(
          {
            error: lessonQuota.reason,
            learn_entitlements: lessonQuota.summary
          },
          { status: 402 }
        );
      }
      lessonQuotaSummary = lessonQuota.summary;
    }
  }

  const reviewQuota = await consumeLearnEntitlement(uid, 'short_review', {
    bypassQuota: learnQuotaBypass
  });
  if (!reviewQuota.allowed) {
    return json(
      {
        error: reviewQuota.reason,
        learn_entitlements: reviewQuota.summary
      },
      { status: 402 }
    );
  }
  const providerApiKeys = await loadByokProviderApiKeys(uid).catch(() => ({}));

  const review = await generateShortAnswerReview(parsed.data.question, parsed.data.response_text, {
    providerApiKeys,
    modelProvider: resolveRequestedProvider(parsed.data.model_provider),
    modelId: parsed.data.model_id,
    depthMode: parsed.data.depth
  });

  const submission = await createEssaySubmission({
    uid,
    type: 'short_answer',
    question: parsed.data.question,
    text: parsed.data.response_text,
    wordCount,
    lessonId: parsed.data.lesson_id
  });

  await createEssayVersion({
    uid,
    submissionId: submission.id,
    versionNumber: 1,
    question: parsed.data.question,
    text: parsed.data.response_text,
    wordCount,
    shortReview: review
  });

  const scaledScore = Math.round((review.micro_score / 10) * 100);
  await updateEssaySubmission(uid, submission.id, {
    summary_score: scaledScore,
    dimension_scores: {
      clarity: scaledScore,
      coherence: scaledScore,
      critique_depth: scaledScore,
      originality: scaledScore
    }
  });

  if (parsed.data.lesson_id) {
    await markLessonCompleted(uid, parsed.data.lesson_id);
  }

  return json({
    submission_id: submission.id,
    word_count: wordCount,
    review,
    learn_entitlements: lessonQuotaSummary ?? reviewQuota.summary
  });
};
