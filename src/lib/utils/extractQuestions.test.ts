import { describe, it, expect } from 'vitest';
import { extractFurtherQuestions } from './extractQuestions';

describe('extractFurtherQuestions', () => {
  it('returns empty array for empty input', () => {
    expect(extractFurtherQuestions('')).toEqual([]);
  });

  it('returns empty array when no Further Questions section exists', () => {
    const text = '## Abstract\nSome content here.\n## 1. Analysis\nMore content.';
    expect(extractFurtherQuestions(text)).toEqual([]);
  });

  it('extracts numbered list items from "## 5. Further Questions"', () => {
    const text = `## 5. Further Questions

1. Does moral realism require a non-naturalist metaphysics?
2. Can consequentialism account for agent-relative obligations?
3. How does Rawlsian justice apply to AI systems?
4. This fourth question should be excluded from the top-3 results.`;

    const result = extractFurtherQuestions(text);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe('Does moral realism require a non-naturalist metaphysics?');
    expect(result[1]).toBe('Can consequentialism account for agent-relative obligations?');
    expect(result[2]).toBe('How does Rawlsian justice apply to AI systems?');
  });

  it('extracts bulleted list items', () => {
    const text = `## Further Questions

- What is the relationship between autonomy and dignity?
- How should we weigh competing rights claims?
- Is virtue ethics compatible with moral pluralism?`;

    const result = extractFurtherQuestions(text);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe('What is the relationship between autonomy and dignity?');
  });

  it('handles asterisk bullet points', () => {
    const text = `## Further Questions

* First question about ethics and virtue?
* Second question about moral luck?`;

    const result = extractFurtherQuestions(text);
    expect(result).toHaveLength(2);
  });

  it('strips bold markdown from extracted questions', () => {
    const text = `## Further Questions

1. **Does moral realism require** a non-naturalist metaphysics?`;

    const result = extractFurtherQuestions(text);
    expect(result[0]).not.toContain('**');
    expect(result[0]).toContain('Does moral realism require');
  });

  it('stops extraction at the next ## heading', () => {
    const text = `## Further Questions

1. Is utilitarianism defensible?
2. Can Kantian ethics handle conflicts?

## Next Section

3. This should not appear.`;

    const result = extractFurtherQuestions(text);
    expect(result).toHaveLength(2);
  });

  it('stops extraction at a sophia-meta fence', () => {
    const text = `## Further Questions

1. What is justice?
2. What is liberty?

\`\`\`sophia-meta
{"sections":[],"claims":[]}
\`\`\``;

    const result = extractFurtherQuestions(text);
    expect(result).toHaveLength(2);
  });

  it('falls back to sentence splitting when no list items found', () => {
    const text = `## Further Questions

What is the nature of justice? How does liberty relate to equality? Is there an objective morality?`;

    const result = extractFurtherQuestions(text);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((q) => q.includes('?'))).toBe(true);
  });

  it('ignores short items (< 10 chars)', () => {
    const text = `## Further Questions

1. Why?
2. How does virtue ethics handle moral dilemmas in complex societies?`;

    const result = extractFurtherQuestions(text);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('virtue ethics');
  });

  it('handles "## Further Questions" without a leading number', () => {
    const text = `## Further Questions

1. Is consequentialism self-defeating?`;

    const result = extractFurtherQuestions(text);
    expect(result).toHaveLength(1);
  });
});
