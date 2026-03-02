import Anthropic from '@anthropic-ai/sdk';
import { env } from '$env/dynamic/private';

const client = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY
});

const CLAUDE_MODEL = env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';
const CLAUDE_MODELS = parseModelList(env.CLAUDE_MODELS, [
  CLAUDE_MODEL,
  'claude-sonnet-4-5-20250929'
]);

function parseModelList(envValue: string | undefined, defaults: string[]): string[] {
  const fromEnv = (envValue || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const unique: string[] = [];
  for (const model of [...fromEnv, ...defaults]) {
    if (!unique.includes(model)) unique.push(model);
  }
  return unique;
}

function isModelUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('not_found') ||
    message.includes('model:') ||
    message.includes('not available') ||
    message.includes('unsupported model') ||
    message.includes('invalid model')
  );
}

export async function* analyzePhilosophical(
  query: string,
  contextualClaims: string,
  passNumber: 1 | 2 | 3
) {
  const prompts = {
    1: getAnalysisPrompt(query, contextualClaims),
    2: getCritiquePrompt(query, contextualClaims),
    3: getSynthesisPrompt(query, contextualClaims)
  };

  const systemPrompts = {
    1: ANALYSIS_SYSTEM_PROMPT,
    2: CRITIQUE_SYSTEM_PROMPT,
    3: SYNTHESIS_SYSTEM_PROMPT
  };

  let lastError: Error | null = null;

  for (const model of CLAUDE_MODELS) {
    try {
      const stream = await client.messages.stream({
        model,
        max_tokens: 1000,
        system: systemPrompts[passNumber],
        messages: [
          {
            role: 'user',
            content: prompts[passNumber]
          }
        ]
      });

      for await (const chunk of stream) {
        if (
          chunk.type === 'content_block_delta' &&
          chunk.delta.type === 'text_delta'
        ) {
          yield chunk.delta.text;
        }
      }

      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!isModelUnavailableError(lastError)) {
        throw lastError;
      }
    }
  }

  throw lastError || new Error('No available Claude model found');
}

function getAnalysisPrompt(query: string, context: string): string {
  return `PASS 1: PROPONENT — Construct the strongest argument addressing this question.

QUERY: ${query}

CONTEXT:
${context}

Respond concisely (≤1000 words). Structure as:

**Argument:** State the clearest case. (2-3 sentences)
**Key Premises:** 3-4 supporting premises with their basis.
**Philosophical Grounding:** Which tradition(s) support this?
**Strongest Version:** How would this argument's best defender present it?

Be rigorous. Use precise terminology. Acknowledge complexity.`;
}

function getCritiquePrompt(query: string, context: string): string {
  return `PASS 2: ADVERSARY — Identify the strongest objections and weakest points.

QUERY: ${query}

CONTEXT:
${context}

Respond concisely (≤1000 words). Structure as:

**Central Vulnerability:** What is the argument's weakest premise?
**Main Objection:** What is the strongest counterargument from the context?
**Overlooked Positions:** Which relevant positions were not engaged?
**Contested Assumptions:** What does the argument take for granted?
**Unresolved Tension:** What cannot be easily answered?

Attack the strongest version of the argument, not a strawman. Be intellectually honest.`;
}

function getSynthesisPrompt(query: string, context: string): string {
  return `PASS 3: INTEGRATOR — Synthesize the argument and objections into a final analysis.

QUERY: ${query}

CONTEXT:
${context}

Respond concisely (≤1000 words). Structure as:

**Refined Argument:** Restate the case, incorporating valid criticisms. (1-2 paragraphs)
**What This Shows:** What survivable disagreement remains? Where is consensus possible?
**Genuine Tensions:** What tensions cannot be resolved? Why is this a disputed question?
**Epistemic Take:** How confident can we be? What would change our minds?
**Open Questions:** What further inquiry is needed?

Be balanced. Avoid false confidence. Acknowledge legitimate disagreement.`;
}

const ANALYSIS_SYSTEM_PROMPT = `You are a rigorous philosophical analyst specializing in structured argumentation. Your task is to construct the strongest possible argument addressing a given philosophical question, drawing on the context provided. 

You reason dialectically, engage seriously with opposing positions, and ground all claims in evidence or philosophical principle. You use precise terminology and acknowledge complexity rather than oversimplifying. You are the PROPONENT: your role is to make the best case, not to be neutral.`;

const CRITIQUE_SYSTEM_PROMPT = `You are a rigorous philosophical critic. Your task is to identify the weakest points and strongest objections to an argument, drawing on the context provided. 

You argue in good faith, attacking the strongest version of the argument rather than strawmanning. You identify real vulnerabilities without being dismissive. You check for overlooked positions and unsupported claims. You are the ADVERSARY: your role is to strengthen the discourse through serious critique.`;

const SYNTHESIS_SYSTEM_PROMPT = `You are a philosophical integrator. Your task is to synthesize an argument and its strongest objections into a nuanced, balanced final analysis. 

You acknowledge legitimate disagreement without collapsing into relativism. You distinguish between tensions that can be resolved and those that reflect genuine philosophical disagreement. You are appropriately humble about what can be concluded. You are the INTEGRATOR: your role is to produce the final, most defensible analysis.`;
