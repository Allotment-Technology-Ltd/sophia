import { generateText } from 'ai';
import { z } from 'zod';
import { extractSophiaMetaBlock } from './engine';
import { resolveExtractionModelRoute, trackTokens } from './vertex';
import type { ProviderApiKeys } from './byok/types';
import {
  ExtractionResultSchema,
  type ExtractionResult,
  type VerificationRequest
} from '$lib/types/verification';
import {
  buildVerificationExtractionUserPrompt,
  VERIFICATION_EXTRACTION_SYSTEM_PROMPT
} from './prompts/verification-extraction';

const ExtractionMetaBlockSchema = z.object({
  claims: ExtractionResultSchema.shape.claims.default([]),
  relations: ExtractionResultSchema.shape.relations.default([])
});

const MAX_RETRIES = 2;

function getSourceText(request: VerificationRequest): string {
  return [request.question, request.answer, request.text].filter(Boolean).join('\n\n');
}

export async function extractClaims(
  request: VerificationRequest,
  options?: { providerApiKeys?: ProviderApiKeys }
): Promise<ExtractionResult> {
  const startedAt = Date.now();
  const sourceText = getSourceText(request);

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const extractionRoute = await resolveExtractionModelRoute({
        providerApiKeys: options?.providerApiKeys,
        routeId: process.env.RESTORMEL_VERIFY_ROUTE_ID?.trim() || undefined,
        failureMode: 'error'
      });
      const result = await generateText({
        model: extractionRoute.model,
        system: VERIFICATION_EXTRACTION_SYSTEM_PROMPT,
        prompt: buildVerificationExtractionUserPrompt(request),
        maxOutputTokens: 2048
      });

      const usage = result.usage;
      const inputTokens = usage?.inputTokens ?? 0;
      const outputTokens = usage?.outputTokens ?? 0;
      trackTokens(inputTokens, outputTokens);

      const { metaBlock } = extractSophiaMetaBlock(result.text, ExtractionMetaBlockSchema);
      if (!metaBlock) {
        throw new Error('Missing or invalid sophia-meta block in extraction output');
      }

      const candidate: ExtractionResult = {
        claims: metaBlock.claims,
        relations: metaBlock.relations,
        metadata: {
          source_length: sourceText.length,
          extraction_model: extractionRoute.modelId,
          extraction_duration_ms: Date.now() - startedAt,
          tokens_used: {
            input: inputTokens,
            output: outputTokens
          }
        }
      };

      return ExtractionResultSchema.parse(candidate);
    } catch (error) {
      lastError = error;
      if (attempt === MAX_RETRIES) {
        break;
      }
    }
  }

  throw new Error(
    `Claim extraction failed after retries: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}
