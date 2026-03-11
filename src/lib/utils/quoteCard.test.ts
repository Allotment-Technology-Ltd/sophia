import {
  buildQuoteFilename,
  buildQuoteSnippet,
  copyQuoteCardDataUrl,
  createQuoteCardDataUrl
} from './quoteCard';
import { describe, expect, it } from 'vitest';

describe('quoteCard utils', () => {
  it('buildQuoteSnippet normalizes markdown and limits length', () => {
    const snippet = buildQuoteSnippet(
      '## Heading\n\nMeaning emerges not from suffering itself, but from what we make of it. Extra detail.'
    );
    expect(snippet).toContain('Meaning emerges');
    expect(snippet.length).toBeLessThanOrEqual(180);
    expect(snippet).not.toContain('##');
  });

  it('buildQuoteFilename uses UTC date format', () => {
    const fileName = buildQuoteFilename(new Date(Date.UTC(2026, 2, 11, 8, 0, 0)));
    expect(fileName).toBe('sophia-quote-2026-03-11.png');
  });

  it('createQuoteCardDataUrl throws when canvas is unavailable', () => {
    expect(() =>
      createQuoteCardDataUrl('Meaning emerges through reflection.', {
        canvasFactory: () => null
      })
    ).toThrow('Canvas is unavailable');
  });

  it('copyQuoteCardDataUrl returns false when clipboard is unavailable', async () => {
    const ok = await copyQuoteCardDataUrl('data:image/png;base64,AAAA', {
      clipboard: undefined,
      clipboardItemCtor: undefined
    });
    expect(ok).toBe(false);
  });

  it('copyQuoteCardDataUrl returns false when clipboard write fails', async () => {
    class MockClipboardItem {
      constructor(_items: Record<string, Blob>) {}
    }
    const ok = await copyQuoteCardDataUrl('data:image/png;base64,AAAA', {
      clipboard: {
        write: async () => {
          throw new Error('write failed');
        }
      },
      clipboardItemCtor: MockClipboardItem as unknown as new (items: Record<string, Blob>) => ClipboardItem
    });
    expect(ok).toBe(false);
  });

  it('copyQuoteCardDataUrl returns true when clipboard write succeeds', async () => {
    class MockClipboardItem {
      constructor(_items: Record<string, Blob>) {}
    }
    const ok = await copyQuoteCardDataUrl('data:text/plain;base64,SGVsbG8=', {
      clipboard: {
        write: async () => {}
      },
      clipboardItemCtor: MockClipboardItem as unknown as new (items: Record<string, Blob>) => ClipboardItem
    });
    expect(ok).toBe(true);
  });
});
