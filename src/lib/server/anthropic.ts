import Anthropic from '@anthropic-ai/sdk';
import { env } from '$env/dynamic/private';

export const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY
});

export const MODEL = 'claude-sonnet-4-5-20250929';

// Track token usage across the session
let sessionTokens = {
  input: 0,
  output: 0
};

export function trackTokens(inputTokens: number, outputTokens: number): void {
  sessionTokens.input += inputTokens;
  sessionTokens.output += outputTokens;

  // Calculate costs: input = $3/1M tokens, output = $15/1M tokens
  const callCost = (inputTokens * 3 + outputTokens * 15) / 1_000_000;
  const sessionCost = (sessionTokens.input * 3 + sessionTokens.output * 15) / 1_000_000;

  console.log(`[Tokens] Input: ${inputTokens} | Output: ${outputTokens}`);
  console.log(`[Session] Input: ${sessionTokens.input} | Output: ${sessionTokens.output}`);
  console.log(`[Cost] This call: $${callCost.toFixed(6)} | Session total: $${sessionCost.toFixed(6)}`);
}
