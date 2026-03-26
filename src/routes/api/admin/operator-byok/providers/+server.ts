import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { emptyNotConfiguredByokStatuses, listByokProviderStatuses } from '$lib/server/byok/store';
import { getOperatorByokTargetSummary } from '$lib/server/byok/operatorByokTarget';
import { problemJson, resolveRequestId } from '$lib/server/problem';

export const GET: RequestHandler = async ({ locals, request }) => {
  assertAdminAccess(locals);
  const requestId = resolveRequestId(request);
  const { targetUid, configuredCount } = getOperatorByokTargetSummary();

  if (!targetUid) {
    return problemJson({
      status: 503,
      title: 'Operator BYOK target not configured',
      detail:
        'Set OWNER_UIDS in the environment to a comma-separated list of Firebase UIDs. Keys are stored on the first UID’s Firestore user document (users/{uid}/byokProviders).',
      requestId
    });
  }

  try {
    const providers = await listByokProviderStatuses(targetUid);
    return json(
      {
        targetUid,
        ownerUidsConfigured: configuredCount,
        providers,
        precedenceNote:
          'These keys are used as fallback for admin/owner inquiry flows and for API routes when tenant keys are empty (see OWNER_UIDS).'
      },
      { headers: { 'X-Request-Id': requestId } }
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[admin/operator-byok] list failed:', detail);
    return json(
      {
        targetUid,
        ownerUidsConfigured: configuredCount,
        providers: emptyNotConfiguredByokStatuses(),
        degraded: true,
        detail:
          'Could not load operator BYOK from Firestore. Check credentials and that the target UID exists.'
      },
      { status: 200, headers: { 'X-Request-Id': requestId } }
    );
  }
};
