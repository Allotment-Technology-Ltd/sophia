import { parse } from 'node-html-parser';

export interface ExtractSourceInput {
  url?: string;
  fileRef?: string;
  mimeType: string;
  budget: {
    maxBytes: number;
    maxLatencyMs: number;
  };
}

export interface ExtractSourceOutput {
  text: string;
  spans: Array<{ start: number; end: number }>;
  metadata: {
    mimeType: string;
    bytes: number;
    truncated: boolean;
    source: string;
  };
}

function stripHtmlToText(html: string): string {
  const root = parse(html);
  return root.textContent.replace(/\s+/g, ' ').trim();
}

function extractPdfHeuristic(buffer: Buffer): string {
  // Fallback parser to avoid new dependencies in the hot path.
  // It extracts printable ASCII-like segments and joins them.
  const raw = buffer.toString('latin1');
  const matches = raw.match(/[\x20-\x7E]{8,}/g) ?? [];
  return matches.join(' ').replace(/\s+/g, ' ').trim();
}

export async function extractFromSource(input: ExtractSourceInput): Promise<ExtractSourceOutput> {
  const target = input.url ?? input.fileRef;
  if (!target) {
    return {
      text: '',
      spans: [],
      metadata: { mimeType: input.mimeType, bytes: 0, truncated: false, source: 'none' }
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.budget.maxLatencyMs);

  try {
    const response = await fetch(target, { signal: controller.signal });
    const arrayBuffer = await response.arrayBuffer();
    const bytes = arrayBuffer.byteLength;
    const truncated = bytes > input.budget.maxBytes;
    const slice = Buffer.from(arrayBuffer).subarray(0, input.budget.maxBytes);

    let text = '';
    const mime = input.mimeType.toLowerCase();
    if (mime.includes('html')) {
      text = stripHtmlToText(slice.toString('utf8'));
    } else if (mime.includes('pdf')) {
      text = extractPdfHeuristic(slice);
    } else {
      text = slice.toString('utf8').replace(/\s+/g, ' ').trim();
    }

    const boundedText = text.slice(0, 12000);

    return {
      text: boundedText,
      spans: boundedText
        ? [{ start: 0, end: Math.max(0, boundedText.length - 1) }]
        : [],
      metadata: {
        mimeType: input.mimeType,
        bytes,
        truncated,
        source: target
      }
    };
  } catch (err) {
    console.warn('[ENRICHMENT] Source extraction failed:', err instanceof Error ? err.message : String(err));
    return {
      text: '',
      spans: [],
      metadata: { mimeType: input.mimeType, bytes: 0, truncated: false, source: target }
    };
  } finally {
    clearTimeout(timeout);
  }
}
