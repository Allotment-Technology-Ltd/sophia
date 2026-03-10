const HARVARD_REFERENCES_HEADING = '## References (Harvard)';
const HARVARD_REFERENCES_REGEX = /^\s*##\s+References\s+\(Harvard\)\s*$/im;

type HarvardScope = 'synthesis' | 'verification';

export function ensureHarvardReferencesSection(
  text: string,
  scope: HarvardScope
): {
  text: string;
  appended: boolean;
  appendedText: string;
} {
  const trimmed = text.trimEnd();
  if (HARVARD_REFERENCES_REGEX.test(trimmed)) {
    return { text: trimmed, appended: false, appendedText: '' };
  }

  const appendix =
    `\n\n${HARVARD_REFERENCES_HEADING}\n` +
    `- Harvard format required: Surname, Initial(s). (Year) *Title*. Publisher/Journal. Available at: URL (Accessed: YYYY-MM-DD).\n` +
    `- ${scope === 'synthesis' ? 'Synthesis' : 'Verification'} guardrail note: complete bibliographic details were not fully available in the generated output; verify source metadata before relying on specific attributions.`;

  return {
    text: `${trimmed}${appendix}`,
    appended: true,
    appendedText: appendix
  };
}

