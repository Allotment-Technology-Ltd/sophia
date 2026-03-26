import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  EssayFeedbackSchema,
  EssayReviseRequestSchema,
  countWords
} from '$lib/types/learn';
import {
  isLearnModuleEnabled,
  learnModuleDisabledResponse,
  requireUid,
  unauthorizedResponse
} from '$lib/server/learn/http';
import { generateEssayRevision, resolveRequestedProvider } from '$lib/server/learn/pipeline';
import {
  createEssayVersion,
  getEssaySubmission,
  getLatestEssayVersion,
  updateEssaySubmission
} from '$lib/server/learn/store';
import { loadInquiryEffectiveProviderApiKeys } from '$lib/server/byok/effectiveKeys';
import { hasOwnerRole } from '$lib/server/authRoles';
import { consumeLearnEntitlement } from '$lib/server/learn/entitlements';

export const POST: RequestHandler = async ({ request, params, locals }) => {
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

  const parsed = EssayReviseRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid_request', detail: parsed.error.flatten() }, { status: 400 });
  }

  const submission = await getEssaySubmission(uid, params.id);
  if (!submission) {
    return json({ error: 'submission_not_found' }, { status: 404 });
  }

  const wordCount = countWords(parsed.data.revised_text);
  if (wordCount < 100 || wordCount > 2000) {
    return json({ error: 'revised_text must be between 100 and 2000 words' }, { status: 400 });
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

  const latest = await getLatestEssayVersion(uid, params.id);
  const priorFeedback = latest?.feedback ? EssayFeedbackSchema.safeParse(latest.feedback) : null;

  const providerApiKeys = await loadInquiryEffectiveProviderApiKeys(
    locals.user,
    'learn essay revise route'
  );

  const question = parsed.data.question ?? String(submission.question ?? '');
  const feedback = await generateEssayRevision(
    question,
    parsed.data.revised_text,
    priorFeedback?.success ? priorFeedback.data : null,
    {
      providerApiKeys,
      modelProvider: resolveRequestedProvider(parsed.data.model_provider),
      modelId: parsed.data.model_id,
      depthMode: parsed.data.depth
    }
  );

  const nextVersion = Math.max(1, Number(submission.latest_version ?? 1) + 1);

  await createEssayVersion({
    uid,
    submissionId: params.id,
    versionNumber: nextVersion,
    question,
    text: parsed.data.revised_text,
    wordCount,
    feedback
  });

  await updateEssaySubmission(uid, params.id, {
    latest_version: nextVersion,
    text: parsed.data.revised_text,
    word_count: wordCount,
    summary_score: feedback.summary_score,
    dimension_scores: feedback.dimension_scores
  });

  return json({
    submission_id: params.id,
    version_number: nextVersion,
    word_count: wordCount,
    feedback,
    learn_entitlements: essayQuota.summary,
    used_scholar_credit: essayQuota.usedScholarCredit === true
  });
};
