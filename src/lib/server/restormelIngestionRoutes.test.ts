import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockListRoutes = vi.fn();

vi.mock('./restormel.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./restormel.js')>();
  return {
    ...mod,
    restormelListRoutes: (...args: Parameters<typeof mod.restormelListRoutes>) =>
      mockListRoutes(...args)
  };
});

describe('discoverIngestionRouteBinding', () => {
  beforeEach(async () => {
    mockListRoutes.mockReset();
    const { __resetIngestionRouteListCacheForTests } = await import('./restormelIngestionRoutes.js');
    __resetIngestionRouteListCacheForTests();
  });

  afterEach(async () => {
    const { __resetIngestionRouteListCacheForTests } = await import('./restormelIngestionRoutes.js');
    __resetIngestionRouteListCacheForTests();
  });

  it('matches dedicated route by workload + stage', async () => {
    mockListRoutes.mockResolvedValue({
      data: [
        {
          id: 'route-dedicated-extract',
          enabled: true,
          publishedVersion: 1,
          workload: 'ingestion',
          stage: 'ingestion_extraction'
        }
      ]
    });
    const { discoverIngestionRouteBinding } = await import('./restormelIngestionRoutes.js');
    const r = await discoverIngestionRouteBinding('extraction');
    expect(r).toEqual({ routeId: 'route-dedicated-extract', mode: 'dedicated' });
    expect(mockListRoutes).toHaveBeenCalledWith(
      expect.objectContaining({
        environmentId: expect.any(String),
        workload: 'ingestion'
      })
    );
  });

  it('matches shared route when stage is empty', async () => {
    mockListRoutes.mockResolvedValue({
      data: [
        {
          id: 'route-shared',
          enabled: true,
          publishedVersion: 1,
          workload: 'ingestion',
          stage: null
        }
      ]
    });
    const { discoverIngestionRouteBinding } = await import('./restormelIngestionRoutes.js');
    const r = await discoverIngestionRouteBinding('relations');
    expect(r).toEqual({ routeId: 'route-shared', mode: 'shared' });
  });

  it('prefers dedicated over shared when both exist', async () => {
    mockListRoutes.mockResolvedValue({
      data: [
        {
          id: 'shared-1',
          enabled: true,
          publishedVersion: 1,
          workload: 'ingestion',
          stage: ''
        },
        {
          id: 'dedicated-rel',
          enabled: true,
          publishedVersion: 1,
          workload: 'ingestion',
          stage: 'ingestion_relations'
        }
      ]
    });
    const { discoverIngestionRouteBinding } = await import('./restormelIngestionRoutes.js');
    const r = await discoverIngestionRouteBinding('relations');
    expect(r).toEqual({ routeId: 'dedicated-rel', mode: 'dedicated' });
  });

  it('returns none when list is empty', async () => {
    mockListRoutes.mockResolvedValue({ data: [] });
    const { discoverIngestionRouteBinding } = await import('./restormelIngestionRoutes.js');
    const r = await discoverIngestionRouteBinding('grouping');
    expect(r).toEqual({ mode: 'none' });
  });
});
