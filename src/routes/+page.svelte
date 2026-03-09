<script lang="ts">
  import { conversation } from '$lib/stores/conversation.svelte';
  import { referencesStore } from '$lib/stores/references.svelte';
  import { historyStore } from '$lib/stores/history.svelte';
  import { panelStore } from '$lib/stores/panel.svelte';
  import { renderMarkdown } from '$lib/utils/markdown';
  import { goto, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { fly, fade } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import SidePanel from '$lib/components/panel/SidePanel.svelte';
  import TabStrip, { type TabId, type Tab } from '$lib/components/panel/TabStrip.svelte';
  import ReferencesTab from '$lib/components/references/ReferencesTab.svelte';
  import MapTab from '$lib/components/panel/MapTab.svelte';
  import HistoryTab from '$lib/components/panel/HistoryTab.svelte';
  import SettingsTab from '$lib/components/panel/SettingsTab.svelte';
  import QuestionInput from '$lib/components/QuestionInput.svelte';
  import Button from '$lib/components/Button.svelte';
  import PassCard from '$lib/components/PassCard.svelte';
  import PassNavigator from '$lib/components/PassNavigator.svelte';
  import EpistemicStatus from '$lib/components/EpistemicStatus.svelte';
  import Loading from '$lib/components/Loading.svelte';
  import FollowUpInput from '$lib/components/FollowUpInput.svelte';
  import FollowUpHints from '$lib/components/FollowUpHints.svelte';
  import QuestionCounter from '$lib/components/QuestionCounter.svelte';
  import { extractFurtherQuestions } from '$lib/utils/extractQuestions';
  import DialecticalTriangle from '$lib/components/DialecticalTriangle.svelte';

  // ── State ─────────────────────────────────────────────────────────────────
  let queryInput = $state('');
  let activeTab = $state<TabId>('references');
  let activeResultPass = $state<'analysis' | 'critique' | 'synthesis'>('analysis');
  let revealed = $state(false);

  type PassKey = 'analysis' | 'critique' | 'synthesis' | 'verification';

  const EXAMPLE_QUESTIONS = [
    'Is it ethical to use AI in hiring?',
    'Is free will compatible with determinism?',
    'How should I think about this career decision?',
  ];

  const LOADING_STATUS: Record<string, string> = {
    analysis: 'Mapping the philosophical landscape…',
    critique: 'Finding the weakest premises…',
    synthesis: 'Integrating tensions…',
    verification: 'Running web verification…',
  };

  // ── Tabs for SidePanel ───────────────────────────────────────────────────
  const tabs: Tab[] = $derived([
    { id: 'references' as const, label: 'References', showLiveDot: referencesStore.isLive },
    { id: 'map' as const, label: 'Map' },
    { id: 'history' as const, label: 'History' },
    { id: 'settings' as const, label: 'Settings' },
  ]);

  // ── Screen state ─────────────────────────────────────────────────────────
  let lastAssistantMsg = $derived(conversation.messages.findLast(m => m.role === 'assistant'));

  let isQueryState = $derived(conversation.messages.length === 0 && !conversation.isLoading);
  // Loading screen covers all three analysis passes; verification runs in the
  // background while results remain visible (currentPass === 'verification').
  let isLoadingState = $derived(
    conversation.isLoading && conversation.currentPass !== 'verification'
  );
  let isResultsState = $derived(
    !!lastAssistantMsg &&
    (!conversation.isLoading || conversation.currentPass === 'verification')
  );

  let completedPasses = $derived.by(() => {
    return conversation.completedPasses.filter((pass) =>
      pass === 'analysis' || pass === 'critique' || pass === 'synthesis'
    );
  });

  let loadingStatusText = $derived(
    conversation.currentPass
      ? (LOADING_STATUS[conversation.currentPass] ?? 'Thinking…')
      : 'Thinking…'
  );

  let epistemicContent = $derived.by(() => {
    if (!conversation.confidenceSummary) return null;
    const { avgConfidence, lowConfidenceCount, totalClaims } = conversation.confidenceSummary;
    return `Average confidence across ${totalClaims} claim${totalClaims !== 1 ? 's' : ''}: ${(avgConfidence * 100).toFixed(0)}%. ${lowConfidenceCount} claim${lowConfidenceCount !== 1 ? 's' : ''} flagged for review.`;
  });

  let resultsCompletedPasses = $derived.by(() => {
    if (!lastAssistantMsg?.passes) return [];
    return (['analysis', 'critique', 'synthesis'] as const).filter(k => !!lastAssistantMsg!.passes![k]);
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  function stripSophiaMeta(text: string): string {
    return text.replace(/```sophia-meta[\s\S]*?```/g, '').trim();
  }

  function renderPass(text: string): string {
    return renderMarkdown(stripSophiaMeta(text));
  }

  function calculateCost(inputTokens: number, outputTokens: number): number {
    return (inputTokens * 3 + outputTokens * 15) / 1_000_000;
  }

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  // ── Handlers ──────────────────────────────────────────────────────────────
  async function handleSubmit(): Promise<void> {
    if (!queryInput.trim() || conversation.isLoading) return;
    const query = queryInput.trim();
    queryInput = '';
    activeResultPass = 'analysis';
    revealed = false;
    await conversation.submitQuery(query);
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  async function handleHistorySelect(entryId: string): Promise<void> {
    const entry = historyStore.items.find(e => e.id === entryId);
    if (!entry) return;
    queryInput = entry.question;
    await handleSubmit();
  }

  function scrollToPass(pass: string): void {
    const el = document.getElementById(`pass-${pass}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handleTabChange(tab: TabId): void {
    activeTab = tab;
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (tab === 'map') {
      url.searchParams.set('panelTab', 'map');
    } else {
      url.searchParams.delete('panelTab');
    }
    replaceState(url.toString(), page.state);
  }

  async function retryLastQuery(): Promise<void> {
    const lastQuery = conversation.messages.findLast(m => m.role === 'user')?.content;
    if (!lastQuery) return;
    await conversation.submitQuery(lastQuery);
  }

  // ── Effects ───────────────────────────────────────────────────────────────
  $effect(() => {
    if (conversation.currentPass && ['analysis', 'critique', 'synthesis'].includes(conversation.currentPass)) {
      activeResultPass = conversation.currentPass as 'analysis' | 'critique' | 'synthesis';
    }
  });

  $effect(() => {
    if (typeof window === 'undefined') return;

    const syncTabFromUrl = () => {
      const url = new URL(window.location.href);
      const panelTab = url.searchParams.get('panelTab');
      const hasMapState = url.searchParams.has('mapNode') || url.searchParams.has('mapRel');
      if (panelTab === 'map' || hasMapState) {
        activeTab = 'map';
        panelStore.openPanel();
      }
    };

    syncTabFromUrl();
    window.addEventListener('popstate', syncTabFromUrl);
    return () => window.removeEventListener('popstate', syncTabFromUrl);
  });

  let pageTitle = $derived.by(() => {
    const lastUser = conversation.messages.findLast(m => m.role === 'user')?.content;
    if (isLoadingState) return 'Analysing… — SOPHIA';
    if (isResultsState && !revealed) return 'Analysis complete — SOPHIA';
    if (lastUser) {
      const truncated = lastUser.length > 60 ? lastUser.slice(0, 60) + '…' : lastUser;
      return `${truncated} — SOPHIA`;
    }
    return 'SOPHIA — Philosophical Reasoning Engine';
  });
</script>

<svelte:head>
  <title>{pageTitle}</title>
</svelte:head>

<div class="app-shell">
  <div class="app-body">
    <main class="main-content" id="main" class:panel-open={panelStore.open}>

      <!-- ═══════════════════════════════════════════════════════════════
           STATE 1: QUERY — centred landing screen
           ═══════════════════════════════════════════════════════════════ -->
      {#if isQueryState}
        <div class="query-screen">
          <div class="query-center">
            <div class="sophia-symbol" aria-hidden="true">
              <DialecticalTriangle mode="logo" size={80} />
            </div>
            <h1 class="query-heading">What should I think about today?</h1>
            <p class="query-sub">Be specific · More context → richer analysis</p>

            <div class="query-input-wrap">
              <QuestionInput
                bind:value={queryInput}
                onSubmit={handleSubmit}
                disabled={conversation.isLoading}
                onkeydown={handleKeydown}
              />

              <div class="query-actions">
                <Button
                  variant="primary"
                  onclick={handleSubmit}
                  disabled={conversation.isLoading || !queryInput.trim()}
                >
                  Begin analysis →
                </Button>
              </div>

              <div class="example-pills" aria-label="Example questions">
                {#each EXAMPLE_QUESTIONS as q}
                  <button
                    class="pill"
                    onclick={() => { queryInput = q; handleSubmit(); }}
                  >
                    {q}
                  </button>
                {/each}
              </div>
            </div>
          </div>
        </div>
      {/if}

      <!-- ═══════════════════════════════════════════════════════════════
           STATE 2: LOADING — orbital animation + pass tracker
           (transitions to streaming cards as content arrives)
           ═══════════════════════════════════════════════════════════════ -->
      {#if isLoadingState}
        <div out:fly={{ y: -30, duration: 400, easing: quintOut }}>
          <Loading
            currentPass={conversation.currentPass ?? ''}
            statusText={loadingStatusText}
            {completedPasses}
          />
        </div>
      {/if}

      <!-- ═══════════════════════════════════════════════════════════════
           STATE 2b: COMPLETE — click triangle to reveal results
           ═══════════════════════════════════════════════════════════════ -->
      {#if isResultsState && !revealed}
        <div
          class="complete-screen"
          in:fade={{ duration: 500 }}
          out:fade={{ duration: 300 }}
        >
          <DialecticalTriangle
            mode="complete"
            completedPasses={['analysis', 'critique', 'synthesis']}
            size={240}
            onReveal={() => { revealed = true; }}
          />
        </div>
      {/if}

      <!-- ═══════════════════════════════════════════════════════════════
           STATE 3: RESULTS — two-column layout
           ═══════════════════════════════════════════════════════════════ -->
      {#if isResultsState && revealed && lastAssistantMsg && lastAssistantMsg.passes}
        {@const passes = lastAssistantMsg.passes}

        <div class="results-layout" in:fly={{ y: 24, duration: 500, delay: 100, easing: quintOut }}>
          <aside class="pass-nav-col">
            <PassNavigator
              activePass={activeResultPass}
              completedPasses={resultsCompletedPasses}
              showVerification={!!passes.verification}
              onSelect={(p) => { activeResultPass = p as 'analysis' | 'critique' | 'synthesis'; scrollToPass(p); }}
            />
          </aside>

          <div class="results-col">
            <!-- User query echo -->
            {#if conversation.messages.findLast(m => m.role === 'user')}
              <div class="query-echo">
                <p class="query-echo-text">{conversation.messages.findLast(m => m.role === 'user')?.content}</p>
              </div>
            {/if}

            <!-- Pass cards -->
            {#if passes.analysis}
              <div id="pass-analysis">
                <PassCard pass="analysis" content={renderPass(passes.analysis)} />
              </div>
            {/if}

            {#if passes.critique}
              <div id="pass-critique">
                <PassCard pass="critique" content={renderPass(passes.critique)} />
              </div>
            {/if}

            {#if passes.synthesis}
              <div id="pass-synthesis">
                <PassCard pass="synthesis" content={renderPass(passes.synthesis)} />
              </div>
            {/if}

            <!-- Epistemic status -->
            {#if epistemicContent}
              <EpistemicStatus content={epistemicContent} />
            {/if}

            <!-- Web verification section -->
            {#if passes.synthesis}
              <div id="pass-verification" class="verification-section">
                {#if passes.verification}
                  <div class="verification-content" in:fade={{ duration: 350 }}>
                    <div class="verification-eyebrow">
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                        <circle cx="5" cy="5" r="4" stroke="var(--color-amber)" stroke-width="1"/>
                        <path d="M5 2v3l2 1" stroke="var(--color-amber)" stroke-width="1" stroke-linecap="round"/>
                      </svg>
                      Web Verification
                    </div>
                    <div class="prose">
                      {@html renderPass(passes.verification)}
                    </div>
                  </div>
                {:else if conversation.isLoading && conversation.currentPass === 'verification'}
                  <div class="verification-scanning" aria-live="polite">
                    <div class="scan-orbital" aria-hidden="true">
                      <svg width="48" height="48" viewBox="-4 -4 56 56" fill="none">
                        <ellipse class="scan-ring" cx="24" cy="24" rx="22" ry="14" stroke="var(--color-amber)" stroke-width="1.2" stroke-opacity="0.5"/>
                        <ellipse class="scan-ring-inner" cx="24" cy="24" rx="13" ry="8" stroke="var(--color-amber)" stroke-width="1" stroke-opacity="0.35"/>
                        <circle cx="24" cy="24" r="2.5" fill="var(--color-amber)" opacity="0.7"/>
                      </svg>
                    </div>
                    <div class="scan-text">
                      <span class="scan-label">Searching web sources</span>
                      <span class="scan-dots" aria-hidden="true">
                        <span></span><span></span><span></span>
                      </span>
                    </div>
                    <p class="scan-note">Cross-referencing claims against academic consensus and live web sources</p>
                  </div>
                {:else}
                  <button
                    class="run-verification-btn"
                    onclick={() => conversation.runVerification()}
                    disabled={conversation.isLoading}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                    </svg>
                    Run Web Verification
                  </button>
                {/if}
              </div>
            {/if}

            <!-- Metadata -->
            {#if lastAssistantMsg.metadata}
              {@const m = lastAssistantMsg.metadata}
              <div class="metadata-row">
                <span>{m.total_input_tokens} in</span>
                <span class="dot">·</span>
                <span>{m.total_output_tokens} out</span>
                <span class="dot">·</span>
                <span>{formatDuration(m.duration_ms)}</span>
                <span class="dot">·</span>
                <span>${calculateCost(m.total_input_tokens, m.total_output_tokens).toFixed(6)}</span>
              </div>
            {/if}

            <!-- Follow-up hints + input -->
            <div class="follow-up-wrap">
              <QuestionCounter
                count={conversation.questionCount}
                limit={conversation.questionLimit}
              />

              {#if conversation.isAtQuestionLimit}
                <p class="limit-message">
                  You've reached the depth limit for this inquiry.
                  Click <strong>+ NEW</strong> to explore a new question.
                </p>
              {:else}
                {#if passes.synthesis}
                  {@const hints = extractFurtherQuestions(passes.synthesis)}
                  <FollowUpHints
                    questions={hints}
                    onSelect={(q) => { conversation.submitQuery(q); }}
                  />
                {/if}
                <FollowUpInput
                  onSubmit={(text) => conversation.submitQuery(text)}
                  disabled={conversation.isLoading}
                />
              {/if}
            </div>
          </div>
        </div>
      {/if}

      <!-- ═══════════════════════════════════════════════════════════════
           ERROR STATE
           ═══════════════════════════════════════════════════════════════ -->
      {#if conversation.error}
        <div class="error-state" role="alert">
          <p class="error-message">We hit a temporary issue. Please try again.</p>
          <p class="error-detail">{conversation.error}</p>
          <button class="error-retry" onclick={retryLastQuery}>Retry</button>
        </div>
      {/if}

    </main>

    <!-- Side panel (References / History / Settings) -->
    <SidePanel open={panelStore.open} onClose={() => panelStore.close()}>
      <TabStrip {tabs} {activeTab} onTabChange={handleTabChange} />

      {#if activeTab === 'references'}
        <ReferencesTab />
      {:else if activeTab === 'map'}
        <MapTab onOpenReferences={() => { activeTab = 'references'; }} />
      {:else if activeTab === 'history'}
        <HistoryTab
          entries={historyStore.items}
          onSelect={handleHistorySelect}
          onDelete={(id) => historyStore.deleteEntry(id)}
        />
      {:else if activeTab === 'settings'}
        <SettingsTab />
      {/if}
    </SidePanel>
  </div>
</div>

<style>
  /* ── Shell ──────────────────────────────────────────────────────────── */
  .app-shell {
    min-height: 100vh;
    background: var(--color-bg);
    color: var(--color-text);
  }

  .app-body {
    display: flex;
    min-height: calc(100vh - var(--nav-height));
    position: relative;
  }

  .main-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    transition: margin-right var(--transition-slow) cubic-bezier(0.32, 0.72, 0, 1);
    overflow-y: auto;
  }

  @media (min-width: 768px) {
    .main-content.panel-open {
      margin-right: 380px;
    }
  }

  /* ── STATE 1: Query screen ──────────────────────────────────────────── */
  .query-screen {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: calc(100vh - var(--nav-height));
    padding: var(--space-5) var(--space-4);
  }

  .query-center {
    width: 100%;
    max-width: 700px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .sophia-symbol {
    margin-bottom: var(--space-4);
    line-height: 1;
  }

  /* ── STATE 2b: Complete screen ──────────────────────────────────────── */
  .complete-screen {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: calc(100vh - var(--nav-height));
  }

  .query-heading {
    font-family: var(--font-display);
    font-size: var(--text-d2);
    font-weight: 300;
    color: var(--color-text);
    text-align: center;
    margin-bottom: var(--space-2);
    line-height: 1.25;
  }

  .query-sub {
    font-family: var(--font-ui);
    font-size: 0.69rem;
    letter-spacing: 0.08em;
    color: var(--color-dim);
    margin-bottom: var(--space-5);
    text-align: center;
  }

  .query-input-wrap {
    width: 100%;
    padding: 0 var(--space-4);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
  }

  .query-actions {
    display: flex;
    justify-content: center;
    margin-top: var(--space-2);
  }

  .example-pills {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    justify-content: center;
    margin-top: var(--space-2);
  }

  .pill {
    font-family: var(--font-display);
    font-size: 0.8rem;
    font-weight: 300;
    color: var(--color-muted);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 2px;
    padding: var(--space-2) var(--space-3);
    cursor: pointer;
    transition: border-color var(--transition-fast), color var(--transition-fast);
    text-align: center;
  }

  .pill:hover {
    border-color: var(--color-sage-border);
    color: var(--color-text);
  }

  /* ── STATE 2 & 3: Results layout ────────────────────────────────────── */
  .results-layout {
    display: flex;
    min-height: calc(100vh - var(--nav-height));
    padding: var(--space-5) var(--space-4);
    gap: var(--space-5);
    align-items: flex-start;
  }

  .pass-nav-col {
    flex-shrink: 0;
    position: sticky;
    top: var(--space-5);
  }

  .results-col {
    flex: 1;
    max-width: 720px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
  }

  /* ── Query echo ─────────────────────────────────────────────────────── */
  .query-echo {
    padding: var(--space-3) var(--space-4);
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-radius: 3px;
  }

  .query-echo-text {
    font-family: var(--font-display);
    font-style: italic;
    font-size: 1rem;
    color: var(--color-muted);
    margin: 0;
    line-height: 1.65;
  }

  /* ── Verification section ───────────────────────────────────────────── */
  .verification-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .verification-content {
    background: var(--color-surface);
    border: 1px solid var(--color-amber-border);
    border-radius: 3px;
    padding: var(--space-4);
  }

  .verification-eyebrow {
    font-family: var(--font-ui);
    font-size: 0.62rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--color-amber);
    margin-bottom: var(--space-2);
  }

  .run-verification-btn {
    font-family: var(--font-ui);
    font-size: 0.69rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: 2px;
    background: transparent;
    color: var(--color-muted);
    cursor: pointer;
    align-self: flex-start;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    transition: border-color var(--transition-fast), color var(--transition-fast);
  }

  /* ── Verification scanning animation ───────────────────────────────── */
  .verification-scanning {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-5);
    background: var(--color-amber-bg);
    border: 1px solid var(--color-amber-border);
    border-radius: 3px;
  }

  .scan-orbital {
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .scan-ring {
    transform-box: fill-box;
    transform-origin: center;
    animation: orbitSpin 4s linear infinite;
  }

  .scan-ring-inner {
    transform-box: fill-box;
    transform-origin: center;
    animation: orbitSpin 6s linear reverse infinite;
  }

  .scan-text {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-family: var(--font-ui);
    font-size: 0.69rem;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    color: var(--color-amber);
  }

  .scan-dots {
    display: inline-flex;
    gap: 3px;
  }

  .scan-dots span {
    display: inline-block;
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: var(--color-amber);
    animation: dotBounce 1.2s ease-in-out infinite;
  }

  .scan-dots span:nth-child(2) { animation-delay: 0.2s; }
  .scan-dots span:nth-child(3) { animation-delay: 0.4s; }

  .scan-note {
    font-family: var(--font-display);
    font-style: italic;
    font-size: 0.85rem;
    color: var(--color-muted);
    text-align: center;
    margin: 0;
  }

  @keyframes dotBounce {
    0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
    40%            { transform: scale(1);   opacity: 1; }
  }

  .run-verification-btn:hover:not(:disabled) {
    border-color: var(--color-dim);
    color: var(--color-text);
  }

  .run-verification-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* ── Prose (verification content) ──────────────────────────────────── */
  .prose :global(p) { margin-bottom: var(--space-3); color: var(--color-muted); font-family: var(--font-display); font-size: 1rem; line-height: 1.85; }
  .prose :global(h1), .prose :global(h2), .prose :global(h3) { font-family: var(--font-display); font-weight: 400; color: var(--color-text); margin: var(--space-4) 0 var(--space-2); }
  .prose :global(a) { color: var(--color-blue); }
  .prose :global(strong) { font-weight: 600; color: var(--color-text); }

  /* ── Metadata row ───────────────────────────────────────────────────── */
  .metadata-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-family: var(--font-ui);
    font-size: 0.6rem;
    color: var(--color-dim);
    padding-top: var(--space-2);
    border-top: 1px solid var(--color-border);
    flex-wrap: wrap;
  }

  .dot {
    opacity: 0.5;
  }

  /* ── Follow-up ──────────────────────────────────────────────────────── */
  .follow-up-wrap {
    margin-top: var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .limit-message {
    font-family: var(--font-display);
    font-style: italic;
    font-size: 0.9rem;
    color: var(--color-dim);
    margin: 0;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: 2px;
    background: var(--color-surface);
  }

  .limit-message strong {
    color: var(--color-muted);
    font-style: normal;
    font-family: var(--font-ui);
    font-size: 0.65rem;
    letter-spacing: 0.06em;
  }

  /* ── Error state ────────────────────────────────────────────────────── */
  .error-state {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    margin: var(--space-5) var(--space-4);
    background: var(--color-copper-bg);
    border: 1px solid var(--color-copper-border);
    border-radius: 3px;
  }

  .error-message {
    flex: 1;
    font-family: var(--font-display);
    font-size: 1rem;
    color: var(--color-copper);
    margin: 0;
  }

  .error-detail {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 0.68rem;
    color: var(--color-dim);
    word-break: break-word;
  }

  .error-retry {
    font-family: var(--font-ui);
    font-size: 0.62rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--color-copper-border);
    border-radius: 2px;
    background: transparent;
    color: var(--color-copper);
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    transition: border-color var(--transition-fast), background var(--transition-fast);
  }

  .error-retry:hover {
    border-color: var(--color-copper);
    background: var(--color-copper-bg);
  }

  /* ── Responsive ─────────────────────────────────────────────────────── */
  @media (max-width: 767px) {
    .results-layout {
      flex-direction: column;
      padding: var(--space-3) var(--space-3);
      gap: var(--space-3);
    }

    .pass-nav-col {
      position: static;
      width: 100%;
    }

    .query-input-wrap {
      padding: 0;
    }

    .pill {
      font-size: 0.75rem;
    }

    .query-heading {
      font-size: 1.5rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .main-content {
      transition: none;
    }

    .scan-ring,
    .scan-ring-inner,
    .scan-dots span {
      animation: none;
    }
  }
</style>
