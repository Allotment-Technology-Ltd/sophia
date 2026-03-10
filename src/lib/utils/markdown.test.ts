import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('escapes raw HTML blocks', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('drops unsafe javascript links', () => {
    const html = renderMarkdown('[click me](javascript:alert(1))');
    expect(html).not.toContain('javascript:alert(1)');
    expect(html).not.toContain('<a ');
    expect(html).toContain('click me');
  });

  it('keeps safe https links with rel protections', () => {
    const html = renderMarkdown('[docs](https://example.com/docs)');
    expect(html).toContain('<a href="https://example.com/docs"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });
});
