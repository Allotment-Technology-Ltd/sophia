import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { EssayReviewRequestSchema, countWords } from '$lib/types/learn';
import {
  isLearnModuleEnabled,
  learnModuleDisabledResponse,
  requireUid,
  unauthorizedResponse
} from '$lib/server/learn/http';
import { generateEssayFeedback, resolveRequestedProvider } from '$lib/server/learn/pipeline';
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

  const parsed = EssayReviewRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid_request', detail: parsed.error.flatten() }, { status: 400 });
  }

  const wordCount = countWords(parsed.data.text);
  if (wordCount < 100 || wordCount > 2000) {
    return json({ error: 'Essay text must be between 100 and 2000 words' }, { status: 400 });
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

  const essayQuota = await consumeLearnEntitlement(uid, 'essay_review', {
    bypassQuota: learnQuotaBypass
  });
  if (!essayQuota.allowed) {
    return json(
      {
        error: essayQuota.reason,
        learn_entitlements: essayQuota.summary
      },
      { status: 402 }
    );
  }

  const providerApiKeys = await loadByokProviderApiKeys(uid).catch(() => ({}));

  const feedback = await generateEssayFeedback(parsed.data.question, parsed.data.text, {
    providerApiKeys,
    modelProvider: resolveRequestedProvider(parsed.data.model_provider),
    modelId: parsed.data.model_id,
    depthMode: parsed.data.depth
  });

  const submission = await createEssaySubmission({
    uid,
    type: 'essay',
    question: parsed.data.question,
    text: parsed.data.text,
    wordCount,
    lessonId: parsed.data.lesson_id
  });

  await createEssayVersion({
    uid,
    submissionId: submission.id,
    versionNumber: 1,
    question: parsed.data.question,
    text: parsed.data.text,
    wordCount,
    feedback
  });

  await updateEssaySubmission(uid, submission.id, {
    summary_score: feedback.summary_score,
    dimension_scores: feedback.dimension_scores
  });

  if (parsed.data.lesson_id) {
    await markLessonCompleted(uid, parsed.data.lesson_id);
  }

  return json({
    submission_id: submission.id,
    version_number: 1,
    word_count: wordCount,
    feedback,
    learn_entitlements: lessonQuotaSummary ?? essayQuota.summary,
    used_scholar_credit: essayQuota.usedScholarCredit === true
  });
};
