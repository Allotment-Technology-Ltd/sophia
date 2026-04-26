<script lang="ts">
  import type { StanceType } from '$lib/types/stoa';
  import { stoaSessionStore } from '$lib/stores/stoa-session.svelte';

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
  }

  interface Props {
    sessionId: string;
  }

  let { sessionId }: Props = $props();

  let draft = $state('');
  let isStreaming = $state(false);
  let streamingText = $state('');
  let citations = $state<Citation[]>([]);
  let history = $state<ConversationTurn[]>([]);
  let lastStance = $state<StanceType | null>(null);
  let transcriptEl: HTMLDivElement | null = $state(null);
  let lastRequest: ConversationTurn[] = [];

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

  function toCitations(sourceClaims: ClaimReference[]): Citation[] {
    return sourceClaims.map((claim) => ({
      id: claim.claimId,
      label: `${claim.sourceAuthor} — ${claim.sourceWork}`
    }));
  }

  function stanceLabel(s: StanceType): string {
    return s.replace(/_/g, ' ');
  }

  $effect(() => {
    if (!transcriptEl) return;
    void history;
    void streamingText;
    void isStreaming;
    requestAnimationFrame(() => {
      transcriptEl?.scrollTo({ top: transcriptEl.scrollHeight, behavior: 'smooth' });
    });
  });

  async function send(): Promise<void> {
    const message = draft.trim();
    if (!message || isStreaming) return;

    isStreaming = true;
    stoaSessionStore.setStreaming(true);
    draft = '';
    streamingText = '';
    citations = [];

    const now = new Date().toISOString();
    const userTurn: ConversationTurn = {
      role: 'user',
      content: message,
      timestamp: now
    };
    const requestHistory = [...history, userTurn];
    lastRequest = requestHistory;

    let finalResponse = '';
    let resolvedStance: StanceType | null = lastStance;
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
            streamingText += event.text;
            finalResponse = streamingText;
            continue;
          }

          if (event.type === 'stance' && isStanceType(event.stance)) {
            resolvedStance = event.stance;
            lastStance = event.stance;
            if (Array.isArray(event.frameworksReferenced)) {
              resolvedFrameworks = event.frameworksReferenced;
            }
            continue;
          }

          if (event.type === 'complete') {
            if (typeof event.response === 'string' && event.response.trim()) {
              streamingText = event.response;
              finalResponse = event.response;
            }
            if (isStanceType(event.stance)) {
              resolvedStance = event.stance;
              lastStance = event.stance;
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
        }
      }

      if (!finalResponse.trim()) {
        finalResponse = streamingText;
      }
      const agentTurn: ConversationTurn = {
        role: 'agent',
        content: finalResponse || '…',
        timestamp: new Date().toISOString(),
        stance: resolvedStance ?? undefined,
        frameworksReferenced: resolvedFrameworks
      };
      history = [...requestHistory, agentTurn];
      if (resolvedClaims.length > 0 && citations.length === 0) {
        citations = toCitations(resolvedClaims);
      }
    } catch {
      const errTurn: ConversationTurn = {
        role: 'agent',
        content: 'The dialogue stream was interrupted. Please try again.',
        timestamp: new Date().toISOString()
      };
      history = [...lastRequest, errTurn];
    } finally {
      isStreaming = false;
      stoaSessionStore.setStreaming(false);
      streamingText = '';
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }
</script>

<section class="adventure" aria-label="Stoa text session">
  <div class="adventure-head">
    <span class="session">Session {sessionId.slice(0, 8)}</span>
    {#if lastStance}
      <span class="stance" title="Mentor stance">{stanceLabel(lastStance)}</span>
    {/if}
  </div>

  <div class="transcript" bind:this={transcriptEl}>
    {#if history.length === 0}
      <p class="transcript-hint">You are in the Stoa. Type below to open the scene.</p>
    {:else}
      {#each history as turn, i (turn.timestamp + i)}
        <article class="turn" class:user={turn.role === 'user'}>
          <div class="turn-label">
            {turn.role === 'user' ? 'You' : 'Mentor'}
            {#if turn.role === 'agent' && turn.stance}
              <span class="turn-stance">· {stanceLabel(turn.stance)}</span>
            {/if}
          </div>
          <div class="turn-text">{turn.content}</div>
          {#if turn.role === 'agent' && turn.frameworksReferenced && turn.frameworksReferenced.length > 0}
            <div class="frameworks" aria-label="Frameworks referenced">
              {turn.frameworksReferenced.join(' · ')}
            </div>
          {/if}
        </article>
      {/each}
    {/if}

    {#if isStreaming && streamingText}
      <article class="turn agent streaming" aria-live="polite">
        <div class="turn-label">Mentor</div>
        <div class="turn-text">{streamingText}</div>
      </article>
    {/if}
  </div>

  {#if citations.length > 0}
    <ol class="citations" aria-label="Source citations">
      {#each citations as citation (citation.id)}
        <li>{citation.label}</li>
      {/each}
    </ol>
  {/if}

  <div class="command-line" aria-label="Your reply">
    <div class="prompt" aria-hidden="true">&gt;</div>
    <textarea
      bind:value={draft}
      rows="3"
      placeholder="What do you do or say next?"
      onkeydown={handleKeydown}
      disabled={isStreaming}
    ></textarea>
  </div>

  <div class="actions">
    <button type="button" class="send" onclick={send} disabled={isStreaming || !draft.trim()}>
      {isStreaming ? 'Mentor is replying…' : 'Send'}
    </button>
  </div>
</section>

<style>
  .adventure {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border: 1px solid rgba(180, 150, 100, 0.28);
    border-radius: 4px;
    background: rgba(32, 29, 26, 0.95);
  }

  .adventure-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 1rem;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid rgba(150, 130, 100, 0.2);
    font-family: var(--font-ui);
    font-size: 0.6875rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(200, 188, 168, 0.85);
  }

  .session {
    color: rgba(170, 160, 145, 0.75);
  }

  .stance {
    color: rgba(196, 175, 130, 0.95);
  }

  .transcript {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem 1rem 0.5rem;
    min-height: 10rem;
    max-height: min(52vh, 32rem);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  @media (min-width: 768px) {
    .transcript {
      max-height: min(60vh, 40rem);
    }
  }

  .transcript-hint {
    margin: 0;
    font-size: 0.9375rem;
    line-height: 1.5;
    color: rgba(190, 180, 160, 0.7);
    font-style: italic;
  }

  .turn {
    margin: 0;
  }

  .turn-label {
    font-family: var(--font-ui);
    font-size: 0.6875rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(180, 168, 150, 0.75);
    margin-bottom: 0.2rem;
  }

  .turn.user .turn-label {
    color: rgba(160, 200, 210, 0.85);
  }

  .turn-stance {
    text-transform: none;
    letter-spacing: 0.04em;
    color: rgba(200, 185, 150, 0.65);
    font-size: 0.65rem;
  }

  .turn-text {
    margin: 0;
    font-size: 0.9375rem;
    line-height: 1.55;
    color: rgba(240, 234, 220, 0.96);
    white-space: pre-wrap;
  }

  .turn.user .turn-text {
    color: rgba(230, 235, 238, 0.95);
  }

  .turn.agent .turn-text {
    color: rgba(230, 222, 205, 0.95);
  }

  .turn.streaming .turn-text {
    border-left: 2px solid rgba(180, 150, 100, 0.45);
    padding-left: 0.5rem;
  }

  .frameworks {
    margin-top: 0.35rem;
    font-family: var(--font-ui);
    font-size: 0.65rem;
    color: rgba(150, 175, 160, 0.7);
  }

  .citations {
    margin: 0 1rem 0.5rem;
    padding-left: 1.25rem;
    color: rgba(190, 180, 160, 0.8);
    font-family: var(--font-ui);
    font-size: 0.7rem;
    line-height: 1.4;
  }

  .command-line {
    display: flex;
    gap: 0.4rem;
    padding: 0.5rem 0.75rem 0.25rem;
    align-items: flex-start;
    border-top: 1px solid rgba(150, 130, 100, 0.2);
  }

  .prompt {
    flex-shrink: 0;
    color: rgba(200, 175, 130, 0.5);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.9rem;
    line-height: 1.4;
    padding-top: 0.35rem;
  }

  textarea {
    flex: 1;
    min-width: 0;
    min-height: 2.5rem;
    max-height: 8rem;
    resize: vertical;
    border: none;
    background: transparent;
    color: rgba(240, 235, 220, 0.96);
    font-size: 0.9375rem;
    line-height: 1.45;
    font-family: var(--font-mono, ui-monospace, monospace);
    padding: 0.3rem 0.25rem;
  }

  textarea::placeholder {
    color: rgba(150, 140, 120, 0.55);
    font-style: italic;
  }

  textarea:focus {
    outline: none;
  }

  textarea:disabled {
    opacity: 0.55;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    padding: 0.25rem 0.75rem 0.75rem;
  }

  .send {
    min-height: 2.25rem;
    padding: 0.4rem 1.1rem;
    border-radius: 2px;
    border: 1px solid rgba(160, 130, 80, 0.45);
    background: rgba(100, 75, 45, 0.2);
    color: rgba(235, 220, 195, 0.9);
    font-family: var(--font-ui);
    font-size: 0.7rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    cursor: pointer;
  }

  .send:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
