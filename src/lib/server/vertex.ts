import { google } from '@ai-sdk/google';

// Verify API key is available at startup
function verifyGoogleApiKey() {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    console.error('[Google AI] FATAL: GOOGLE_AI_API_KEY is not set');
    throw new Error('GOOGLE_AI_API_KEY is required. Set the GOOGLE_AI_API_KEY environment variable.');
  }
  console.log('[Google AI] API key verified on startup');
}

// Check at module load time
verifyGoogleApiKey();

const reasoningModelId = process.env.GEMINI_REASONING_MODEL || 'gemini-2.0-flash-001';
const extractionModelId = process.env.GEMINI_EXTRACTION_MODEL || 'gemini-2.0-flash-001';

export function getReasoningModel() {
  return google(reasoningModelId);
}

export function getExtractionModel() {
  return google(extractionModelId);
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
  return google.tools.googleSearch({}) as any;
}
