<script lang="ts">
  import { conversation } from '$lib/stores/conversation.svelte';
  import { referencesStore } from '$lib/stores/references.svelte';
  import { historyStore } from '$lib/stores/history.svelte';
  import { panelStore } from '$lib/stores/panel.svelte';
  import { graphStore } from '$lib/stores/graph.svelte';
  import { renderMarkdown } from '$lib/utils/markdown';
  import { getRandomExamples } from '$lib/constants/examples';
  import SidePanel from '$lib/components/panel/SidePanel.svelte';
  import TabStrip, { type TabId, type Tab } from '$lib/components/panel/TabStrip.svelte';
  import ReferencesTab from '$lib/components/references/ReferencesTab.svelte';
  import HistoryTab from '$lib/components/panel/HistoryTab.svelte';
  import SettingsTab from '$lib/components/panel/SettingsTab.svelte';
  import GraphCanvas from '$lib/components/visualization/GraphCanvas.svelte';

  let queryInput = $state('');
  let examplePrompts = $state(getRandomExamples(4, 'ethics'));
  console.log('[Page] Random examples loaded:', examplePrompts.map(e => e.text));
  let activeTab = $state<TabId>('references');
  type PassKey = 'analysis' | 'critique' | 'synthesis' | 'verification';
  const PASS_ORDER: PassKey[] = ['analysis', 'critique', 'synthesis', 'verification'];
  const PASS_LABELS: Record<PassKey, string> = {
    analysis: 'Analysis',
    critique: 'Critique',
    synthesis: 'Synthesis',
    verification: 'Web Verification',
  };

  let activePassByMessage: Record<string, PassKey> = $state({});
  let activeStreamingPass = $state<PassKey>('analysis');
  let streamingTabs = $derived(availablePasses(conversation.currentPasses));

  const tabs: Tab[] = $derived([
    { id: 'references' as const, label: 'References', showLiveDot: referencesStore.isLive },
    { id: 'history' as const, label: 'History' },
    { id: 'settings' as const, label: 'Settings' },
  ]);

  function availablePasses(passes?: Partial<Record<PassKey, string>>): PassKey[] {
    if (!passes) return [];
    return PASS_ORDER.filter((key) => Boolean(passes[key]));
  }

  function getMessageActivePass(
    messageId: string,
    passes?: Partial<Record<PassKey, string>>
  ): PassKey {
    const available = availablePasses(passes);
    if (available.length === 0) return 'analysis';
    const active = activePassByMessage[messageId];
    return active && available.includes(active) ? active : available[0];
  }

  function setMessageActivePass(messageId: string, pass: PassKey): void {
    activePassByMessage = { ...activePassByMessage, [messageId]: pass };
  }

  async function handleSubmit(): Promise<void> {
    if (!queryInput.trim()) return;
    const query = queryInput.trim();
    queryInput = '';
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

  function calculateCost(inputTokens: number, outputTokens: number): number {
    return (inputTokens * 3 + outputTokens * 15) / 1_000_000;
  }

  function handleNodeSelect(nodeId: string): void {
    console.log('[GraphViz] Node selected:', nodeId);
    // Store selection state - detail panel is handled by GraphCanvas itself
  }

  function handleJumpToReferences(nodeId: string): void {
    console.log('[GraphViz] Jumping to references for:', nodeId);
    panelStore.openPanel();
    // TODO: scroll to specific claim/source in references panel
  }

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  $effect(() => {
    if (conversation.currentPass) {
      activeStreamingPass = conversation.currentPass;
    }
  });

  $effect(() => {
    console.log('[Page] Graph store updated:', { nodeCount: graphStore.nodes.length, edgeCount: graphStore.edges.length, nodes: graphStore.nodes.map(n => ({ id: n.id, type: n.type })) });
  });
</script>

<div class="app-shell">
  <div class="app-body">
  <main class="main-content" class:panel-open={panelStore.open} class:has-history={conversation.messages.length > 0}>
    <!-- Empty State with Centered Input -->
    {#if conversation.messages.length === 0 && !conversation.isLoading}
      <div class="empty-state">
        <div class="empty-state-content">
          <h1 class="empty-title">SOPHIA</h1>
          <p class="empty-subtitle">Philosophical Reasoning Engine</p>
          
          <form class="centered-input-form" onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
            <textarea
              bind:value={queryInput}
              onkeydown={handleKeydown}
              placeholder="Ask a philosophical question, explore an argument, or describe a dilemma you're thinking through..."
              class="centered-input-field"
              rows="4"
            ></textarea>
            <button
              type="submit"
              disabled={conversation.isLoading || !queryInput.trim()}
              class="centered-submit-btn"
            >
              Analyze
            </button>
          </form>

          <div class="example-prompts">
            <p class="example-label">Try asking about:</p>
            <div class="example-grid">
              {#each examplePrompts as example (example.text)}
                <button class="example-btn" onclick={() => { queryInput = example.text; handleSubmit(); }}>
                  {example.text}
                </button>
              {/each}
            </div>
          </div>
        </div>
      </div>
    {/if}

    <!-- Conversation View -->
    {#if conversation.messages.length > 0}
      <div class="content-container">
      <div class="space-y-6">
        {#each conversation.messages as message (message.id)}
          {#if message.role === 'user'}
            <!-- User Message -->
            <div class="flex justify-end">
              <div class="bg-sophia-dark-surface-raised rounded-lg px-4 py-3 max-w-lg">
                <p>{message.content}</p>
              </div>
            </div>
          {:else}
            <!-- Assistant Message -->
            <div class="flex flex-col space-y-3">
              <!-- Main Content (Synthesis) -->
              {#if message.content}
                <div class="prose prose-invert prose-sm">
                  {@html renderMarkdown(message.content)}
                </div>
              {/if}

              <!-- Pass Toggle Buttons -->
              {#if message.passes}
                {@const messageTabs = availablePasses(message.passes)}
                {@const selectedPass = getMessageActivePass(message.id, message.passes)}

                {#if messageTabs.length > 0}
                  <div class="pass-tabs" role="tablist" aria-label="Analysis passes">
                    {#each messageTabs as tab}
                      <button
                        role="tab"
                        aria-selected={selectedPass === tab}
                        class="pass-tab-btn"
                        class:is-active={selectedPass === tab}
                        class:is-analysis={tab === 'analysis'}
                        class:is-critique={tab === 'critique'}
                        class:is-synthesis={tab === 'synthesis'}
                        onclick={() => setMessageActivePass(message.id, tab)}
                      >
                        {PASS_LABELS[tab]}
                      </button>
                    {/each}
                  </div>

                  {#if message.passes[selectedPass]}
                    <div
                      class="pass-content-panel"
                      class:is-analysis={selectedPass === 'analysis'}
                      class:is-critique={selectedPass === 'critique'}
                      class:is-synthesis={selectedPass === 'synthesis'}
                    >
                      <div class="prose prose-invert prose-sm">
                        {@html renderMarkdown(message.passes[selectedPass] ?? '')}
                      </div>
                    </div>
                  {/if}
                {/if}

                <!-- Confidence Assessment -->
                {#if conversation.confidenceSummary && !conversation.isLoading}
                  <div class="bg-sophia-dark-surface-raised border border-sophia-dark-border rounded-lg p-4 mt-4">
                    <h3 class="text-sm font-semibold mb-3 text-sophia-dark-text">Confidence Assessment</h3>
                    <div class="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <span class="text-sophia-dark-muted text-xs block mb-1">Average Confidence</span>
                        <div class="text-2xl font-bold text-sophia-dark-sage">
                          {(conversation.confidenceSummary.avgConfidence * 100).toFixed(0)}%
                        </div>
                      </div>
                      <div>
                        <span class="text-sophia-dark-muted text-xs block mb-1">Needs Review</span>
                        <div class="text-2xl font-bold text-sophia-dark-coral">
                          {conversation.confidenceSummary.lowConfidenceCount}/{conversation.confidenceSummary.totalClaims}
                        </div>
                      </div>
                    </div>
                    <button 
                      onclick={() => conversation.runVerification()}
                      class="w-full bg-sophia-dark-sage text-sophia-dark-surface px-4 py-2 rounded font-semibold hover:opacity-90 transition-opacity"
                    >
                      Run Web Verification
                    </button>
                  </div>
                {/if}

                <!-- Metadata -->
                {#if message.metadata}
                  <div class="font-mono text-xs text-sophia-dark-muted pt-2 border-t border-sophia-dark-border">
                    <span>{message.metadata.total_input_tokens} in</span>
                    <span class="mx-1">•</span>
                    <span>{message.metadata.total_output_tokens} out</span>
                    <span class="mx-1">•</span>
                    <span>{formatDuration(message.metadata.duration_ms)}</span>
                    <span class="mx-1">•</span>
                    <span>${calculateCost(message.metadata.total_input_tokens, message.metadata.total_output_tokens).toFixed(6)}</span>
                  </div>
                {/if}
              {/if}
            </div>
          {/if}
        {/each}

        <!-- Streaming State -->
        {#if conversation.isLoading}
          <div class="flex flex-col space-y-4">
            {#if !conversation.currentPasses.analysis && !conversation.currentPasses.critique && !conversation.currentPasses.synthesis}
              <div class="flex items-center gap-2 text-sophia-dark-muted">
                <div class="w-2 h-2 bg-sophia-dark-sage rounded-full animate-pulse"></div>
                <span class="font-mono text-sm">Thinking…</span>
              </div>
            {/if}

            <!-- Graph Visualization (during streaming with data) -->
            {#if graphStore.nodes.length > 0}
              <div class="graph-container">
                <GraphCanvas
                  nodes={graphStore.nodes}
                  edges={graphStore.edges}
                  width={Math.min(800, typeof window !== 'undefined' ? window.innerWidth - 64 : 800)}
                  height={400}
                  onNodeSelect={handleNodeSelect}
                  onJumpToReferences={handleJumpToReferences}
                />
              </div>
            {/if}

            {#if streamingTabs.length > 0}
              <div class="pass-tabs" role="tablist" aria-label="Streaming analysis passes">
                {#each streamingTabs as tab}
                  <button
                    role="tab"
                    aria-selected={activeStreamingPass === tab}
                    class="pass-tab-btn"
                    class:is-active={activeStreamingPass === tab}
                    class:is-analysis={tab === 'analysis'}
                    class:is-critique={tab === 'critique'}
                    class:is-synthesis={tab === 'synthesis'}
                    onclick={() => activeStreamingPass = tab}
                  >
                    {PASS_LABELS[tab]}
                    {#if conversation.currentPass === tab}
                      <span class="tab-live-dot" aria-hidden="true"></span>
                    {/if}
                  </button>
                {/each}
              </div>

              {#if conversation.currentPasses[activeStreamingPass]}
                <div
                  class="pass-content-panel"
                  class:is-live={conversation.currentPass === activeStreamingPass}
                  class:is-analysis={activeStreamingPass === 'analysis'}
                  class:is-critique={activeStreamingPass === 'critique'}
                  class:is-synthesis={activeStreamingPass === 'synthesis'}
                >
                  <div class="prose prose-invert prose-sm">
                    {@html renderMarkdown(conversation.currentPasses[activeStreamingPass] ?? '')}
                  </div>
                </div>
              {/if}
            {/if}
          </div>
        {/if}

        <!-- Confidence Summary Card (after synthesis completes) -->
        {#if !conversation.isLoading && conversation.confidenceSummary}
          <div class="confidence-summary-card">
            <h3 class="confidence-summary-title">Confidence Summary</h3>
            <div class="confidence-metrics">
              <div class="confidence-metric">
                <span class="confidence-label">Average Confidence:</span>
                <span class="confidence-value">{(conversation.confidenceSummary.avgConfidence * 100).toFixed(1)}%</span>
              </div>
              <div class="confidence-metric">
                <span class="confidence-label">Low Confidence Claims:</span>
                <span class="confidence-value">{conversation.confidenceSummary.lowConfidenceCount} / {conversation.confidenceSummary.totalClaims}</span>
              </div>
            </div>
            <button
              class="run-verification-btn"
              onclick={() => conversation.runVerification()}
              disabled={conversation.isLoading || !!conversation.currentPasses.verification}
            >
              {conversation.currentPasses.verification ? 'Verification Complete' : 'Run Web Verification'}
            </button>
          </div>
        {/if}

        <!-- Error State -->
        {#if conversation.error}
          <div class="bg-red-950/30 border border-red-800/50 rounded-lg px-4 py-3">
            <p class="text-red-200 font-mono text-sm">{conversation.error}</p>
          </div>
        {/if}
      </div>
    </div>

      <!-- Input Footer (for conversation view only) -->
      <footer class="input-footer">
        <div class="input-container">
          <textarea
            bind:value={queryInput}
            onkeydown={handleKeydown}
            disabled={conversation.isLoading}
            rows="2"
            placeholder="What would you like to think about next?"
            class="input-textarea"
          ></textarea>
          <button
            onclick={handleSubmit}
            disabled={conversation.isLoading || !queryInput.trim()}
            class="submit-btn"
          >
            Think
          </button>
        </div>
      </footer>
    {/if}

  </main>

  <SidePanel open={panelStore.open} onClose={() => panelStore.close()}>
    <TabStrip {tabs} {activeTab} onTabChange={(tab) => activeTab = tab} />

    {#if activeTab === 'references'}
      <ReferencesTab />
    {:else if activeTab === 'history'}
      <HistoryTab entries={historyStore.items} onSelect={handleHistorySelect} />
    {:else if activeTab === 'settings'}
      <SettingsTab />
    {/if}
  </SidePanel>
  </div>
</div>

<style>
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
    transition: margin-right 0.35s cubic-bezier(0.32, 0.72, 0, 1);
    overflow-y: auto;
    padding: var(--space-5) var(--space-3);
  }

  .main-content.has-history {
    padding: var(--space-5) var(--space-3);
  }

  /* ── Empty State (centered input form) ── */
  .empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100%;
    padding: var(--space-5);
  }

  .empty-state-content {
    width: 100%;
    max-width: 640px;
    text-align: center;
  }

  .empty-title {
    font-family: var(--font-display);
    font-size: 3.5rem;
    font-weight: 500;
    letter-spacing: 0.12em;
    color: var(--color-text);
    margin: 0 0 var(--space-1);
  }

  .empty-subtitle {
    font-family: var(--font-ui);
    font-size: 0.875rem;
    letter-spacing: 0.1em;
    color: var(--color-muted);
    margin: 0 0 var(--space-5);
    text-transform: uppercase;
  }

  /* ── Centered Input Form ── */
  .centered-input-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-bottom: var(--space-5);
  }

  .centered-input-field {
    font-family: var(--font-display);
    font-size: 1.0625rem;
    font-weight: 400;
    line-height: 1.65;
    letter-spacing: var(--tracking-body);
    color: var(--color-text);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    resize: none;
    transition: border-color var(--transition-fast), background var(--transition-fast);
  }

  .centered-input-field:focus {
    outline: none;
    border-color: var(--color-sage);
    background: var(--color-surface-raised);
  }

  .centered-input-field::placeholder {
    color: var(--color-dim);
  }

  .centered-submit-btn {
    font-family: var(--font-ui);
    font-size: var(--text-label);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-sage-border);
    background: var(--color-sage-bg);
    color: var(--color-sage);
    cursor: pointer;
    transition: border-color var(--transition-fast), background var(--transition-fast);
  }

  .centered-submit-btn:hover:not(:disabled) {
    border-color: var(--color-sage);
    background: rgba(127, 163, 131, 0.2);
  }

  .centered-submit-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  /* ── Example Prompts ── */
  .example-prompts {
    text-align: center;
  }

  .example-label {
    font-family: var(--font-ui);
    font-size: var(--text-meta);
    letter-spacing: 0.05em;
    color: var(--color-dim);
    margin: 0 0 var(--space-3);
    text-transform: uppercase;
  }

  .example-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: var(--space-2);
    max-width: 640px;
  }

  .example-btn {
    font-family: var(--font-display);
    font-size: 1rem;
    font-weight: 400;
    color: var(--color-text);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: var(--space-2);
    cursor: pointer;
    transition: border-color var(--transition-fast), background var(--transition-fast);
    text-align: center;
    line-height: 1.6;
  }

  .example-btn:hover {
    border-color: var(--color-sage-border);
    background: var(--color-surface-raised);
  }

  .content-container {
    max-width: var(--content-max);
    margin: 0 auto;
    width: 100%;
  }

  .pass-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding-top: var(--space-2);
  }

  .pass-tab-btn {
    --pass-color: var(--color-sage);
    --pass-border: var(--color-sage-border);
    --pass-bg: var(--color-sage-bg);
    font-family: var(--font-ui);
    font-size: var(--text-ui);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-muted);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: border-color var(--transition-fast), color var(--transition-fast), background var(--transition-fast);
  }

  .pass-tab-btn.is-analysis {
    --pass-color: var(--color-sage);
    --pass-border: var(--color-sage-border);
    --pass-bg: var(--color-sage-bg);
  }

  .pass-tab-btn.is-critique {
    --pass-color: var(--color-copper);
    --pass-border: var(--color-copper-border);
    --pass-bg: var(--color-copper-bg);
  }

  .pass-tab-btn.is-synthesis {
    --pass-color: var(--color-blue);
    --pass-border: var(--color-blue-border);
    --pass-bg: var(--color-blue-bg);
  }

  .pass-tab-btn:hover {
    border-color: var(--pass-border);
    color: var(--color-text);
  }

  .pass-tab-btn.is-active {
    border-color: var(--pass-border);
    background: var(--pass-bg);
    color: var(--pass-color);
  }

  .tab-live-dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: currentColor;
    animation: pulse-dot 1.1s ease-in-out infinite;
  }

  .pass-content-panel {
    margin-top: var(--space-2);
    border: 1px solid var(--color-border);
    background: var(--color-surface-sunken);
    border-radius: var(--radius-md);
    padding: var(--space-3) var(--space-4);
  }

  .pass-content-panel.is-live {
    border-color: var(--color-sage-border);
  }

  .pass-content-panel.is-analysis {
    border-color: var(--color-sage-border);
  }

  .pass-content-panel.is-critique {
    border-color: var(--color-copper-border);
  }

  .pass-content-panel.is-synthesis {
    border-color: var(--color-blue-border);
  }

  @keyframes pulse-dot {
    0%, 100% { opacity: 0.35; }
    50% { opacity: 1; }
  }

  .input-footer {
    border-top: 1px solid var(--color-border);
    padding: var(--space-3);
    margin-top: auto;
  }

  .input-container {
    max-width: var(--input-max);
    margin: 0 auto;
    display: flex;
    gap: var(--space-2);
  }

  .input-textarea {
    flex: 1;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-display);
    font-size: 1rem;
    line-height: 1.55;
    letter-spacing: var(--tracking-body);
    color: var(--color-text);
    resize: none;
  }

  .input-textarea::placeholder {
    color: var(--color-muted);
  }

  .input-textarea:focus {
    outline: none;
    border-color: var(--color-sage-border);
  }

  .input-textarea:disabled {
    opacity: 0.5;
  }

  .submit-btn {
    font-family: var(--font-ui);
    font-size: var(--text-ui);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-sage-border);
    background: var(--color-sage-bg);
    color: var(--color-sage);
    cursor: pointer;
    white-space: nowrap;
    align-self: flex-end;
    transition: border-color var(--transition-fast), background var(--transition-fast);
  }

  .submit-btn:hover:not(:disabled) {
    border-color: var(--color-sage);
    background: rgba(127, 163, 131, 0.2);
  }

  .submit-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  :global(.prose) {
    --tw-prose-body: #E8E6E1;
    --tw-prose-headings: #E8E6E1;
    --tw-prose-links: #6FA3D4;
    --tw-prose-bold: #E8E6E1;
    --tw-prose-code: #E8E6E1;

    /* Typography overrides */
    font-family: var(--font-display);
    font-weight: 400;
    font-size: var(--text-body);
    line-height: var(--leading-body);
    letter-spacing: var(--tracking-body);
    color: var(--color-text);
    max-width: 65ch;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  :global(.prose h1) {
    font-size: clamp(2.1rem, 3vw, 2.6rem);
    font-weight: 600;
    line-height: var(--leading-display);
    margin-top: var(--space-section);
    margin-bottom: var(--space-3);
    color: var(--color-text);
  }

  :global(.prose h1:first-child) {
    margin-top: 0;
  }

  :global(.prose h2) {
    font-size: 1.6rem;
    font-weight: 600;
    line-height: var(--leading-display);
    margin-top: var(--space-section);
    margin-bottom: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border);
    color: var(--color-text);
  }

  :global(.prose h2:first-child) {
    margin-top: 0;
    padding-top: 0;
    border-top: none;
  }

  :global(.prose h3) {
    font-size: 1.25rem;
    font-weight: 600;
    line-height: var(--leading-display);
    margin-top: var(--space-5);
    margin-bottom: var(--space-2);
    color: var(--color-text);
  }

  :global(.prose p) {
    margin-bottom: var(--space-paragraph);
    margin-top: 0;
  }

  :global(.prose ul, .prose ol) {
    margin-bottom: var(--space-paragraph);
    padding-left: var(--space-5);
  }

  :global(.prose li) {
    margin-bottom: var(--space-3);
  }

  :global(.prose li > p) {
    margin: 0;
  }

  :global(.prose strong) {
    font-weight: 600;
  }

  :global(.prose em) {
    font-style: italic;
  }

  :global(.prose code) {
    font-family: var(--font-ui);
    font-size: 0.9em;
    color: var(--color-blue);
    background: var(--color-surface-raised);
    padding: 0.25em 0.5em;
    border-radius: 2px;
  }

  :global(.prose blockquote) {
    border-left: 3px solid var(--color-sage);
    padding-left: var(--space-3);
    margin: var(--space-section) 0;
    color: var(--color-muted);
    font-style: normal;
    background: var(--color-surface-sunken);
    padding-top: var(--space-3);
    padding-bottom: var(--space-3);
  }

  :global(.prose hr) {
    border: none;
    border-top: 1px solid var(--color-border);
    margin: var(--space-5) 0;
  }

  :global(.prose a) {
    color: var(--color-blue);
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
    transition: color var(--transition-fast);
  }

  :global(.prose a:hover) {
    color: var(--color-sage);
  }

  :global(html.reduce-motion) .main-content {
    transition: none !important;
  }

  :global(html.reduce-motion) .centered-input-field {
    transition: none !important;
  }

  :global(html.reduce-motion) .centered-submit-btn {
    transition: none !important;
  }

  :global(html.reduce-motion) .example-btn {
    transition: none !important;
  }

  :global(html.reduce-motion) .input-textarea {
    transition: none !important;
  }

  :global(html.reduce-motion) .submit-btn {
    transition: none !important;
  }

  :global(html.reduce-motion) .pass-tab-btn {
    transition: none !important;
  }

  :global(html.reduce-motion) .tab-live-dot {
    animation: none !important;
  }

  .graph-container {
    margin: var(--space-4) 0;
    padding: var(--space-3);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  @media (max-width: 600px) {
    .example-grid {
      grid-template-columns: 1fr;
    }

    .empty-title {
      font-size: 2.5rem;
    }
  }
</style>
