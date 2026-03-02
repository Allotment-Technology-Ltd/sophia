import { createVertex } from '@ai-sdk/google-vertex';
import { env } from '$env/dynamic/private';

// Lazy initialization - create vertex client only when first called
let vertexInstance: ReturnType<typeof createVertex> | null = null;

function initializeVertex() {
  if (vertexInstance) return vertexInstance;

  const project = env.GOOGLE_VERTEX_PROJECT || env.GCP_PROJECT_ID || process.env.GOOGLE_VERTEX_PROJECT || process.env.GCP_PROJECT_ID;
  const location = env.GOOGLE_VERTEX_LOCATION || env.GCP_LOCATION || process.env.GCP_LOCATION || 'us-central1';

  console.log(`[Vertex] Initializing — project=${project ?? '(missing)'} location=${location}`);

  if (!project) {
    console.error('[Vertex] FATAL: No project ID found. Checked: GOOGLE_VERTEX_PROJECT, GCP_PROJECT_ID (env + process.env)');
    throw new Error('Vertex AI project ID is required. Set GOOGLE_VERTEX_PROJECT or GCP_PROJECT_ID environment variable.');
  }

  try {
    vertexInstance = createVertex({ project, location });
    console.log(`[Vertex] Client created successfully — project=${project} location=${location}`);
  } catch (err) {
    console.error('[Vertex] createVertex() threw:', err instanceof Error ? err.stack : String(err));
    throw err;
  }

  return vertexInstance;
}

function getVertex() {
  return initializeVertex();
}

const reasoningModelId = env.GEMINI_REASONING_MODEL || process.env.GEMINI_REASONING_MODEL || 'gemini-2.5-pro';
const extractionModelId = env.GEMINI_EXTRACTION_MODEL || process.env.GEMINI_EXTRACTION_MODEL || 'gemini-2.5-flash';

export function getReasoningModel() {
  return getVertex()(reasoningModelId);
}

export function getExtractionModel() {
  return getVertex()(extractionModelId);
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
