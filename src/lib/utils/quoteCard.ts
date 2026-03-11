type CanvasFactory = (width: number, height: number) => HTMLCanvasElement | null;

interface CopyDeps {
  clipboard?: { write: (items: ClipboardItem[]) => Promise<void> };
  clipboardItemCtor?: new (items: Record<string, Blob>) => ClipboardItem;
  fetchImpl?: typeof fetch;
}

function defaultCanvasFactory(width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function normalizeText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_`>\[\]\(\)]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines;
}

export function buildQuoteSnippet(text: string, maxChars = 180): string {
  const normalized = normalizeText(text);
  if (!normalized) return 'Meaning emerges through careful reasoning.';
  const sentences = normalized.match(/[^.!?]+[.!?]?/g) ?? [normalized];
  const best = sentences.find((sentence) => sentence.trim().length >= 30)?.trim() ?? sentences[0].trim();
  if (best.length <= maxChars) return best;
  return `${best.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export function buildQuoteFilename(now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `sophia-quote-${year}-${month}-${day}.png`;
}

export function createQuoteCardDataUrl(
  quote: string,
  options?: {
    width?: number;
    height?: number;
    author?: string;
    canvasFactory?: CanvasFactory;
  }
): string {
  const width = options?.width ?? 1200;
  const height = options?.height ?? 628;
  const author = options?.author ?? 'SOPHIA';
  const canvasFactory = options?.canvasFactory ?? defaultCanvasFactory;
  const canvas = canvasFactory(width, height);
  if (!canvas) {
    throw new Error('Canvas is unavailable in this environment.');
  }
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to create drawing context.');
  }

  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#1B3A4B');
  gradient.addColorStop(1, '#6A8E7F');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  context.globalAlpha = 0.16;
  context.fillStyle = '#FFFFFF';
  context.beginPath();
  context.arc(width * 0.85, height * 0.2, 140, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.arc(width * 0.18, height * 0.82, 220, 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 1;

  context.fillStyle = '#F6F3EB';
  context.font = '600 54px "Cormorant Garamond", Georgia, serif';
  context.fillText('“', 120, 188);

  context.font = '400 52px "Cormorant Garamond", Georgia, serif';
  const lines = wrapText(context, quote, width - 240).slice(0, 6);
  lines.forEach((line, index) => {
    context.fillText(line, 150, 220 + index * 66);
  });

  context.font = '500 28px "JetBrains Mono", "Courier New", monospace';
  context.fillStyle = 'rgba(246, 243, 235, 0.92)';
  context.fillText(`— ${author}`, 150, height - 86);

  return canvas.toDataURL('image/png');
}

export function downloadQuoteCard(dataUrl: string, fileName: string): void {
  if (typeof document === 'undefined') return;
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export async function copyQuoteCardDataUrl(
  dataUrl: string,
  deps?: CopyDeps
): Promise<boolean> {
  const clipboard = deps?.clipboard ?? (typeof navigator !== 'undefined' ? navigator.clipboard : undefined);
  const clipboardItemCtor =
    deps?.clipboardItemCtor ?? (typeof ClipboardItem !== 'undefined' ? ClipboardItem : undefined);
  const fetchImpl = deps?.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);

  if (!clipboard || !clipboardItemCtor || !fetchImpl) return false;

  try {
    const response = await fetchImpl(dataUrl);
    const blob = await response.blob();
    await clipboard.write([new clipboardItemCtor({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}
