import { createGoogleGenerativeAI } from '@ai-sdk/google';

// Lazy initialization - create client only when first called
let googleInstance: ReturnType<typeof createGoogleGenerativeAI> | null = null;

function initializeGoogle() {
  if (googleInstance) return googleInstance;

  const apiKey = process.env.GOOGLE_AI_API_KEY;

  if (!apiKey) {
    console.error('[Google AI] FATAL: GOOGLE_AI_API_KEY is not set');
    throw new Error('GOOGLE_AI_API_KEY is required. Set the GOOGLE_AI_API_KEY environment variable.');
  }

  try {
    googleInstance = createGoogleGenerativeAI({ apiKey });
    console.log('[Google AI] Client created successfully');
  } catch (err) {
    console.error('[Google AI] createGoogleGenerativeAI() threw:', err instanceof Error ? err.stack : String(err));
    throw err;
  }

  return googleInstance;
}

const reasoningModelId = process.env.GEMINI_REASONING_MODEL || 'gemini-2.0-flash-001';
const extractionModelId = process.env.GEMINI_EXTRACTION_MODEL || 'gemini-2.0-flash-001';

export function getReasoningModel() {
  return initializeGoogle()(reasoningModelId);
}

export function getExtractionModel() {
  return initializeGoogle()(extractionModelId);
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
 * Get Google Search grounding tool from the Google AI provider.
 * Cast needed due to minor schema type variance between @ai-sdk/google v3 and ai v6.
 */
export function getGroundingTool() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return initializeGoogle().tools.googleSearch({}) as any;
}
