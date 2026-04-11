import { describe, expect, it } from 'vitest';
import { buildIngestCatalogModelChainForStage } from './ingestCatalogRouting';
import type { ModelSurfacesStored } from './modelSurfaces';
import type { CatalogSurfaceRow } from './restormelCatalogRows';

function row(
  providerType: string,
  modelId: string,
  overrides: Partial<CatalogSurfaceRow> = {}
): CatalogSurfaceRow {
  return {
    providerType,
    modelId,
    isEmbedding: false,
    catalogUsable: true,
    detailsSufficient: true,
    eligibleForSurfaces: true,
    raw: { label: `${providerType} ${modelId}` },
    ...overrides
  };
}

describe('buildIngestCatalogModelChainForStage', () => {
  it('orders cheaper / capable models before expensive when both allowed for extraction', () => {
    const surfaces: ModelSurfacesStored = {
      operationsMode: 'default',
      userQueriesMode: 'default',
      surfaceAssignments: {
        'openai::gpt-4o-mini': 'ingestion_only',
        'openai::gpt-4o': 'ingestion_only',
        'vertex::gemini-3.1-pro-preview': 'ingestion_only'
      }
    };
    const rows: CatalogSurfaceRow[] = [
      row('openai', 'gpt-4o'),
      row('openai', 'gpt-4o-mini'),
      row('vertex', 'gemini-3.1-pro-preview')
    ];
    const chain = buildIngestCatalogModelChainForStage('extraction', rows, surfaces);
    const ids = chain.map((c) => c.modelId);
    expect(ids[0]).toBe('gpt-4o-mini');
    expect(ids).toContain('gpt-4o');
    expect(ids).toContain('gemini-3.1-pro-preview');
  });

  it('excludes models marked off in surfaces', () => {
    const surfaces: ModelSurfacesStored = {
      operationsMode: 'default',
      userQueriesMode: 'default',
      surfaceAssignments: {
        'openai::gpt-4o-mini': 'ingestion_only',
        'openai::gpt-4o': 'off'
      }
    };
    const rows: CatalogSurfaceRow[] = [row('openai', 'gpt-4o-mini'), row('openai', 'gpt-4o')];
    const chain = buildIngestCatalogModelChainForStage('extraction', rows, surfaces);
    expect(chain.every((c) => c.modelId !== 'gpt-4o')).toBe(true);
    expect(chain.some((c) => c.modelId === 'gpt-4o-mini')).toBe(true);
  });

  it('skips embedding rows', () => {
    const surfaces: ModelSurfacesStored = {
      operationsMode: 'default',
      userQueriesMode: 'default',
      surfaceAssignments: {
        'voyage::voyage-3-large': 'embeddings_only',
        'openai::gpt-4o-mini': 'ingestion_only'
      }
    };
    const rows: CatalogSurfaceRow[] = [
      row('voyage', 'voyage-3-large', { isEmbedding: true }),
      row('openai', 'gpt-4o-mini')
    ];
    const chain = buildIngestCatalogModelChainForStage('extraction', rows, surfaces);
    expect(chain.every((c) => !c.modelId.includes('voyage'))).toBe(true);
  });
});
