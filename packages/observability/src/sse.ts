import type { ReasoningEvent } from '@restormel/contracts';

export function serializeReasoningEvent(event: ReasoningEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function parseReasoningEventBlock(block: string): ReasoningEvent | null {
  const line = block.trim();
  if (!line.startsWith('data: ')) return null;

  try {
    return JSON.parse(line.slice(6)) as ReasoningEvent;
  } catch {
    return null;
  }
}
