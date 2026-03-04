import { createVertex } from '@ai-sdk/google-vertex';

// Lazy initialization - create vertex client only when first called
let vertexInstance: ReturnType<typeof createVertex> | null = null;

function initializeVertex() {
  if (vertexInstance) return vertexInstance;

  // Use process.env directly for compatibility with both SvelteKit and standalone scripts
  const project = process.env.GOOGLE_VERTEX_PROJECT || process.env.GCP_PROJECT_ID;
  const location = process.env.GOOGLE_VERTEX_LOCATION || process.env.GCP_LOCATION || 'us-central1';

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

const reasoningModelId = process.env.GEMINI_REASONING_MODEL || 'gemini-1.5-pro-002';
const extractionModelId = process.env.GEMINI_EXTRACTION_MODEL || 'gemini-2.0-flash-exp';

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
 * Get Google Search grounding tool from the Vertex AI provider
 */
export function getGroundingTool() {
  return getVertex().tools.googleSearch({});
}
