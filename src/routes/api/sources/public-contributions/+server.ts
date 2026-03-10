import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { query as dbQuery } from '$lib/server/db';

type PublicContributionRow = {
  id: string;
  title?: string;
  url?: string;
  source_type?: string;
  status?: string;
  claim_count?: number;
  created_at?: string;
  ingested_at?: string;
  updated_at?: string;
};

export const GET: RequestHandler = async ({ locals }) => {
  const uid = locals.user?.uid;
  if (!uid) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  const rows = await dbQuery<PublicContributionRow[]>(
    `SELECT id, title, url, source_type, status, claim_count, created_at, ingested_at, updated_at
     FROM source
     WHERE visibility_scope = 'public_shared'
       AND contributor_uid = $uid
       AND (deletion_state = NONE OR deletion_state = 'active')
     ORDER BY updated_at DESC`,
    { uid }
  );

  return json({
    sources: Array.isArray(rows) ? rows : []
  });
};
