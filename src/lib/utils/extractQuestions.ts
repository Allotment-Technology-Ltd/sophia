/**
 * Extracts follow-up questions from the "Further Questions" section of synthesis output.
 * The synthesis prompt asks the AI to include a "## 5. Further Questions" section.
 */
export function extractFurtherQuestions(synthesisText: string): string[] {
  if (!synthesisText) return [];

  // Match various heading forms for the "Further Questions" section
  const sectionMatch = synthesisText.match(
    /##\s+(?:\d+\.\s+)?Further Questions([\s\S]*?)(?=\n##\s|\n```|$)/i
  );
  if (!sectionMatch) return [];

  const sectionContent = sectionMatch[1].trim();

  const questions: string[] = [];

  // Extract numbered or bulleted items: "1. ...", "- ...", "* ..."
  const itemRegex = /^(?:\d+\.\s+|[-*]\s+)(.+?)(?:\n|$)/gm;
  let match;
  while ((match = itemRegex.exec(sectionContent)) !== null) {
    const q = match[1].trim().replace(/\*\*/g, '').replace(/^["']|["']$/g, '');
    if (q.length > 10) {
      questions.push(q);
    }
  }

  // If no list items found, try splitting by sentence endings that look like questions
  if (questions.length === 0) {
    const sentences = sectionContent.split(/(?<=[?])\s+/);
    for (const s of sentences) {
      const clean = s.replace(/^\d+\.\s+/, '').trim();
      if (clean.length > 10 && clean.includes('?')) {
        questions.push(clean);
      }
    }
  }

  // Return at most 3 hints
  return questions.slice(0, 3);
}
