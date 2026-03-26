import { describe, expect, it } from 'vitest';

import { normalizeCatalogProviderForByok } from './filterCatalogEntriesByOperatorByok';

describe('normalizeCatalogProviderForByok', () => {
  it('maps google-style slugs to vertex', () => {
    expect(normalizeCatalogProviderForByok('google')).toBe('vertex');
    expect(normalizeCatalogProviderForByok('vertex')).toBe('vertex');
  });
});
