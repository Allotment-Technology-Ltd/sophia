import { describe, expect, it } from 'vitest';
import {
  listEnabledSharedRoutes,
  resolvePreferredSharedRoute,
  resolveRouteForStage,
  resolveStageRoutes
} from './ingestionRouting';

describe('ingestion routing helpers', () => {
  const routes = [
    { id: 'shared-a', name: 'Shared A', stage: null, enabled: true },
    { id: 'shared-b', name: 'Shared B', stage: null, enabled: true },
    { id: 'dedicated-relations', name: 'Relations', stage: 'ingestion_relations', enabled: true },
    { id: 'disabled-shared', name: 'Disabled', stage: null, enabled: false }
  ];

  it('lists only enabled shared routes', () => {
    expect(listEnabledSharedRoutes(routes).map((route) => route.id)).toEqual([
      'shared-a',
      'shared-b'
    ]);
  });

  it('prefers the requested shared route when it exists', () => {
    expect(resolvePreferredSharedRoute(routes, 'shared-b')?.id).toBe('shared-b');
  });

  it('falls back to the first enabled shared route when no preferred route exists', () => {
    expect(resolvePreferredSharedRoute(routes, 'missing')?.id).toBe('shared-a');
  });

  it('uses the preferred shared route for stages without dedicated coverage', () => {
    expect(resolveRouteForStage(routes, 'ingestion_extraction', 'shared-b')?.id).toBe('shared-b');
  });

  it('keeps dedicated routes ahead of the shared selection', () => {
    const resolved = resolveStageRoutes(
      routes,
      ['ingestion_extraction', 'ingestion_relations'],
      'shared-b'
    );

    expect(resolved).toEqual([
      {
        stage: 'ingestion_extraction',
        route: routes[1],
        mode: 'shared'
      },
      {
        stage: 'ingestion_relations',
        route: routes[2],
        mode: 'dedicated'
      }
    ]);
  });
});
