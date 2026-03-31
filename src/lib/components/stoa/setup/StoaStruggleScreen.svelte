<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import type { StartingPath } from '$lib/types/stoa';

  interface Props {
    startingPath: StartingPath;
  }

  let { startingPath }: Props = $props();

  const dispatch = createEventDispatcher<{ complete: { struggle: string | null } }>();

  const primaryQuestion = 'Is there something specific weighing on you?';
  const primaryWords = primaryQuestion.split(' ');
  const secondaryText =
    "You don't have to say. But if you bring it in, the conversations tend to find it anyway.";

  let reducedMotion = $state(false);
  let questionVisible = $state(false);
  let visibleWordCount = $state(0);
  let secondaryVisible = $state(false);
  let inputVisible = $state(false);
  let skipVisible = $state(false);
  let value = $state('');
  let submitting = $state(false);
  let submittedLabelVisible = $state(false);
  let lastEnterAt = $state(0);

  const timers = new Set<number>();
  let wordInterval: number | null = null;

  function setTimer(callback: () => void, ms: number): void {
    const id = window.setTimeout(() => {
      timers.delete(id);
      callback();
    }, ms);
    timers.add(id);
  }

  function emitComplete(struggle: string | null): void {
    dispatch('complete', { struggle });
  }

  function submitContent(): void {
    if (submitting) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    submitting = true;
    submittedLabelVisible = true;
    setTimer(() => emitComplete(trimmed), 600);
  }

  function handleSkip(): void {
    if (submitting) return;
    emitComplete(null);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    if (event.shiftKey) return;
    const now = Date.now();
    if (now - lastEnterAt < 550) {
      event.preventDefault();
      submitContent();
      return;
    }
    lastEnterAt = now;
  }

  onMount(() => {
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    void startingPath;
    setTimer(() => {
      questionVisible = true;
      if (reducedMotion) {
        visibleWordCount = primaryWords.length;
      } else {
        wordInterval = window.setInterval(() => {
          visibleWordCount = Math.min(primaryWords.length, visibleWordCount + 1);
          if (visibleWordCount >= primaryWords.length && wordInterval !== null) {
            clearInterval(wordInterval);
            wordInterval = null;
          }
        }, 60);
      }
      setTimer(() => {
        secondaryVisible = true;
        setTimer(() => {
          inputVisible = true;
          setTimer(() => {
            skipVisible = true;
          }, 1200);
        }, 1200);
      }, 1500);
    }, 800);
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

<div class="screen" role="group" aria-label="Optional opening struggle">
  <h2 class="question" class:visible={questionVisible}>
    {#each primaryWords as word, index}
      <span class="word" class:visible={visibleWordCount > index}>{word}</span>{' '}
    {/each}
  </h2>

  <p class="secondary" class:visible={secondaryVisible}>{secondaryText}</p>

  <div class="input-wrap" class:visible={inputVisible}>
    {#if !submittedLabelVisible}
      <textarea
        bind:value
        onkeydown={handleKeydown}
        placeholder="A situation. A decision. A feeling you haven't named yet."
      ></textarea>
      {#if value.trim().length > 0}
        <button type="button" class="submit-arrow" onclick={submitContent} aria-label="Submit struggle">
          →
        </button>
      {/if}
    {:else}
      <div class="carried">Saved. Continuing...</div>
    {/if}
  </div>

  <button type="button" class="skip" class:visible={skipVisible} onclick={handleSkip}>
    Continue without answering
  </button>
</div>

<style>
  .screen {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 32px;
    background: #000;
    color: #e8dcc8;
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-style: italic;
    text-align: center;
  }

  .question {
    margin: 0;
    font-size: clamp(30px, 4.2vw, 46px);
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

  .secondary {
    margin: 0;
    max-width: 760px;
    font-size: 16px;
    color: rgba(232, 220, 200, 0.48);
    opacity: 0;
    transition: opacity 900ms ease;
  }

  .secondary.visible {
    opacity: 1;
  }

  .input-wrap {
    width: min(720px, 100%);
    position: relative;
    opacity: 0;
    transition: opacity 420ms ease;
  }

  .input-wrap.visible {
    opacity: 1;
  }

  textarea {
    width: 100%;
    min-height: 108px;
    resize: vertical;
    background: transparent;
    border: 0;
    border-bottom: 1px solid rgba(232, 220, 200, 0.22);
    color: #e8dcc8;
    font: inherit;
    font-size: 24px;
    font-style: italic;
    text-align: center;
    padding: 12px 48px 12px 12px;
    outline: none;
  }

  textarea::placeholder {
    color: rgba(232, 220, 200, 0.3);
  }

  .submit-arrow {
    position: absolute;
    right: 8px;
    bottom: 10px;
    border: 0;
    background: transparent;
    color: #e8dcc8;
    font-family: inherit;
    font-size: 28px;
    cursor: pointer;
    padding: 8px 12px;
    opacity: 0.85;
  }

  .carried {
    font-size: 30px;
    opacity: 0.9;
  }

  .skip {
    border: 0;
    background: transparent;
    color: rgba(232, 220, 200, 0.32);
    font-family: inherit;
    font-style: normal;
    font-size: 13px;
    text-decoration: underline;
    cursor: pointer;
    opacity: 0;
    transition: opacity 360ms ease;
    padding: 8px 12px;
  }

  .skip.visible {
    opacity: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    .question,
    .word,
    .secondary,
    .input-wrap,
    .skip {
      transition-duration: 120ms;
    }
  }
</style>
