import { generateObject } from 'ai';
import { z } from 'zod';
import { getExtractionModel, trackTokens } from './vertex';

const PassSectionSchema = z.object({
  id: z.string(),
  heading: z.string(),
  content: z.string(),
});

const RefinedPassSchema = z.object({
  sections: z.array(PassSectionSchema),
  wordCount: z.number(),
});

const REFINEMENT_SYSTEM = `You are a philosophical editor. Your task is to structure raw philosophical reasoning into clean, well-organized sections with clear headings.

Rules:
- Maximum 1000 words total across all sections
- Each section must have a concise heading (3-7 words)
- Preserve all philosophical substance and argumentation
- Remove redundancy and verbose phrasing
- Use clear, precise academic language
- Generate section IDs as kebab-case from headings

Output valid JSON only.`;

function buildRefinementPrompt(rawText: string, passType: string): string {
  const guidelines = {
    analysis: 'Structure into: The Question(s), Position 1, Position 2, Key Tensions',
    critique: 'Structure into: Hidden Assumptions, Strongest Objection, Counterarguments',
    synthesis: 'Structure into: What the Critique Established, Remaining Tensions, Synthesis'
  };

  return `${guidelines[passType as keyof typeof guidelines] || 'Structure into logical sections'}

Raw philosophical text:
${rawText}

Refine this into structured sections. Preserve all arguments and claims. Stay under 1000 words total.`;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function truncateToWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text.trim();
  return `${words.slice(0, maxWords).join(' ')}…`;
}

export async function refinePass(
  rawText: string,
  passType: 'analysis' | 'critique' | 'synthesis'
): Promise<{ sections: Array<{ id: string; heading: string; content: string }>; wordCount: number }> {
  const currentWordCount = countWords(rawText);

  // If already under limit and reasonably structured, skip refinement
  if (currentWordCount <= 1000 && rawText.includes('**')) {
    // Parse existing markdown sections
    const sections: Array<{ id: string; heading: string; content: string }> = [];
    const parts = rawText.split(/\n(?=\*\*)/);
    
    for (const part of parts) {
      const match = part.match(/^\*\*(.+?)\*\*\n([\s\S]+)/);
      if (match) {
        const heading = match[1].trim();
        const content = match[2].trim();
        sections.push({
          id: heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
          heading,
          content
        });
      } else if (part.trim()) {
        sections.push({
          id: 'introduction',
          heading: 'Introduction',
          content: part.trim()
        });
      }
    }

    if (sections.length > 0) {
      return { sections, wordCount: currentWordCount };
    }
  }

  // Otherwise, use LLM refinement
  try {
    const response = await generateObject({
      model: getExtractionModel(),
      maxOutputTokens: 3000,  // Increased to accommodate reasoning tokens in Gemini 2.5
      temperature: 0.2,
      system: REFINEMENT_SYSTEM,
      prompt: buildRefinementPrompt(rawText, passType),
      schema: RefinedPassSchema
    });

    trackTokens(response.usage.inputTokens ?? 0, response.usage.outputTokens ?? 0);

    const result = response.object;
    
    // Hard cap enforcement
    if (result.wordCount > 1000) {
      console.warn(`[REFINEMENT] ${passType} still over limit (${result.wordCount} words), truncating`);
      // Truncate sections proportionally
      const targetRatio = 950 / result.wordCount; // Leave 50-word margin
      result.sections = result.sections.map(s => ({
        ...s,
        content: s.content.split(/\s+/).slice(0, Math.floor(countWords(s.content) * targetRatio)).join(' ')
      }));
      result.wordCount = result.sections.reduce((sum, s) => sum + countWords(s.content), 0);
    }

    return result;
  } catch (err) {
    console.error(`[REFINEMENT] Failed for ${passType}:`, err);
    // Fallback: return a capped single section to respect the 1000-word constraint
    const capped = truncateToWords(rawText, 950);
    return {
      sections: [{ id: passType, heading: passType.charAt(0).toUpperCase() + passType.slice(1), content: capped }],
      wordCount: countWords(capped)
    };
  }
}
