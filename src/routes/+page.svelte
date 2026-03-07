<script lang="ts">
  import { conversation } from '$lib/stores/conversation.svelte';
  import { referencesStore } from '$lib/stores/references.svelte';
  import { historyStore } from '$lib/stores/history.svelte';
  import { panelStore } from '$lib/stores/panel.svelte';
  import { graphStore } from '$lib/stores/graph.svelte';
  import { renderMarkdown } from '$lib/utils/markdown';
  import SidePanel from '$lib/components/panel/SidePanel.svelte';
  import TabStrip, { type TabId, type Tab } from '$lib/components/panel/TabStrip.svelte';
  import ReferencesTab from '$lib/components/references/ReferencesTab.svelte';
  import HistoryTab from '$lib/components/panel/HistoryTab.svelte';
  import SettingsTab from '$lib/components/panel/SettingsTab.svelte';
  import GraphCanvas from '$lib/components/visualization/GraphCanvas.svelte';
  import QuestionInput from '$lib/components/QuestionInput.svelte';
  import Button from '$lib/components/Button.svelte';
  import PassCard from '$lib/components/PassCard.svelte';
  import PassNavigator from '$lib/components/PassNavigator.svelte';
  import EpistemicStatus from '$lib/components/EpistemicStatus.svelte';
  import Loading from '$lib/components/Loading.svelte';
  import FollowUpInput from '$lib/components/FollowUpInput.svelte';

  // ── State ─────────────────────────────────────────────────────────────────
  let queryInput = $state('');
  let activeTab = $state<TabId>('references');
  let activeResultPass = $state<'analysis' | 'critique' | 'synthesis'>('analysis');

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
    { id: 'history' as const, label: 'History' },
    { id: 'settings' as const, label: 'Settings' },
  ]);

  // ── Screen state ─────────────────────────────────────────────────────────
  let lastAssistantMsg = $derived(conversation.messages.findLast(m => m.role === 'assistant'));

  let isQueryState = $derived(conversation.messages.length === 0 && !conversation.isLoading);
  let isLoadingState = $derived(conversation.isLoading);
  let isResultsState = $derived(!conversation.isLoading && !!lastAssistantMsg);

  let completedPasses = $derived.by(() => {
    const passes: string[] = [];
    if (conversation.currentPasses.analysis) passes.push('analysis');
    if (conversation.currentPasses.critique) passes.push('critique');
    if (conversation.currentPasses.synthesis) passes.push('synthesis');
    return passes;
  });

  let hasStreamingContent = $derived(
    !!(conversation.currentPasses.analysis || conversation.currentPasses.critique || conversation.currentPasses.synthesis)
  );

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

  async function retryLastQuery(): Promise<void> {
    const lastQuery = conversation.messages.findLast(m => m.role === 'user')?.content;
    if (!lastQuery) return;
    await conversation.submitQuery(lastQuery);
  }

  function handleNodeSelect(nodeId: string): void {
    console.log('[GraphViz] Node selected:', nodeId);
  }

  function handleJumpToReferences(nodeId: string): void {
    console.log('[GraphViz] Jumping to references for:', nodeId);
    panelStore.openPanel();
  }

  // ── Effects ───────────────────────────────────────────────────────────────
  $effect(() => {
    if (conversation.currentPass && ['analysis', 'critique', 'synthesis'].includes(conversation.currentPass)) {
      activeResultPass = conversation.currentPass as 'analysis' | 'critique' | 'synthesis';
    }
  });
</script>

<div class="app-shell">
  <div class="app-body">
    <main class="main-content" id="main" class:panel-open={panelStore.open}>

      <!-- ═══════════════════════════════════════════════════════════════
           STATE 1: QUERY — centred landing screen
           ═══════════════════════════════════════════════════════════════ -->
      {#if isQueryState}
        <div class="query-screen">
          <div class="query-center">
            <div class="sophia-symbol" aria-hidden="true">✦</div>
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
      {#if isLoadingState && !hasStreamingContent}
        <Loading
          currentPass={conversation.currentPass ?? ''}
          statusText={loadingStatusText}
          {completedPasses}
        />
      {/if}

      {#if isLoadingState && hasStreamingContent}
        <div class="results-layout">
          <aside class="pass-nav-col">
            <PassNavigator
              activePass={conversation.currentPass ?? 'analysis'}
              {completedPasses}
              onSelect={(p) => activeResultPass = p as 'analysis' | 'critique' | 'synthesis'}
            />
          </aside>

          <div class="results-col">
            <!-- Graph visualization when available during streaming -->
            {#if graphStore.nodes.length > 0}
              <div class="graph-wrap">
                <GraphCanvas
                  nodes={graphStore.nodes}
                  edges={graphStore.edges}
                  width={Math.min(720, typeof window !== 'undefined' ? window.innerWidth - 280 : 720)}
                  height={360}
                  onNodeSelect={handleNodeSelect}
                  onJumpToReferences={handleJumpToReferences}
                />
              </div>
            {/if}

            {#if conversation.currentPasses.analysis}
              <PassCard
                pass="analysis"
                content={renderPass(conversation.currentPasses.analysis)}
                streaming={conversation.currentPass === 'analysis'}
              />
            {/if}

            {#if conversation.currentPasses.critique}
              <PassCard
                pass="critique"
                content={renderPass(conversation.currentPasses.critique)}
                streaming={conversation.currentPass === 'critique'}
              />
            {/if}

            {#if conversation.currentPasses.synthesis}
              <PassCard
                pass="synthesis"
                content={renderPass(conversation.currentPasses.synthesis)}
                streaming={conversation.currentPass === 'synthesis'}
              />
            {/if}
          </div>
        </div>
      {/if}

      <!-- ═══════════════════════════════════════════════════════════════
           STATE 3: RESULTS — two-column layout
           ═══════════════════════════════════════════════════════════════ -->
      {#if !isLoadingState && lastAssistantMsg && lastAssistantMsg.passes}
        {@const passes = lastAssistantMsg.passes}

        <div class="results-layout">
          <aside class="pass-nav-col">
            <PassNavigator
              activePass={activeResultPass}
              completedPasses={resultsCompletedPasses}
              onSelect={(p) => activeResultPass = p as 'analysis' | 'critique' | 'synthesis'}
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
              <PassCard pass="analysis" content={renderPass(passes.analysis)} />
            {/if}

            {#if passes.critique}
              <PassCard pass="critique" content={renderPass(passes.critique)} />
            {/if}

            {#if passes.synthesis}
              <PassCard pass="synthesis" content={renderPass(passes.synthesis)} />
            {/if}

            <!-- Epistemic status -->
            {#if epistemicContent}
              <EpistemicStatus content={epistemicContent} />
            {/if}

            <!-- Web verification section -->
            {#if passes.synthesis}
              <div class="verification-section">
                {#if passes.verification}
                  <div class="verification-content">
                    <div class="verification-eyebrow">Web Verification</div>
                    <div class="prose">
                      {@html renderPass(passes.verification)}
                    </div>
                  </div>
                {:else}
                  <button
                    class="run-verification-btn"
                    onclick={() => conversation.runVerification()}
                    disabled={conversation.isLoading}
                  >
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

            <!-- Follow-up input -->
            <div class="follow-up-wrap">
              <FollowUpInput
                onSubmit={(text) => conversation.submitQuery(text)}
                disabled={conversation.isLoading}
              />
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
          <button class="error-retry" onclick={retryLastQuery}>Retry</button>
        </div>
      {/if}

    </main>

    <!-- Side panel (References / History / Settings) -->
    <SidePanel open={panelStore.open} onClose={() => panelStore.close()}>
      <TabStrip {tabs} {activeTab} onTabChange={(tab) => activeTab = tab} />

      {#if activeTab === 'references'}
        <ReferencesTab />
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
    font-family: var(--font-display);
    font-size: 2.5rem;
    color: var(--color-sage);
    animation: symbolBreathe 3s ease-in-out infinite;
    margin-bottom: var(--space-4);
    line-height: 1;
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

  /* ── Graph visualization ────────────────────────────────────────────── */
  .graph-wrap {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 3px;
    padding: var(--space-3);
    overflow: hidden;
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
    transition: border-color var(--transition-fast), color var(--transition-fast);
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
    .sophia-symbol {
      animation: none;
    }

    .main-content {
      transition: none;
    }
  }
</style>
