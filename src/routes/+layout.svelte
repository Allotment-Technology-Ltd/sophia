<script lang="ts">
  import '../app.css';
  import TopBar from '$lib/components/shell/TopBar.svelte';
  import { conversation } from '$lib/stores/conversation.svelte';
  import { referencesStore } from '$lib/stores/references.svelte';
  import { historyStore } from '$lib/stores/history.svelte';
  import { panelStore } from '$lib/stores/panel.svelte';
  import { auth, onAuthChange } from '$lib/firebase';
  import { goto, afterNavigate } from '$app/navigation';
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { type Snippet } from 'svelte';
  import { env as publicEnv } from '$env/dynamic/public';
  import { getModelProviderLabel } from '$lib/types/providers';
  const PUBLIC_GA4_MEASUREMENT_ID = publicEnv.PUBLIC_GA4_MEASUREMENT_ID;

  let { children }: { children: Snippet } = $props();
  let authResolved = $state(false);
  let isAuthenticated = $state(false);

  // GA4 initialisation — loads only when PUBLIC_GA4_MEASUREMENT_ID is configured
  onMount(() => {
    if (!PUBLIC_GA4_MEASUREMENT_ID) return;
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${PUBLIC_GA4_MEASUREMENT_ID}`;
    document.head.appendChild(script);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() { window.dataLayer!.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', PUBLIC_GA4_MEASUREMENT_ID, { send_page_view: false });
  });

  afterNavigate(({ to }) => {
    if (!browser || !PUBLIC_GA4_MEASUREMENT_ID || !window.gtag) return;
    window.gtag('event', 'page_view', { page_path: to?.url.pathname });
  });

  // Client-side auth guard for page navigation.
  // API routes are protected server-side in hooks.server.ts.
  onMount(() => {
    if (!browser) return;

    const PUBLIC_ROUTES = new Set([
      '/',
      '/auth',
      '/landing',
      '/pricing',
      '/privacy',
      '/terms',
      '/legal/changelog',
      '/developer',
      '/api-access'
    ]);
    const isPublicRoute = (path: string) =>
      PUBLIC_ROUTES.has(path) || path.startsWith('/auth');

    let lastAuthUid: string | null = auth?.currentUser?.uid ?? null;

    const applyAuthGuard = (user: unknown) => {
      const onPublicRoute = isPublicRoute($page.url.pathname);
      isAuthenticated = !!user;
      authResolved = true;

      if (isAuthenticated && $page.url.pathname.startsWith('/auth')) {
        goto('/app');
      } else if (!isAuthenticated && !onPublicRoute) {
        goto('/');
      }
    };

    const initialUser = auth?.currentUser ?? null;
    isAuthenticated = !!initialUser;
    historyStore.setUid(initialUser?.uid ?? null);
    if (initialUser?.uid) historyStore.syncFromServer();

    return onAuthChange((user) => {
      const prevUid = lastAuthUid;
      const newUid = user?.uid ?? null;
      lastAuthUid = newUid;

      // Scope history to the new user and clear in-memory state on switch/sign-out
      historyStore.setUid(newUid);
      if (newUid) historyStore.syncFromServer();
      if (prevUid !== null && newUid !== prevUid) {
        conversation.clear();
      }

      applyAuthGuard(user);
    });
  });

  const BARE_ROUTES = new Set([
    '/',
    '/landing',
    '/privacy',
    '/terms',
    '/legal/changelog',
    '/developer',
    '/api-access'
  ]);
  let isAuthPage = $derived.by(() => {
    const path = $page.url.pathname;
    if (path.startsWith('/auth')) return true;
    if (path === '/pricing') {
      return !isAuthenticated;
    }
    return BARE_ROUTES.has(path);
  });

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

  let streamingModel = $derived.by(() => {
    if (!conversation.isLoading || !conversation.currentPass) return undefined;
    const passModel = conversation.passModels[conversation.currentPass];
    if (passModel) {
      return getModelProviderLabel(passModel.provider);
    }
    return conversation.loadingModelProvider && conversation.loadingModelProvider !== 'auto'
      ? getModelProviderLabel(conversation.loadingModelProvider)
      : 'Auto';
  });

  let menuDotVisible = $derived(referencesStore.isLive);

  async function handleTopBarMenuToggle(): Promise<void> {
    if (!browser) return;
    const path = $page.url.pathname;
    if (path.startsWith('/app')) {
      panelStore.toggle();
      return;
    }
    if (!isAuthenticated) {
      await goto('/auth');
      return;
    }
    const destination = new URL('/app', window.location.origin);
    destination.searchParams.set('panelTab', 'settings');
    await goto(destination.toString(), { noScroll: true, keepFocus: true });
  }
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
    {streamingModel}
    {menuDotVisible}
    panelOpen={panelStore.open}
    onMenuToggle={handleTopBarMenuToggle}
    onNew={() => conversation.clear()}
  />
{/if}

{#if isAuthPage || authResolved}
  <div class="layout-shell">
    <div id="main" class="layout-main" style={isAuthPage ? '' : 'padding-top: var(--nav-height);'}>
      {#if isAuthPage || isAuthenticated || BARE_ROUTES.has($page.url.pathname)}
        {@render children()}
      {/if}
    </div>
    <footer class="site-footer" aria-label="Site footer">
      <nav class="footer-nav" aria-label="Legal links">
        <a href="/" aria-current={$page.url.pathname === '/' ? 'page' : undefined}>About</a>
        <a href="/pricing" aria-current={$page.url.pathname === '/pricing' ? 'page' : undefined}>Pricing</a>
        <a href="/privacy" aria-current={$page.url.pathname === '/privacy' ? 'page' : undefined}>Privacy</a>
        <a href="/terms" aria-current={$page.url.pathname === '/terms' ? 'page' : undefined}>Terms</a>
      </nav>
    </footer>
  </div>
{/if}

<style>
  .layout-shell {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .layout-main {
    flex: 1;
    min-height: 0;
  }

  .site-footer {
    border-top: 1px solid var(--color-border);
    background: var(--color-bg);
    padding: 10px var(--space-3);
  }

  .footer-nav {
    display: flex;
    justify-content: center;
    gap: 18px;
    align-items: center;
    font-family: var(--font-ui);
    font-size: 0.64rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .footer-nav a {
    color: var(--color-dim);
    text-decoration: none;
    transition: color var(--transition-base);
  }

  .footer-nav a:hover,
  .footer-nav a[aria-current='page'] {
    color: var(--color-text);
  }
</style>
