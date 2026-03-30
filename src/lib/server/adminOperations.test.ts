import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/sophiaDocumentsDb', () => ({
  sophiaDocumentsDb: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        set: vi.fn(),
        get: vi.fn()
      })),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      get: vi.fn()
    }))
  }
}));

vi.mock('$lib/server/db', () => ({
  query: vi.fn()
}));
import { AdminOperationRequestSchema } from './adminOperations';

describe('AdminOperationRequestSchema', () => {
  it('accepts ingest_import with source_url and source_type', () => {
    const parsed = AdminOperationRequestSchema.parse({
      kind: 'ingest_import',
      payload: {
        source_url: 'https://plato.stanford.edu/entries/ethics-deontological/',
        source_type: 'sep_entry',
        restormel_ingest_route_id: 'route-shared-1',
        validate: true
      }
    });

    expect(parsed.kind).toBe('ingest_import');
    if (parsed.kind !== 'ingest_import') {
      throw new Error('Expected ingest_import payload');
    }
    expect(parsed.payload.source_type).toBe('sep_entry');
    expect(parsed.payload.restormel_ingest_route_id).toBe('route-shared-1');
  });

  it('rejects ingest_import source_url without source_type', () => {
    expect(() =>
      AdminOperationRequestSchema.parse({
        kind: 'ingest_import',
        payload: {
          source_url: 'https://plato.stanford.edu/entries/ethics-deontological/'
        }
      })
    ).toThrow(/source_type is required/);
  });

  it('rejects sync_to_surreal without a locator', () => {
    expect(() =>
      AdminOperationRequestSchema.parse({
        kind: 'sync_to_surreal',
        payload: {
          require_claims: true
        }
      })
    ).toThrow(/source_url or canonical_url_hash is required/);
  });
});
