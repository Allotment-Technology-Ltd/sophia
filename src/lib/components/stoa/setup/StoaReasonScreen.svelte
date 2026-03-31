<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import type { ArrivalReason, StartingPath } from '$lib/types/stoa';

  const dispatch = createEventDispatcher<{
    complete: { reason: ArrivalReason; startingPath: StartingPath };
  }>();

  const question = 'What brings you here?';
  const words = question.split(' ');
  const options: Array<{ label: string; reason: ArrivalReason; startingPath: StartingPath }> = [
    { label: 'I am looking for some peace.', reason: 'seeking_peace', startingPath: 'garden' },
    { label: 'I am trying to find my way.', reason: 'seeking_direction', startingPath: 'colonnade' },
    {
      label: "I am carrying something I can't put down.",
      reason: 'carrying_burden',
      startingPath: 'sea_terrace'
    },
    {
      label: "I'm not sure. I just needed somewhere to go.",
      reason: 'uncertain',
      startingPath: 'colonnade'
    }
  ];

  let reducedMotion = $state(false);
  let questionVisible = $state(false);
  let visibleWordCount = $state(0);
  let optionsVisibleCount = $state(0);
  let hoveredIndex = $state<number | null>(null);
  let selectedIndex = $state<number | null>(null);

  const timers = new Set<number>();
  let wordInterval: number | null = null;

  function setTimer(callback: () => void, ms: number): void {
    const id = window.setTimeout(() => {
      timers.delete(id);
      callback();
    }, ms);
    timers.add(id);
  }

  function revealOptions(): void {
    if (reducedMotion) {
      optionsVisibleCount = options.length;
      return;
    }
    options.forEach((_, idx) => {
      setTimer(() => {
        optionsVisibleCount = Math.max(optionsVisibleCount, idx + 1);
      }, idx * 500);
    });
  }

  function optionOpacity(index: number): number {
    if (selectedIndex !== null) {
      return selectedIndex === index ? 1 : 0.08;
    }
    if (hoveredIndex !== null) {
      return hoveredIndex === index ? 1 : 0.35;
    }
    return 0.84;
  }

  function handleSelect(index: number): void {
    if (selectedIndex !== null) return;
    selectedIndex = index;
    const selected = options[index];
    setTimer(() => {
      dispatch('complete', { reason: selected.reason, startingPath: selected.startingPath });
    }, 1000);
  }

  onMount(() => {
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimer(() => {
      questionVisible = true;
      if (reducedMotion) {
        visibleWordCount = words.length;
      } else {
        wordInterval = window.setInterval(() => {
          visibleWordCount = Math.min(words.length, visibleWordCount + 1);
          if (visibleWordCount >= words.length && wordInterval !== null) {
            clearInterval(wordInterval);
            wordInterval = null;
          }
        }, 60);
      }
      setTimer(revealOptions, 2000);
    }, 1500);
  });

  onDestroy(() => {
    for (const id of timers) clearTimeout(id);
    timers.clear();
    if (wordInterval !== null) {
      clearInterval(wordInterval);
      wordInterval = null;
    }
  });
</script>

<div class="screen" role="group" aria-label="Arrival reason">
  <h1 class="question" class:visible={questionVisible}>
    {#each words as word, index}
      <span class="word" class:visible={visibleWordCount > index}>{word}</span>{' '}
    {/each}
  </h1>

  <div class="options">
    {#each options as option, index}
      <button
        type="button"
        class="option"
        class:visible={optionsVisibleCount > index}
        style:opacity={optionOpacity(index)}
        onmouseenter={() => (hoveredIndex = index)}
        onmouseleave={() => (hoveredIndex = null)}
        onclick={() => handleSelect(index)}
      >
        {option.label}
      </button>
    {/each}
  </div>
</div>

<style>
  .screen {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px;
    background: #000;
    color: #e8dcc8;
    font-family: var(--font-body);
    font-style: italic;
    text-align: center;
  }

  .question {
    margin: 0 0 32px;
    font-size: clamp(34px, 5vw, 56px);
    font-weight: 500;
    opacity: 0;
    transition: opacity 260ms ease;
  }

  .question.visible {
    opacity: 1;
  }

  .word {
    opacity: 0;
    transition: opacity 220ms ease;
  }

  .word.visible {
    opacity: 1;
  }

  .options {
    width: min(720px, 100%);
    display: grid;
    gap: 16px;
  }

  .option {
    appearance: none;
    border: 0;
    background: transparent;
    color: #e8dcc8;
    font: inherit;
    font-size: clamp(22px, 2.5vw, 30px);
    line-height: 1.3;
    cursor: pointer;
    padding: 12px 16px;
    opacity: 0;
    transition: opacity 360ms ease;
  }

  .option.visible {
    opacity: 0.84;
  }

  @media (prefers-reduced-motion: reduce) {
    .question,
    .word,
    .option {
      transition-duration: 120ms;
    }
  }
</style>
