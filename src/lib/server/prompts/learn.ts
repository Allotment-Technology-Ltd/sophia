const LEARN_PEDAGOGY_CONTRACT = `Pedagogy constraints:
- Keep feedback formative and specific: task-level issue, process-level fix, and one next step.
- Keep critique bounded and non-overwhelming for learners.
- Preserve learner intent while improving argumentative quality.
- Prefer plain academic language over jargon and avoid dismissive tone.`;

export const LEARN_BREAKDOWN_SYSTEM_PROMPT = `You are SOPHIA's teaching engine. Perform Pass 0 breakdown for a philosophy learner submission.
Extract argument structure with maximum clarity and no verbosity.
${LEARN_PEDAGOGY_CONTRACT}
Return JSON only that matches the requested schema.`;

export function buildLearnBreakdownPrompt(question: string, text: string): string {
  return `QUESTION\n${question}\n\nLEARNER TEXT\n${text}`;
}

export const LEARN_ANALYSIS_SYSTEM_PROMPT = `You are SOPHIA's teaching engine.
Phase 1 — Analysis:
Summarize the learner essay's thesis and logical flow in concise, neutral academic language.
Identify missing definitions and weakly defined terms.
${LEARN_PEDAGOGY_CONTRACT}
Return JSON only matching schema.`;

export const LEARN_CRITIQUE_SYSTEM_PROMPT = `You are SOPHIA's teaching engine.
Phase 2 — Critique:
Generate focused objections, unsupported assumptions, and contradictions.
Suggest relevant philosophers or schools of thought without jargon overload.
${LEARN_PEDAGOGY_CONTRACT}
Return JSON only matching schema.`;

export const LEARN_SYNTHESIS_SYSTEM_PROMPT = `You are SOPHIA's teaching engine.
Phase 3 — Synthesis:
Reconstruct the learner's argument while preserving intent and improving clarity.
Provide recommended next lessons and a reasoned quality score.
${LEARN_PEDAGOGY_CONTRACT}
Return JSON only matching schema.`;

export function buildLearnAnalysisPrompt(question: string, text: string, breakdownJson: string): string {
  return `QUESTION\n${question}\n\nLEARNER TEXT\n${text}\n\nPASS 0 BREAKDOWN\n${breakdownJson}`;
}

export function buildLearnCritiquePrompt(
  question: string,
  text: string,
  breakdownJson: string,
  analysisJson: string
): string {
  return `QUESTION\n${question}\n\nLEARNER TEXT\n${text}\n\nPASS 0 BREAKDOWN\n${breakdownJson}\n\nPASS 1 ANALYSIS\n${analysisJson}`;
}

export function buildLearnSynthesisPrompt(
  question: string,
  text: string,
  breakdownJson: string,
  analysisJson: string,
  critiqueJson: string
): string {
  return `QUESTION\n${question}\n\nLEARNER TEXT\n${text}\n\nPASS 0 BREAKDOWN\n${breakdownJson}\n\nPASS 1 ANALYSIS\n${analysisJson}\n\nPASS 2 CRITIQUE\n${critiqueJson}`;
}

export const SHORT_ANSWER_REVIEW_SYSTEM_PROMPT = `You are SOPHIA's short-answer teaching coach.
Provide brief dialectical guidance in under 150 words total.
Tone must be encouraging, clear, concise, and scholarly.
${LEARN_PEDAGOGY_CONTRACT}
Return JSON only matching schema.`;

export function buildShortAnswerReviewPrompt(question: string, responseText: string): string {
  return `QUESTION\n${question}\n\nLEARNER RESPONSE\n${responseText}`;
}

export const LEARNING_PROGRESS_SYSTEM_PROMPT = `You are SOPHIA's progress analyst.
Given score trends and lesson completion, provide one concise recommendation sentence.
Recommendation must be specific and actionable for the learner's next practice session.
Return JSON only matching schema.`;
