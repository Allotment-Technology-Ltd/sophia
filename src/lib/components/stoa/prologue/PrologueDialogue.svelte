<script lang="ts">
  import type { Beat3Option } from '$lib/server/stoa/prologue/script';
  import {
    ASSESSMENT_QUESTIONS_FALLBACK,
    BEAT1_LINES,
    BEAT2_LINES,
    BEAT3_OPTIONS,
    BEAT4_RESPONSES,
    BEAT5_QUESTIONS,
    BEAT6_CLOSING_LINE,
    QUEST_SEEDS
  } from '$lib/server/stoa/prologue/script';
  import type { PrologueState, StoaProfile, StanceType } from '$lib/types/stoa';

  let {
    profile,
    isReturningStudent = false,
    returningLines = [],
    onPrologueComplete
  }: {
    profile: StoaProfile;
    isReturningStudent?: boolean;
    returningLines?: string[];
    onPrologueComplete: () => void;
  } = $props();

  let prologueState = $state<PrologueState>('beat_1');
  let displayedLines = $state<string[]>([]);
  let beat3Options = $state<Beat3Option[]>([]);
  let selectedBeat3 = $state<Beat3Option | null>(null);
  let beat5Question = $state('');
  let freeTextEnabled = $state(false);
  let userInput = $state('');
  let isStreaming = $state(false);
  let streamedResponse = $state('');
  let showChoices = $state(false);
  let reducedMotion = $state(false);
  let completedFlow = $state(false);

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function addLineWordByWord(
    line: string,
    options: { wordMs?: number; linePauseMs?: number } = {}
  ): Promise<void> {
    const words = line.split(' ');
    let current = '';
    displayedLines = [...displayedLines, current];
    const idx = displayedLines.length - 1;
    const wordMs = reducedMotion ? 0 : (options.wordMs ?? 60);
    for (let i = 0; i < words.length; i += 1) {
      current += `${i > 0 ? ' ' : ''}${words[i]}`;
      displayedLines[idx] = current;
      displayedLines = [...displayedLines];
      if (wordMs > 0) await delay(wordMs);
    }
    if ((options.linePauseMs ?? 700) > 0) {
      await delay(options.linePauseMs ?? 700);
    }
  }

  async function showLines(lines: string[], options: { wordMs?: number; linePauseMs?: number } = {}): Promise<void> {
    for (const line of lines) {
      await addLineWordByWord(line, options);
    }
  }

  async function runReturningFlow(): Promise<void> {
    for (const line of returningLines) {
      await addLineWordByWord(line, { wordMs: 60, linePauseMs: 700 });
    }
    await delay(700);
    onPrologueComplete();
  }

  async function runNewStudentIntro(): Promise<void> {
    prologueState = 'beat_1';
    await showLines(BEAT1_LINES[profile.startingPath], { wordMs: 60, linePauseMs: 700 });
    await delay(2000);

    prologueState = 'beat_2';
    await showLines(BEAT2_LINES[profile.startingPath], { wordMs: 60, linePauseMs: 700 });

    prologueState = 'beat_3';
    beat3Options = BEAT3_OPTIONS[profile.arrivalReason];
    showChoices = true;
  }

  async function handleSelectBeat3(option: Beat3Option): Promise<void> {
    if (selectedBeat3) return;
    selectedBeat3 = option;
    showChoices = false;
    prologueState = 'beat_4';

    await fetch('/api/stoa/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ beat3Choice: option.text })
    }).catch(() => undefined);

    const responsesByChoice = BEAT4_RESPONSES[profile.arrivalReason];
    const fallbackLines = responsesByChoice[Object.keys(responsesByChoice)[0]] ?? [];
    const lines = responsesByChoice[option.text] ?? fallbackLines;
    await showLines(lines, { wordMs: 60, linePauseMs: 700 });
    await delay(2000);

    prologueState = 'beat_5';
    beat5Question =
      BEAT5_QUESTIONS[profile.arrivalReason][option.text] ??
      ASSESSMENT_QUESTIONS_FALLBACK[profile.startingPath];
    await addLineWordByWord(beat5Question, { wordMs: 60, linePauseMs: 500 });
    freeTextEnabled = true;
    prologueState = 'beat_6';
  }

  function parseSseChunk(chunk: string): Array<Record<string, unknown>> {
    const events: Array<Record<string, unknown>> = [];
    const lines = chunk.split('\n');
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        events.push(parsed);
      } catch {
        // ignore malformed chunk parts
      }
    }
    return events;
  }

  async function runDialogueStream(): Promise<void> {
    const message = userInput.trim();
    if (!message || isStreaming) return;
    isStreaming = true;
    freeTextEnabled = false;
    streamedResponse = '';

    try {
      const response = await fetch('/api/stoa/dialogue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          sessionId: profile.firstSessionId
        })
      });

      if (!response.ok || !response.body) {
        throw new Error('Dialogue stream unavailable');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const events = parseSseChunk(chunk);
        for (const event of events) {
          const type = event.type;
          if (type === 'delta') {
            const delta =
              (typeof event.text === 'string' && event.text) ||
              (typeof event.content === 'string' && event.content) ||
              '';
            streamedResponse += delta;
          }
        }
      }
      if (streamedResponse.trim().length > 0) {
        displayedLines = [...displayedLines, streamedResponse.trim()];
      }
    } catch {
      const fallback =
        "What you've shared takes courage to name. Let's sit with it for a moment before we go further.";
      streamedResponse = fallback;
      displayedLines = [...displayedLines, fallback];
    } finally {
      isStreaming = false;
    }

    await addLineWordByWord(QUEST_SEEDS[profile.startingPath], { wordMs: 90, linePauseMs: 900 });
    await delay(3000);
    await addLineWordByWord(BEAT6_CLOSING_LINE, { wordMs: 90, linePauseMs: 400 });
    await delay(2000);

    await fetch('/api/stoa/prologue/assess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        arrivalReason: profile.arrivalReason,
        startingPath: profile.startingPath,
        beat3Choice: selectedBeat3?.text ?? profile.beat3Choice ?? '',
        openingStruggle: profile.openingStruggle,
        beat5Question,
        studentResponse: message
      })
    }).catch(() => undefined);

    onPrologueComplete();
  }

  function currentStanceLabel(): StanceType {
    if (selectedBeat3?.stanceSignal) return selectedBeat3.stanceSignal;
    if (profile.suggestedOpeningStance) return profile.suggestedOpeningStance;
    return 'hold';
  }

  function onFreeInputKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void runDialogueStream();
    }
  }

  $effect(() => {
    if (completedFlow) return;
    completedFlow = true;
    reducedMotion = typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
    if (isReturningStudent) {
      void runReturningFlow();
      return;
    }
    void runNewStudentIntro();
  });
</script>

<div class="prologue-wrap">
  <div class="panel">
    <div class="stance">{currentStanceLabel()}</div>
    {#each displayedLines as line}
      <p class="line">{line}</p>
    {/each}

    {#if showChoices}
      <div class="choice-label">choose one</div>
      <div class="choices">
        {#each beat3Options as option}
          <button
            type="button"
            class="choice"
            class:selected={selectedBeat3?.text === option.text}
            onclick={() => handleSelectBeat3(option)}
          >
            {option.text}
          </button>
        {/each}
      </div>
    {/if}

    {#if freeTextEnabled}
      <textarea
        bind:value={userInput}
        onkeydown={onFreeInputKeydown}
        placeholder="Write freely. Press Enter to continue."
      ></textarea>
      <button type="button" class="send" onclick={runDialogueStream} disabled={isStreaming}>
        {isStreaming ? 'Listening…' : 'Continue'}
      </button>
    {/if}
  </div>
</div>

<style>
  .prologue-wrap {
    position: absolute;
    z-index: 10;
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%);
    width: min(980px, calc(100% - 32px));
  }

  .panel {
    position: relative;
    background: rgba(30, 27, 22, 0.9);
    border: 1px solid rgba(200, 170, 120, 0.35);
    border-radius: 14px;
    padding: 28px 36px;
  }

  .stance {
    position: absolute;
    top: 10px;
    right: 14px;
    font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    color: rgba(180, 140, 80, 0.7);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .line {
    margin: 0 0 12px;
    color: #e8dcc8;
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-style: italic;
    font-size: 20px;
    line-height: 1.35;
  }

  .choice-label {
    margin-top: 14px;
    margin-bottom: 8px;
    font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    color: rgba(232, 220, 200, 0.28);
    letter-spacing: 0.06em;
    text-transform: lowercase;
  }

  .choices {
    display: grid;
    gap: 12px;
  }

  .choice {
    border: 0;
    background: transparent;
    color: rgba(232, 220, 200, 0.75);
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-style: italic;
    font-size: 22px;
    text-align: left;
    cursor: pointer;
    padding: 8px 0;
    transition: opacity 180ms ease;
  }

  .choice:hover,
  .choice.selected {
    opacity: 1;
    color: rgba(232, 220, 200, 1);
  }

  .choices:has(.choice:hover) .choice:not(:hover) {
    opacity: 0.35;
  }

  textarea {
    margin-top: 14px;
    width: 100%;
    min-height: 88px;
    border: 0;
    border-bottom: 1px solid rgba(232, 220, 200, 0.25);
    background: transparent;
    color: #e8dcc8;
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-style: italic;
    font-size: 21px;
    padding: 8px 4px;
    outline: none;
    resize: vertical;
  }

  .send {
    margin-top: 12px;
    border: 1px solid rgba(200, 170, 120, 0.45);
    border-radius: 10px;
    background: rgba(60, 49, 35, 0.4);
    color: #e8dcc8;
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 18px;
    font-style: italic;
    padding: 10px 16px;
    cursor: pointer;
    min-height: 44px;
  }

  .send:disabled {
    opacity: 0.58;
    cursor: default;
  }
</style>
