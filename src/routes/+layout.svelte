<script lang="ts">
  import '../app.css';
  import TopBar from '$lib/components/shell/TopBar.svelte';
  import { conversation } from '$lib/stores/conversation.svelte';
  import { referencesStore } from '$lib/stores/references.svelte';
  import { historyStore } from '$lib/stores/history.svelte';
  import { panelStore } from '$lib/stores/panel.svelte';
  import { auth, onAuthChange } from '$lib/firebase';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { type Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
  let authResolved = $state(false);
  let isAuthenticated = $state(false);

  // Client-side auth guard for page navigation.
  // API routes are protected server-side in hooks.server.ts.
  onMount(() => {
    if (!browser) return;

    const applyAuthGuard = (user: unknown) => {
      const onAuthRoute = $page.url.pathname.startsWith('/auth');
      isAuthenticated = !!user;
      authResolved = true;

      if (isAuthenticated && onAuthRoute) {
        goto('/');
      } else if (!isAuthenticated && !onAuthRoute) {
        goto('/auth');
      }
    };

    const initialUser = auth?.currentUser ?? null;
    historyStore.setUid(initialUser?.uid ?? null);
    if (initialUser?.uid) historyStore.syncFromServer();
    applyAuthGuard(initialUser);

    return onAuthChange((user) => {
      const prevUid = auth?.currentUser?.uid ?? null;
      const newUid = user?.uid ?? null;

      // Scope history to the new user and clear in-memory state on switch/sign-out
      historyStore.setUid(newUid);
      if (newUid) historyStore.syncFromServer();
      if (!newUid || newUid !== prevUid) {
        conversation.clear();
      }

      applyAuthGuard(user);
    });
  });

  let isAuthPage = $derived($page.url.pathname.startsWith('/auth'));

  // Context query: the most recent user message (shown centred in TopBar on results/loading screens)
  let contextQuery = $derived(
    conversation.messages.findLast(m => m.role === 'user')?.content ?? undefined
  );

  // Streaming pass label (shown right of context query during analysis)
  let streamingPass = $derived(
    conversation.isLoading && conversation.currentPass
      ? `Pass ${['analysis', 'critique', 'synthesis'].indexOf(conversation.currentPass) + 1} of 3`
      : undefined
  );

  let menuDotVisible = $derived(referencesStore.isLive);
</script>

<svelte:head>
  <title>SOPHIA — Philosophical Reasoning Engine</title>
  <meta name="description" content="Apply structured philosophical reasoning to any question, dilemma, or argument" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
</svelte:head>

{#if !isAuthPage}
  <TopBar
    {contextQuery}
    {streamingPass}
    {menuDotVisible}
    panelOpen={panelStore.open}
    onMenuToggle={() => panelStore.toggle()}
    onNew={() => conversation.clear()}
  />
{/if}

{#if isAuthPage || authResolved}
  <div id="main" style={isAuthPage ? '' : 'padding-top: var(--nav-height);'}>
    {#if isAuthPage || isAuthenticated}
      {@render children()}
    {/if}
  </div>
{/if}
