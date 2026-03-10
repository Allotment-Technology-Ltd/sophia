import { runDomainAgnosticReasoning } from '$lib/server/reasoningEngine';
import { extractClaims } from '$lib/server/extraction';
import { evaluateReasoning } from '$lib/server/reasoningEval';
import { evaluateConstitutionWithTelemetry } from '$lib/server/constitution/evaluator';
import type { PassType } from '$lib/types/passes';
import type { VerificationRequest, VerificationResult } from '$lib/types/verification';
import type { ProviderApiKeys } from '$lib/server/byok/types';

export interface VerificationPipelineCallbacks {
  onPassStart?(pass: PassType): void;
  onPassChunk?(pass: PassType, content: string): void;
  onPassComplete?(pass: PassType): void;
  onPassStructured?(pass: PassType, sections: unknown, wordCount: number): void;
  onSources?(sources: unknown): void;
  onGroundingSources?(pass: PassType, sources: unknown): void;
  onGraphSnapshot?(nodes: unknown, edges: unknown): void;
  onClaims?(pass: unknown, claims: unknown, relations: unknown): void;
  onConfidenceSummary?(avgConfidence: number, lowConfidenceCount: number, totalClaims: number): void;
  onMetadata?(
    totalInputTokens: number,
    totalOutputTokens: number,
    durationMs: number,
    retrieval?: VerificationResult['metadata']['retrieval']
  ): void;
  onExtractionComplete?(payload: {
    claims: VerificationResult['extracted_claims'];
    relations: VerificationResult['logical_relations'];
    metadata: {
      source_length: number;
      extraction_model: string;
      extraction_duration_ms: number;
      tokens_used: {
        input: number;
        output: number;
      };
    };
  }): void;
  onReasoningScores?(reasoningQuality: VerificationResult['reasoning_quality']): void;
  onConstitutionCheck?(constitutionalCheck: VerificationResult['constitutional_check']): void;
}

export interface VerificationPipelineOptions {
  includePassOutputs?: boolean;
  callbacks?: VerificationPipelineCallbacks;
  providerApiKeys?: ProviderApiKeys;
}

export interface VerificationPipelineResult {
  inputText: string;
  extracted_claims: VerificationResult['extracted_claims'];
  logical_relations: VerificationResult['logical_relations'];
  reasoning_quality: VerificationResult['reasoning_quality'];
  constitutional_check: VerificationResult['constitutional_check'];
  pass_outputs?: VerificationResult['pass_outputs'];
  retrieval?: VerificationResult['metadata']['retrieval'];
  extraction_input_tokens: number;
  extraction_output_tokens: number;
  constitution_duration_ms: number;
  constitution_input_tokens: number;
  constitution_output_tokens: number;
  constitution_rule_violations: string[];
}

export function buildVerificationInputText(request: VerificationRequest): string {
  return [request.question, request.answer, request.text].filter(Boolean).join('\n\n');
}

export async function runVerificationPipeline(
  request: VerificationRequest,
  options: VerificationPipelineOptions = {}
): Promise<VerificationPipelineResult> {
  const includePassOutputs = options.includePassOutputs ?? true;
  const callbacks = options.callbacks;
  const inputText = buildVerificationInputText(request);
  const passOutputs: Partial<Record<PassType, string>> = {};
  let retrievalMeta: VerificationResult['metadata']['retrieval'];

  if (includePassOutputs) {
    await runDomainAgnosticReasoning(inputText, {
      onPassStart(pass) {
        callbacks?.onPassStart?.(pass);
      },
      onPassChunk(pass, content) {
        if (pass !== 'verification') {
          passOutputs[pass] = `${passOutputs[pass] ?? ''}${content}`;
        }
        callbacks?.onPassChunk?.(pass, content);
      },
      onPassComplete(pass) {
        callbacks?.onPassComplete?.(pass);
      },
      onPassStructured(pass, sections, wordCount) {
        callbacks?.onPassStructured?.(pass, sections, wordCount);
      },
      onSources(sources) {
        callbacks?.onSources?.(sources);
      },
      onGroundingSources(pass, sources) {
        callbacks?.onGroundingSources?.(pass, sources);
      },
      onGraphSnapshot(nodes, edges) {
        callbacks?.onGraphSnapshot?.(nodes, edges);
      },
      onClaims(pass, claims, relations) {
        callbacks?.onClaims?.(pass, claims, relations);
      },
      onConfidenceSummary(avgConfidence, lowConfidenceCount, totalClaims) {
        callbacks?.onConfidenceSummary?.(avgConfidence, lowConfidenceCount, totalClaims);
      },
      onMetadata(totalInputTokens, totalOutputTokens, durationMs, retrieval) {
        retrievalMeta = retrieval;
        callbacks?.onMetadata?.(totalInputTokens, totalOutputTokens, durationMs, retrieval);
      },
      onError(error) {
        throw new Error(error);
      }
    }, {
      providerApiKeys: options.providerApiKeys
    });
  }

  const extraction = await extractClaims(request, {
    providerApiKeys: options.providerApiKeys
  });
  callbacks?.onExtractionComplete?.({
    claims: extraction.claims,
    relations: extraction.relations,
    metadata: extraction.metadata
  });

  const reasoningQuality = await evaluateReasoning(extraction.claims, extraction.relations, request, {
    providerApiKeys: options.providerApiKeys
  });
  callbacks?.onReasoningScores?.(reasoningQuality);

  const constitutionStartedAt = Date.now();
  const constitutionResult = await evaluateConstitutionWithTelemetry(
    extraction.claims,
    extraction.relations,
    inputText,
    {
      providerApiKeys: options.providerApiKeys
    }
  );
  const constitutionDurationMs = Date.now() - constitutionStartedAt;
  callbacks?.onConstitutionCheck?.(constitutionResult.check);

  return {
    inputText,
    extracted_claims: extraction.claims,
    logical_relations: extraction.relations,
    reasoning_quality: reasoningQuality,
    constitutional_check: constitutionResult.check,
    pass_outputs: includePassOutputs
      ? {
          analysis: passOutputs.analysis,
          critique: passOutputs.critique,
          synthesis: passOutputs.synthesis
        }
      : undefined,
    retrieval: retrievalMeta,
    extraction_input_tokens: extraction.metadata.tokens_used.input,
    extraction_output_tokens: extraction.metadata.tokens_used.output,
    constitution_duration_ms: constitutionDurationMs,
    constitution_input_tokens: constitutionResult.telemetry.constitution_input_tokens,
    constitution_output_tokens: constitutionResult.telemetry.constitution_output_tokens,
    constitution_rule_violations: constitutionResult.telemetry.constitution_rule_violations
  };
}
