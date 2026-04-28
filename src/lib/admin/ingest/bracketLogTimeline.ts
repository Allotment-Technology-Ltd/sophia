export type BracketLogEntry = {
  tag: string;
  body: string;
  raw: string;
};

const BRACKET_LINE = /^\s*\[([^\]]+)\]\s*(.*)$/;

/**
 * Pull recent worker/orchestrator lines that start with a `[TAG]` prefix (e.g. `[FETCH]`, `[INGEST]`).
 * Returns newest-last order (same as input tail).
 */
export function extractRecentBracketTaggedLines(
  logLines: string[],
  maxLines = 100
): BracketLogEntry[] {
  if (!Array.isArray(logLines) || logLines.length === 0) return [];
  const out: BracketLogEntry[] = [];
  const start = Math.max(0, logLines.length - 400);
  for (let i = start; i < logLines.length; i++) {
    const raw = logLines[i] ?? '';
    const m = raw.match(BRACKET_LINE);
    if (!m) continue;
    const tag = (m[1] ?? '').trim();
    if (!tag) continue;
    out.push({ tag, body: (m[2] ?? '').trim(), raw });
  }
  if (out.length <= maxLines) return out;
  return out.slice(-maxLines);
}
