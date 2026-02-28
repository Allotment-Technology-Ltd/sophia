import { marked } from 'marked';

// Configure marked with sensible defaults
marked.setOptions({
  mangle: false,
  headerIds: false
});

export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false });
  return html as string;
}
