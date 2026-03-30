<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  import type { StanceType, StoaProgressState } from '$lib/types/stoa';
  import { stoaSessionStore } from '$lib/stores/stoa-session.svelte';

  interface Props {
    stance: StanceType;
    sessionId: string;
  }

  interface ClaimReference {
    claimId: string;
    sourceAuthor: string;
    sourceWork: string;
  }

  interface Citation {
    id: string;
    label: string;
  }

  interface ConversationTurn {
    role: 'user' | 'agent';
    content: string;
    timestamp: string;
    stance?: StanceType;
    frameworksReferenced?: string[];
  }

  interface DialogueStreamEvent {
    type: string;
    text?: string;
    message?: string;
    response?: string;
    stance?: StanceType;
    frameworksReferenced?: string[];
    sourceClaims?: ClaimReference[];
    xpGained?: number;
    newUnlocks?: string[];
    questsCompleted?: string[];
  }

  const dispatch = createEventDispatcher<{
    stanceChange: { stance: StanceType };
    progressUpdate: StoaProgressState;
    dialogueProgressUpdate: { xpGained: number; newUnlocks: string[]; questsCompleted: string[] };
  }>();

  let { stance, sessionId }: Props = $props();

  let draft = $state('');
  let isStreaming = $state(false);
  let displayText = $state('');
  let citations = $state<Citation[]>([]);
  let history = $state<ConversationTurn[]>([]);

  function isStanceType(value: unknown): value is StanceType {
    return (
      value === 'hold' ||
      value === 'challenge' ||
      value === 'guide' ||
      value === 'teach' ||
      value === 'sit_with'
    );
  }

  function parseSseBlocks(buffer: string): { blocks: string[]; nextBuffer: string } {
    const parts = buffer.split('\n\n');
    const nextBuffer = parts.pop() ?? '';
    return { blocks: parts, nextBuffer };
  }

  function parseEventBlock(block: string): DialogueStreamEvent | null {
    const dataLine = block
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('');
    if (!dataLine) return null;
    try {
      return JSON.parse(dataLine) as DialogueStreamEvent;
    } catch {
      return null;
    }
  }

  async function appendDelta(text: string): Promise<void> {
    for (const char of text) {
      displayText += char;
    }
  }

  function toCitations(sourceClaims: ClaimReference[]): Citation[] {
    return sourceClaims.map((claim) => ({
      id: claim.claimId,
      label: `${claim.sourceAuthor} — ${claim.sourceWork}`
    }));
  }

  async function send(): Promise<void> {
    const message = draft.trim();
    if (!message || isStreaming) return;

    isStreaming = true;
    stoaSessionStore.setStreaming(true);
    draft = '';
    displayText = '';
    citations = [];

    const now = new Date().toISOString();
    const userTurn: ConversationTurn = {
      role: 'user',
      content: message,
      timestamp: now
    };
    const requestHistory = [...history, userTurn];

    let finalResponse = '';
    let resolvedStance: StanceType = stance;
    let resolvedFrameworks: string[] = [];
    let resolvedClaims: ClaimReference[] = [];

    try {
      const response = await fetch('/api/stoa/dialogue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          sessionId,
          history: requestHistory
        })
      });

      if (!response.ok || !response.body) {
        throw new Error(`Dialogue request failed (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseBlocks(buffer);
        buffer = parsed.nextBuffer;

        for (const block of parsed.blocks) {
          const event = parseEventBlock(block);
          if (!event) continue;

          if (event.type === 'delta' && typeof event.text === 'string') {
            await appendDelta(event.text);
            finalResponse = displayText;
            continue;
          }

          if (event.type === 'stance' && isStanceType(event.stance)) {
            resolvedStance = event.stance;
            if (Array.isArray(event.frameworksReferenced)) {
              resolvedFrameworks = event.frameworksReferenced;
            }
            dispatch('stanceChange', { stance: event.stance });
            continue;
          }

          if (event.type === 'complete') {
            if (typeof event.response === 'string' && event.response.trim()) {
              displayText = event.response;
              finalResponse = event.response;
            }
            if (isStanceType(event.stance)) {
              resolvedStance = event.stance;
              dispatch('stanceChange', { stance: event.stance });
            }
            if (Array.isArray(event.frameworksReferenced)) {
              resolvedFrameworks = event.frameworksReferenced;
            }
            if (Array.isArray(event.sourceClaims)) {
              resolvedClaims = event.sourceClaims;
              citations = toCitations(event.sourceClaims);
            }
            continue;
          }

          if (event.type === 'error') {
            throw new Error(event.message ?? 'Dialogue stream error');
          }

          if (event.type === 'progress_update') {
            // Emit progress update for thinker unlock notifications
            dispatch('dialogueProgressUpdate', {
              xpGained: event.xpGained ?? 0,
              newUnlocks: event.newUnlocks ?? [],
              questsCompleted: event.questsCompleted ?? []
            });
            continue;
          }
        }
      }

      if (!finalResponse.trim()) {
        finalResponse = displayText;
      }
      const agentTurn: ConversationTurn = {
        role: 'agent',
        content: finalResponse,
        timestamp: new Date().toISOString(),
        stance: resolvedStance,
        frameworksReferenced: resolvedFrameworks
      };
      history = [...requestHistory, agentTurn];
      if (resolvedClaims.length > 0 && citations.length === 0) {
        citations = toCitations(resolvedClaims);
      }
    } catch {
      displayText = 'The dialogue stream was interrupted. Please try again.';
    } finally {
      isStreaming = false;
      stoaSessionStore.setStreaming(false);
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }
</script>

<section class="dialogue-overlay" aria-live="polite">
  <div class="meta-row">
    <span class="session">Session {sessionId.slice(0, 8)}</span>
    <span class="stance">{stance.replace('_', ' ')}</span>
  </div>

  <p class="stoa-words">{displayText || 'Speak when ready. I will respond in measured company.'}</p>

  {#if citations.length > 0}
    <ol class="citations" aria-label="Source citations">
      {#each citations as citation}
        <li>{citation.label}</li>
      {/each}
    </ol>
  {/if}

  <div class="composer">
    <textarea
      bind:value={draft}
      rows="2"
      placeholder="Describe what happened, then what you want to do next."
      onkeydown={handleKeydown}
      disabled={isStreaming}
    ></textarea>
    <button type="button" onclick={send} disabled={isStreaming || !draft.trim()}>
      {isStreaming ? 'Streaming...' : 'Send'}
    </button>
  </div>
</section>

<style>
  .dialogue-overlay {
    position: absolute;
    left: 50%;
    bottom: 120px;
    transform: translateX(-50%);
    width: min(60vw, 860px);
    border-radius: 12px;
    border: 1px solid rgba(180, 150, 100, 0.3);
    background: rgba(26, 25, 23, 0.85);
    backdrop-filter: blur(8px);
    padding: 24px 32px;
    display: grid;
    gap: 16px;
    z-index: 18;
  }

  .meta-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    font-family: var(--font-ui);
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(230, 211, 175, 0.86);
  }

  .session {
    color: rgba(206, 193, 172, 0.72);
  }

  .stoa-words {
    margin: 0;
    color: rgba(244, 238, 224, 0.95);
    font-family: var(--font-display);
    font-size: 18px;
    font-style: italic;
    line-height: 1.7;
    min-height: 88px;
    white-space: pre-wrap;
  }

  .citations {
    margin: 0;
    padding-left: 16px;
    color: rgba(210, 194, 170, 0.84);
    font-family: var(--font-ui);
    font-size: 11px;
    display: grid;
    gap: 4px;
  }

  .composer {
    display: grid;
    gap: 12px;
  }

  textarea {
    width: 100%;
    min-height: 44px;
    max-height: 180px;
    resize: vertical;
    border-radius: 10px;
    border: 1px solid rgba(191, 167, 126, 0.36);
    background: rgba(40, 35, 29, 0.62);
    padding: 12px 16px;
    font-size: 15px;
    line-height: 1.5;
    color: rgba(241, 235, 225, 0.96);
  }

  textarea::placeholder {
    color: rgba(187, 172, 147, 0.7);
  }

  button {
    justify-self: end;
    min-height: 40px;
    padding: 8px 20px;
    border-radius: 10px;
    border: 1px solid rgba(185, 145, 91, 0.5);
    background: rgba(124, 84, 51, 0.26);
    color: rgba(239, 225, 200, 0.92);
    font-family: var(--font-ui);
    font-size: 12px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.56;
    cursor: not-allowed;
  }

  @media (max-width: 1024px) {
    .dialogue-overlay {
      width: min(92vw, 720px);
      bottom: 80px;
      padding: 20px 24px;
    }
  }
</style>
