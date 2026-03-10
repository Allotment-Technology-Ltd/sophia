import { marked } from 'marked';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSafeLink(href?: string | null): boolean {
  if (!href) return false;
  const normalized = href.replace(/[\u0000-\u001f\u007f\s]+/g, '').toLowerCase();
  if (
    normalized.startsWith('javascript:') ||
    normalized.startsWith('vbscript:') ||
    normalized.startsWith('data:')
  ) {
    return false;
  }
  if (href.startsWith('#') || href.startsWith('/')) return true;
  try {
    const parsed = new URL(href);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

const renderer = new marked.Renderer();

renderer.html = ({ text }) => escapeHtml(text);
renderer.link = function ({ href, title, tokens }) {
  const text = this.parser.parseInline(tokens);
  if (!isSafeLink(href)) return text;
  const safeHref = escapeHtml(href);
  const safeTitle = title ? ` title="${escapeHtml(title)}"` : '';
  return `<a href="${safeHref}" rel="noopener noreferrer nofollow"${safeTitle}>${text}</a>`;
};
renderer.image = ({ href, title, text }) => {
  if (!isSafeLink(href)) return escapeHtml(text || '');
  const safeHref = escapeHtml(href);
  const safeAlt = escapeHtml(text || '');
  const safeTitle = title ? ` title="${escapeHtml(title)}"` : '';
  return `<img src="${safeHref}" alt="${safeAlt}" loading="lazy"${safeTitle}>`;
};

export function renderMarkdown(text: string): string {
  const html = marked.parse(text, {
    async: false,
    gfm: true,
    breaks: true,
    renderer
  });
  return html as string;
}
