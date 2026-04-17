import { getEmbeddingDimensions, getEmbeddingModel, getEmbeddingProvider } from '$lib/server/embeddings';
import { RESTORMEL_ENVIRONMENT_ID } from '$lib/server/restormel';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const p = getEmbeddingProvider();
  return {
    restormelEnvironmentId: RESTORMEL_ENVIRONMENT_ID,
    embeddingRuntime: {
      providerName: p.name,
      documentModel: p.documentModel,
      modelLabel: getEmbeddingModel(),
      dimensions: getEmbeddingDimensions()
    }
  };
};
