<script lang="ts">
  import { onMount } from 'svelte';

  import { stoaSessionStore } from '$lib/stores/stoa-session.svelte';
  import DialogueView from './DialogueView.svelte';

  interface Props {
    userId: string;
    sessionId: string;
  }

  let { userId, sessionId }: Props = $props();

  onMount(() => {
    stoaSessionStore.hydrate();
    if (sessionId && sessionId !== stoaSessionStore.sessionId) {
      stoaSessionStore.setSessionId(sessionId);
    }
  });
</script>

<div class="stoa-app" data-user={userId}>
  <div class="stoa-shell">
    <header class="stoa-header">
      <h1 class="stoa-title">Stoa</h1>
      <p class="stoa-lead">
        A text session with the STOA mentor. Describe where you are in your life, your principles, and what
        you want to practice next. The path is the curriculum.
      </p>
      <a class="stoa-journal-link" href="/stoa/journal">Open your STOA journal</a>
    </header>

    <DialogueView sessionId={stoaSessionStore.sessionId} />
  </div>
</div>

<style>
  .stoa-app {
    width: 100%;
    min-height: 100dvh;
    background: #1a1917;
    color: rgba(244, 238, 224, 0.96);
  }

  .stoa-shell {
    max-width: 48rem;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 2.5rem;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
  }

  .stoa-header {
    margin-bottom: 1.25rem;
  }

  .stoa-title {
    margin: 0 0 0.5rem;
    font-family: var(--font-ui);
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(206, 193, 172, 0.9);
  }

  .stoa-lead {
    margin: 0;
    font-size: 0.9375rem;
    line-height: 1.55;
    color: rgba(210, 200, 182, 0.88);
  }

  .stoa-journal-link {
    display: inline-block;
    margin-top: 0.65rem;
    font-family: var(--font-ui);
    font-size: 0.7rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(200, 175, 130, 0.85);
    text-decoration: none;
    border-bottom: 1px solid rgba(180, 150, 100, 0.35);
  }

  .stoa-journal-link:hover {
    color: rgba(220, 200, 160, 0.95);
    border-bottom-color: rgba(200, 170, 120, 0.6);
  }
</style>
