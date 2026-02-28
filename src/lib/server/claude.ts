import Anthropic from '@anthropic-ai/sdk';
import { env } from '$env/dynamic/private';

const client = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY
});

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

  const stream = await client.messages.stream({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 2000,
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
}

function getAnalysisPrompt(query: string, context: string): string {
  return `You are conducting the first pass of a rigorous philosophical analysis. Your role is the PROPONENT: construct the strongest possible argument addressing this question.

QUERY: ${query}

PHILOSOPHICAL CONTEXT:
${context}

INSTRUCTIONS:
1. Decompose the question into constituent philosophical sub-domains
2. Identify the key philosophical positions relevant to answering this question
3. Construct the strongest available argument from the context provided
4. Identify key premises and their evidential support
5. Note which philosophical traditions are engaged

Produce structured analysis in these sections:
**Domains Identified:** [List philosophical domains]
**Positions Engaged:** [Name main positions]
**Core Argument:** [2-3 sentences]
**Key Premises:** [List 3-5 key premises]
**Traditions Engaged:** [Which philosophical traditions]
**Confidence Notes:** [Where strongest, where vulnerable]

Be philosophically rigorous. Use precise terminology.`;
}

function getCritiquePrompt(query: string, context: string): string {
  return `You are conducting the second pass of a rigorous philosophical analysis. Your role is the ADVERSARY: identify the weakest points and strongest objections.

QUERY: ${query}

PHILOSOPHICAL CONTEXT:
${context}

INSTRUCTIONS:
1. Identify the weakest premise in the argument just presented
2. Construct the strongest available objection from the context
3. Check for overlooked philosophical positions that would challenge the argument
4. Flag any empirical claims that lack support
5. Identify contested assumptions the argument depends on

Produce structured analysis:
**Weakest Premise:** [Which premise is vulnerable?]
**Strongest Objection:** [Most formidable counterargument]
**Overlooked Positions:** [What positions weren't engaged]
**Unsupported Claims:** [Which claims lack grounding]
**Contested Assumptions:** [What does argument assume?]
**Gap Search Needed:** [Any specific gaps to fill? yes/no]

Be intellectually honest. Challenge the strongest version of the argument.`;
}

function getSynthesisPrompt(query: string, context: string): string {
  return `You are conducting the third pass of a rigorous philosophical analysis. Your role is the INTEGRATOR: synthesize the argument and its strongest objections into a nuanced final analysis.

QUERY: ${query}

PHILOSOPHICAL CONTEXT:
${context}

INSTRUCTIONS:
1. Integrate valid objections into a refined argument
2. Distinguish between tensions that can be resolved and those that cannot
3. Identify genuine philosophical disagreement that survives analysis
4. Assess the overall epistemic status of the argument
5. Suggest further questions the analysis raises

Produce structured synthesis:
**Integrated Analysis:** [Restate argument incorporating objections. 2-3 paragraphs]
**Resolved Tensions:** [Which objections refine rather than refute?]
**Unresolved Tensions:** [What genuine disagreement remains?]
**Epistemic Status:** [How confident? What qualifications?]
**Further Questions:** [What follow-up questions?]

Be balanced. Acknowledge legitimate disagreement. Avoid false confidence.`;
}

const ANALYSIS_SYSTEM_PROMPT = `You are a rigorous philosophical analyst specializing in structured argumentation. Your task is to construct the strongest possible argument addressing a given philosophical question, drawing on the context provided. 

You reason dialectically, engage seriously with opposing positions, and ground all claims in evidence or philosophical principle. You use precise terminology and acknowledge complexity rather than oversimplifying. You are the PROPONENT: your role is to make the best case, not to be neutral.`;

const CRITIQUE_SYSTEM_PROMPT = `You are a rigorous philosophical critic. Your task is to identify the weakest points and strongest objections to an argument, drawing on the context provided. 

You argue in good faith, attacking the strongest version of the argument rather than strawmanning. You identify real vulnerabilities without being dismissive. You check for overlooked positions and unsupported claims. You are the ADVERSARY: your role is to strengthen the discourse through serious critique.`;

const SYNTHESIS_SYSTEM_PROMPT = `You are a philosophical integrator. Your task is to synthesize an argument and its strongest objections into a nuanced, balanced final analysis. 

You acknowledge legitimate disagreement without collapsing into relativism. You distinguish between tensions that can be resolved and those that reflect genuine philosophical disagreement. You are appropriately humble about what can be concluded. You are the INTEGRATOR: your role is to produce the final, most defensible analysis.`;
