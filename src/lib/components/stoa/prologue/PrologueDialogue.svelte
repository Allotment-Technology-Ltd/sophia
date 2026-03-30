<script lang="ts">
  import { onMount } from 'svelte';
  import type {
    ArrivalReason,
    PrologueState,
    StartingPath,
    StanceType,
    StoaProfile
  } from '$lib/types/stoa';

  const BEAT1_LINES: Record<StartingPath, string[]> = {
    garden: ['You found the quiet corner.', "Sit if you'd like. The water doesn't go anywhere."],
    colonnade: ['You walked all the way in.', 'Most people stop at the entrance. Come — sit.'],
    sea_terrace: ['The sea at this hour.', "There's nowhere better to bring something heavy. Sit with me."]
  };

  const BEAT2_LINES: Record<StartingPath, string[]> = {
    garden: [
      'Peace is an interesting thing to look for.',
      "Tell me — when was the last time you felt something close to it? Even briefly."
    ],
    colonnade: [
      'Finding your way.',
      "What does the path look like, when you imagine having found it? Don't tell me where it goes — tell me what it feels like to be on it."
    ],
    sea_terrace: [
      "You can put it down here if you like.",
      "I won't ask what it is yet. Just — what does it feel like to be carrying it?"
    ]
  };

  interface Beat3Option {
    text: string;
    stanceSignal: StanceType;
    primaryStruggleHint: 'cognitive' | 'emotional' | 'existential';
  }

  const BEAT3_OPTIONS: Record<ArrivalReason, Beat3Option[]> = {
    seeking_peace: [
      { text: "Honestly? I can't remember.", stanceSignal: 'sit_with', primaryStruggleHint: 'emotional' },
      {
        text: "There are moments. Small ones. But they don't last.",
        stanceSignal: 'hold',
        primaryStruggleHint: 'cognitive'
      },
      {
        text: "When I'm alone. When nobody needs anything from me.",
        stanceSignal: 'guide',
        primaryStruggleHint: 'existential'
      }
    ],
    seeking_direction: [
      { text: 'Clear. I want it to feel clear.', stanceSignal: 'guide', primaryStruggleHint: 'cognitive' },
      {
        text: "Like I'm doing what I'm supposed to be doing.",
        stanceSignal: 'hold',
        primaryStruggleHint: 'existential'
      },
      {
        text: "Like I'm moving instead of waiting.",
        stanceSignal: 'guide',
        primaryStruggleHint: 'cognitive'
      }
    ],
    carrying_burden: [
      {
        text: "Heavy. Like I can't breathe properly.",
        stanceSignal: 'sit_with',
        primaryStruggleHint: 'emotional'
      },
      {
        text: "Like it's mine to carry and I can't give it to anyone.",
        stanceSignal: 'sit_with',
        primaryStruggleHint: 'existential'
      },
      {
        text: "Like I keep thinking about it even when I don't want to.",
        stanceSignal: 'hold',
        primaryStruggleHint: 'cognitive'
      }
    ],
    uncertain: [
      { text: 'The quiet. I notice the quiet.', stanceSignal: 'sit_with', primaryStruggleHint: 'existential' },
      {
        text: 'How far away everything feels from here.',
        stanceSignal: 'hold',
        primaryStruggleHint: 'existential'
      },
      {
        text: "That I don't want to leave yet.",
        stanceSignal: 'sit_with',
        primaryStruggleHint: 'emotional'
      }
    ]
  };

  const BEAT4_RESPONSES: Record<ArrivalReason, Record<string, string[]>> = {
    seeking_peace: {
      "Honestly? I can't remember.": ["That's honest.", `Not "rarely" — can't remember.`, "Let's start from there."],
      "There are moments. Small ones. But they don't last.": [
        'Small moments are still moments.',
        "We'll come back to that."
      ],
      "When I'm alone. When nobody needs anything from me.": [
        'Solitude as relief.',
        "Worth understanding whether that's rest — or something else.",
        'Sit with me a while.'
      ]
    },
    seeking_direction: {
      'Clear. I want it to feel clear.': ['Clarity.', "What's making it murky right now?"],
      "Like I'm doing what I'm supposed to be doing.": [
        '"Supposed to" is interesting.',
        'Whose sense of supposed-to?',
        "That's worth sitting with."
      ],
      "Like I'm moving instead of waiting.": [
        "You're waiting.",
        'For something specific, or just — waiting?',
        "Let's find out."
      ]
    },
    carrying_burden: {
      "Heavy. Like I can't breathe properly.": [
        "That's a real description.",
        'Not metaphor — physical.',
        "We'll sit with it before we try to move it."
      ],
      "Like it's mine to carry and I can't give it to anyone.": [
        "That feeling — that it's yours specifically — is worth examining.",
        'Not to take it from you.',
        'Just to look at it together.'
      ],
      "Like I keep thinking about it even when I don't want to.": [
        'Yes.',
        'Unresolved things do that.',
        'They keep asking for attention until they get it properly.'
      ]
    },
    uncertain: {
      'The quiet. I notice the quiet.': ['Good.', "That's already something.", 'Sit in it a moment longer.'],
      'How far away everything feels from here.': [
        'It is far.',
        'The academy sits at a certain remove from things.',
        "That's not an accident."
      ],
      "That I don't want to leave yet.": ["Then don't.", "That's enough for now."]
    }
  };

  const BEAT5_QUESTIONS: Record<ArrivalReason, Record<string, string>> = {
    seeking_peace: {
      "Honestly? I can't remember.": "When was the last time you didn't feel like you needed to be somewhere else?",
      "There are moments. Small ones. But they don't last.": 'What makes them end, when they do?',
      "When I'm alone. When nobody needs anything from me.": 'Is that rest, or something else?'
    },
    seeking_direction: {
      'Clear. I want it to feel clear.': "What's making it murky right now?",
      "Like I'm doing what I'm supposed to be doing.": 'Whose sense of supposed-to is it?',
      "Like I'm moving instead of waiting.": 'What exactly are you waiting for?'
    },
    carrying_burden: {
      "Heavy. Like I can't breathe properly.": 'Where does it sit in your body?',
      "Like it's mine to carry and I can't give it to anyone.": 'When did you decide it was yours alone?',
      "Like I keep thinking about it even when I don't want to.": 'What would it mean to stop — even for an hour?'
    },
    uncertain: {
      'The quiet. I notice the quiet.': 'What does it feel like to be in quiet right now?',
      'How far away everything feels from here.': 'Is that relief, or something lonelier?',
      "That I don't want to leave yet.": "What is it you don't want to go back to?"
    }
  };

  const ASSESSMENT_QUESTIONS_FALLBACK: Record<StartingPath, string> = {
    garden: "When was the last time you didn't feel like you needed to be somewhere else?",
    colonnade: 'What would it mean to know you were on the right path?',
    sea_terrace: 'What would it look like to put it down, even for a few minutes?'
  };

  const QUEST_SEEDS: Record<StartingPath, string> = {
    garden:
      "One thing worth trying this week: when you notice a moment of stillness — however small — don't reach past it. Just let it be there.",
    colonnade:
      'One thing to do before tomorrow: name one action that is entirely in your hands. Not what you hope will happen. What you can actually do.',
    sea_terrace:
      "One thing for tonight: write one sentence about what you're carrying. Not to solve it. Just to make it visible outside your own head."
  };

  const BEAT6_CLOSING_LINE = 'The academy is open.';

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

  onMount(() => {
    reducedMotion =
      typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
    if (isReturningStudent) {
      void runReturningFlow();
    } else {
      void runNewStudentIntro();
    }
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
