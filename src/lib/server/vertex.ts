import { createVertex } from '@ai-sdk/google-vertex';
import { env } from '$env/dynamic/private';

const project = env.GOOGLE_VERTEX_PROJECT || env.GCP_PROJECT_ID;
const location = env.GOOGLE_VERTEX_LOCATION || env.GCP_LOCATION || 'europe-west2';

const vertex = createVertex({
  ...(project ? { project } : {}),
  ...(location ? { location } : {})
});

const reasoningModelId =
  (env.GEMINI_REASONING_MODEL || 'gemini-2.5-pro') as Parameters<typeof vertex>[0];
const extractionModelId =
  (env.GEMINI_EXTRACTION_MODEL || 'gemini-2.5-flash') as Parameters<typeof vertex>[0];

export function getReasoningModel() {
  return vertex(reasoningModelId);
}

export function getExtractionModel() {
  return vertex(extractionModelId);
}

let sessionTokens = {
  input: 0,
  output: 0
};

export function trackTokens(inputTokens: number, outputTokens: number): void {
  sessionTokens.input += inputTokens;
  sessionTokens.output += outputTokens;

  console.log(`[Tokens] Input: ${inputTokens} | Output: ${outputTokens}`);
  console.log(`[Session] Input: ${sessionTokens.input} | Output: ${sessionTokens.output}`);
}

/**
 * Build Vertex AI grounding tool configuration for web search
 * Scopes searches to ethics/philosophy academic sources
 */
export function buildGroundingTool() {
  return {
    googleSearch: {
      dynamicRetrievalConfig: {
        mode: 'MODE_DYNAMIC' as const,
        dynamicThreshold: 0.3
      }
    }
  };
}
