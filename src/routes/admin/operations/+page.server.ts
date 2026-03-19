import type { PageServerLoad } from './$types';
import {
  ADMIN_OPERATION_KINDS,
} from '$lib/server/adminOperations';

const PAYLOAD_TEMPLATES: Record<string, string> = {
  ingest_import: JSON.stringify(
    {
      source_url: 'https://plato.stanford.edu/entries/ethics-deontological/',
      source_type: 'sep_entry',
      validate: true,
      ingest_provider: 'vertex'
    },
    null,
    2
  ),
  validate: JSON.stringify(
    {
      scope: 'full',
      source_url: 'https://plato.stanford.edu/entries/ethics-deontological/'
    },
    null,
    2
  ),
  diagnose_doctor: JSON.stringify(
    {
      scope: 'full'
    },
    null,
    2
  ),
  replay_reingest: JSON.stringify(
    {
      canonical_url_hash: 'paste-canonical-url-hash-here',
      validate: true
    },
    null,
    2
  ),
  repair_finalize: JSON.stringify(
    {
      source_file: 'data/sources/example.txt',
      mode: 'local-then-migrate'
    },
    null,
    2
  ),
  sync_to_surreal: JSON.stringify(
    {
      canonical_url_hash: 'paste-canonical-url-hash-here',
      require_claims: true
    },
    null,
    2
  )
};

export const load: PageServerLoad = async ({ locals }) => {
  return {
    operationKinds: [...ADMIN_OPERATION_KINDS],
    payloadTemplates: PAYLOAD_TEMPLATES
  };
};
