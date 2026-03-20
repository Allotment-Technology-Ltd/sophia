export interface IngestionRouteLike {
  id: string;
  stage?: string | null;
  enabled?: boolean | null;
}

export type IngestionRouteCoverageMode = 'dedicated' | 'shared' | 'missing';

export interface StageRouteResolution<T extends IngestionRouteLike> {
  stage: string;
  route: T | null;
  mode: IngestionRouteCoverageMode;
}

export function isEnabledRoute<T extends IngestionRouteLike>(route: T): boolean {
  return route.enabled !== false;
}

export function listEnabledSharedRoutes<T extends IngestionRouteLike>(routes: T[]): T[] {
  return routes.filter((route) => !route.stage && isEnabledRoute(route));
}

export function resolvePreferredSharedRoute<T extends IngestionRouteLike>(
  routes: T[],
  preferredRouteId?: string | null
): T | null {
  const sharedRoutes = listEnabledSharedRoutes(routes);
  if (preferredRouteId) {
    const preferredRoute = sharedRoutes.find((route) => route.id === preferredRouteId) ?? null;
    if (preferredRoute) return preferredRoute;
  }

  return sharedRoutes[0] ?? null;
}

export function resolveRouteForStage<T extends IngestionRouteLike>(
  routes: T[],
  stage: string | null | undefined,
  preferredSharedRouteId?: string | null
): T | null {
  if (stage) {
    const dedicatedRoute =
      routes.find((route) => route.stage === stage && isEnabledRoute(route)) ?? null;
    if (dedicatedRoute) return dedicatedRoute;
  }

  return (
    resolvePreferredSharedRoute(routes, preferredSharedRouteId) ??
    routes.find((route) => isEnabledRoute(route)) ??
    null
  );
}

export function resolveStageRoutes<T extends IngestionRouteLike>(
  routes: T[],
  stages: string[],
  preferredSharedRouteId?: string | null
): Array<StageRouteResolution<T>> {
  const sharedRoute = resolvePreferredSharedRoute(routes, preferredSharedRouteId);

  return stages.map((stage) => {
    const dedicatedRoute =
      routes.find((route) => route.stage === stage && isEnabledRoute(route)) ?? null;
    const route = dedicatedRoute ?? sharedRoute ?? null;
    const mode: IngestionRouteCoverageMode = dedicatedRoute
      ? 'dedicated'
      : route
        ? 'shared'
        : 'missing';

    return { stage, route, mode };
  });
}
