import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { query as dbQuery } from '$lib/server/db';

function toSourceThingId(rawId: string): string {
  if (rawId.startsWith('source:')) return rawId;
  return `source:${rawId}`;
}

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const uid = locals.user?.uid;
  if (!uid) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const sourceId = toSourceThingId(params.id);

    const existing = await dbQuery<Array<{ id: string }>>(
      `SELECT id
       FROM $source_id
       WHERE visibility_scope = 'private_user_only'
         AND owner_uid = $uid
         AND (deletion_state = NONE OR deletion_state = 'active')
       LIMIT 1`,
      {
        source_id: sourceId,
        uid
      }
    );

    if (!Array.isArray(existing) || existing.length === 0) {
      const visibilityCheck = await dbQuery<Array<{ id: string; visibility_scope?: string; owner_uid?: string }>>(
        `SELECT id, visibility_scope, owner_uid FROM $source_id LIMIT 1`,
        { source_id: sourceId }
      );
      const row = Array.isArray(visibilityCheck) && visibilityCheck.length > 0 ? visibilityCheck[0] : null;
      if (row?.visibility_scope === 'public_shared') {
        return json({ error: 'Public shared sources cannot be deleted by contributors.' }, { status: 403 });
      }
      return json({ error: 'Private source not found or not owned by caller' }, { status: 404 });
    }

    await dbQuery(
      `UPDATE $source_id SET deletion_state = 'deleted', updated_at = time::now()`,
      { source_id: sourceId }
    );

    // Hard-delete private graph records tied to this source.
    await dbQuery(
      `DELETE supports
       WHERE in IN (SELECT id FROM claim WHERE source = $source_id)
          OR out IN (SELECT id FROM claim WHERE source = $source_id)`,
      { source_id: sourceId }
    );
    await dbQuery(
      `DELETE contradicts
       WHERE in IN (SELECT id FROM claim WHERE source = $source_id)
          OR out IN (SELECT id FROM claim WHERE source = $source_id)`,
      { source_id: sourceId }
    );
    await dbQuery(
      `DELETE depends_on
       WHERE in IN (SELECT id FROM claim WHERE source = $source_id)
          OR out IN (SELECT id FROM claim WHERE source = $source_id)`,
      { source_id: sourceId }
    );
    await dbQuery(
      `DELETE responds_to
       WHERE in IN (SELECT id FROM claim WHERE source = $source_id)
          OR out IN (SELECT id FROM claim WHERE source = $source_id)`,
      { source_id: sourceId }
    );
    await dbQuery(
      `DELETE refines
       WHERE in IN (SELECT id FROM claim WHERE source = $source_id)
          OR out IN (SELECT id FROM claim WHERE source = $source_id)`,
      { source_id: sourceId }
    );
    await dbQuery(
      `DELETE exemplifies
       WHERE in IN (SELECT id FROM claim WHERE source = $source_id)
          OR out IN (SELECT id FROM claim WHERE source = $source_id)`,
      { source_id: sourceId }
    );
    await dbQuery(
      `DELETE part_of WHERE in IN (SELECT id FROM claim WHERE source = $source_id)`,
      { source_id: sourceId }
    );
    await dbQuery(`DELETE claim WHERE source = $source_id`, { source_id: sourceId });
    await dbQuery(`DELETE argument WHERE source = $source_id`, { source_id: sourceId });
    await dbQuery(`DELETE $source_id`, { source_id: sourceId });

    return json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[SOURCES] Private source delete failed:', message);
    return json(
      {
        error: 'source_delete_failed',
        detail: 'Unable to delete this private source right now.'
      },
      { status: 503 }
    );
  }
};
