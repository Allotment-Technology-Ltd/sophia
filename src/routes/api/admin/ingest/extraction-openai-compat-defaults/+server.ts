import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertAdminAccess } from '$lib/server/adminAccess';
import { readExtractionOpenAiCompatibleOverride } from '$lib/server/vertex';

export const GET: RequestHandler = async ({ locals }) => {
  assertAdminAccess(locals);
  try {
    const o = readExtractionOpenAiCompatibleOverride();
    return json({
      ok: true,
      configured: Boolean(o),
      baseUrl: o?.baseURL ?? null,
      model: o?.modelId ?? null
    });
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed to read extraction defaults.' },
      { status: 500 }
    );
  }
};

