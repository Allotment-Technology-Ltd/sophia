import { parse } from 'node-html-parser';
import { isIP } from 'node:net';

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

const MAX_REDIRECTS = 3;
const DISALLOWED_HOST_SUFFIXES = ['.local', '.localdomain', '.internal', '.home.arpa'];
const DISALLOWED_CONTENT_TYPE_TOKENS = [
  'javascript',
  'ecmascript',
  'x-sh',
  'x-msdownload',
  'application/octet-stream',
  'application/zip',
  'application/x-zip',
  'application/x-rar-compressed',
  'application/x-7z-compressed'
];
const ALLOWED_TOP_LEVEL_CONTENT_TYPES = ['text/', 'application/pdf', 'application/xhtml+xml', 'application/xml'];

function isDisallowedHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return true;

  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.onion') ||
    DISALLOWED_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  ) {
    return true;
  }

  if (/^\d+$/.test(normalized)) return true;

  const ipVersion = isIP(normalized);
  if (ipVersion === 0) return false;

  if (ipVersion === 6) {
    if (normalized === '::1') return true;
    if (normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) {
      return true;
    }
    if (normalized.startsWith('::ffff:')) {
      const mappedIpv4 = normalized.slice('::ffff:'.length);
      return isDisallowedHost(mappedIpv4);
    }
    return false;
  }

  const octets = normalized.split('.').map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((n) => Number.isNaN(n))) return true;
  const [a, b] = octets;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function validateExternalUrl(raw: string): URL {
  const parsed = new URL(raw);
  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'https:' && protocol !== 'http:') {
    throw new Error(`unsupported protocol: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error('URL credentials are not allowed');
  }
  if (isDisallowedHost(parsed.hostname)) {
    throw new Error(`blocked host: ${parsed.hostname}`);
  }
  return parsed;
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function isLikelyAllowedContentType(contentType: string): boolean {
  if (!contentType) return true;
  const normalized = contentType.toLowerCase();
  if (DISALLOWED_CONTENT_TYPE_TOKENS.some((token) => normalized.includes(token))) {
    return false;
  }
  return ALLOWED_TOP_LEVEL_CONTENT_TYPES.some((token) => normalized.startsWith(token) || normalized.includes(token));
}

function normalizeExtractedText(text: string): string {
  return text.replace(/\u0000/g, ' ').replace(/\s+/g, ' ').trim();
}

function stripHtmlToText(html: string): string {
  const root = parse(html);
  root
    .querySelectorAll('script, style, noscript, iframe, object, embed, template, svg, canvas')
    .forEach((node) => node.remove());
  return normalizeExtractedText(root.textContent);
}

function extractPdfHeuristic(buffer: Buffer): string {
  // Fallback parser to avoid new dependencies in the hot path.
  // It extracts printable ASCII-like segments and joins them.
  const raw = buffer.toString('latin1');
  const matches = raw.match(/[\x20-\x7E]{8,}/g) ?? [];
  return normalizeExtractedText(matches.join(' '));
}

async function fetchSafely(url: string, signal: AbortSignal): Promise<{ response: Response; finalUrl: string }> {
  let current = validateExternalUrl(url);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(current.toString(), {
      signal,
      redirect: 'manual',
      headers: {
        'User-Agent': 'SOPHIA-SourceExtractor/1.0',
        Accept: 'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.1'
      }
    });

    if (isRedirectStatus(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        throw new Error(`redirect (${response.status}) missing location header`);
      }
      if (redirectCount >= MAX_REDIRECTS) {
        throw new Error('too many redirects');
      }
      const next = new URL(location, current);
      current = validateExternalUrl(next.toString());
      continue;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return { response, finalUrl: current.toString() };
  }

  throw new Error('redirect handling failed');
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
    const { response, finalUrl } =
      input.url
        ? await fetchSafely(input.url, controller.signal)
        : { response: await fetch(target, { signal: controller.signal }), finalUrl: target };

    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (!isLikelyAllowedContentType(contentType)) {
      throw new Error(`disallowed content type: ${contentType || 'unknown'}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const bytes = arrayBuffer.byteLength;
    const truncated = bytes > input.budget.maxBytes;
    const slice = Buffer.from(arrayBuffer).subarray(0, input.budget.maxBytes);

    let text = '';
    const mime = (contentType || input.mimeType || '').toLowerCase();
    if (mime.includes('html') || mime.includes('xhtml')) {
      text = stripHtmlToText(slice.toString('utf8'));
    } else if (mime.includes('pdf')) {
      text = extractPdfHeuristic(slice);
    } else {
      text = normalizeExtractedText(slice.toString('utf8'));
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
        source: finalUrl
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
