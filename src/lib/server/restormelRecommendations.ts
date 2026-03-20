export type RestormelRecommendationActionType =
  | 'fix_automatically'
  | 'use_recommended_route'
  | 'use_cheaper_route'
  | 'use_more_reliable_route'
  | 'rerun_phase';

export interface RestormelRecommendationSupport {
  available: boolean;
  reason: string;
  actionTypes: RestormelRecommendationActionType[];
}

export interface RestormelRecommendationRequest {
  routeId: string;
  actionType: RestormelRecommendationActionType;
  environmentId?: string;
  workload?: string;
  stage?: string;
  task?: string;
  estimatedInputTokens?: number;
  estimatedInputChars?: number;
  complexity?: string;
  [key: string]: unknown;
}

export interface RestormelRecommendationResponse {
  support: RestormelRecommendationSupport;
  recommendation: null;
}

export class RestormelRecommendationUnavailableError extends Error {
  readonly status = 501;
  readonly code = 'recommendation_api_unavailable';
  readonly detail: string;

  constructor(detail: string) {
    super(detail);
    this.name = 'RestormelRecommendationUnavailableError';
    this.detail = detail;
  }
}

const DEFAULT_SUPPORT: RestormelRecommendationSupport = {
  available: false,
  reason:
    'Restormel recommendation actions are not yet exposed to Sophia in this environment.',
  actionTypes: [
    'fix_automatically',
    'use_recommended_route',
    'use_cheaper_route',
    'use_more_reliable_route',
    'rerun_phase'
  ]
};

export function getRestormelRecommendationSupport(): RestormelRecommendationSupport {
  return DEFAULT_SUPPORT;
}

export async function requestRestormelRecommendation(
  _request: RestormelRecommendationRequest
): Promise<RestormelRecommendationResponse> {
  const support = getRestormelRecommendationSupport();
  throw new RestormelRecommendationUnavailableError(support.reason);
}
