<script lang="ts">
  import { conversation } from '$lib/stores/conversation.svelte';
  import { renderMarkdown } from '$lib/utils/markdown';

  let queryInput = $state('');
  let expandedPasses: Record<string, Set<string>> = $state({});

  function togglePass(messageId: string, pass: string): void {
    if (!expandedPasses[messageId]) {
      expandedPasses[messageId] = new Set();
    }
    if (expandedPasses[messageId].has(pass)) {
      expandedPasses[messageId].delete(pass);
    } else {
      expandedPasses[messageId].add(pass);
    }
  }

  function isPassExpanded(messageId: string, pass: string): boolean {
    return expandedPasses[messageId]?.has(pass) ?? false;
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

  function calculateCost(inputTokens: number, outputTokens: number): number {
    return (inputTokens * 3 + outputTokens * 15) / 1_000_000;
  }

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }
</script>

<div class="min-h-screen flex flex-col bg-sophia-dark-bg text-sophia-dark-text">
  <!-- HEADER -->
  <header class="border-b border-sophia-dark-border">
    <div class="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
      <h1 class="font-serif text-2xl tracking-wide text-sophia-dark-sage shrink-0">SOPHIA</h1>
      <p class="font-mono text-xs sm:text-sm text-sophia-dark-dim text-right">philosophical reasoning engine</p>
    </div>
  </header>

  <!-- MAIN -->
  <main class="flex-1 overflow-y-auto px-4 sm:px-6 py-8">
    <div class="max-w-3xl mx-auto">
      <!-- Empty State -->
      {#if conversation.messages.length === 0 && !conversation.isLoading}
        <div class="flex flex-col items-center justify-center min-h-[60vh] text-center">
          <p class="font-serif italic text-2xl mb-4">What would you like to think about?</p>
          <p class="text-sophia-dark-muted max-w-md">
            Ask a question, paste an argument, describe a dilemma.
          </p>
        </div>
      {/if}

      <!-- Message List -->
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
                <div class="flex gap-3 pt-2">
                  <button
                    class="font-mono text-xs px-2 py-1 rounded border transition-colors {isPassExpanded(message.id, 'analysis')
                      ? 'bg-sophia-dark-sage/20 border-sophia-dark-sage/50 text-sophia-dark-sage'
                      : 'border-sophia-dark-sage/20 text-sophia-dark-sage hover:border-sophia-dark-sage/50'}"
                    onclick={() => togglePass(message.id, 'analysis')}
                  >
                    Analysis
                  </button>
                  <button
                    class="font-mono text-xs px-2 py-1 rounded border transition-colors {isPassExpanded(message.id, 'critique')
                      ? 'bg-sophia-dark-copper/20 border-sophia-dark-copper/50 text-sophia-dark-copper'
                      : 'border-sophia-dark-copper/20 text-sophia-dark-copper hover:border-sophia-dark-copper/50'}"
                    onclick={() => togglePass(message.id, 'critique')}
                  >
                    Critique
                  </button>
                  <button
                    class="font-mono text-xs px-2 py-1 rounded border transition-colors {isPassExpanded(message.id, 'synthesis')
                      ? 'bg-sophia-dark-blue/20 border-sophia-dark-blue/50 text-sophia-dark-blue'
                      : 'border-sophia-dark-blue/20 text-sophia-dark-blue hover:border-sophia-dark-blue/50'}"
                    onclick={() => togglePass(message.id, 'synthesis')}
                  >
                    Synthesis
                  </button>
                </div>

                <!-- Expanded Pass Content -->
                {#if isPassExpanded(message.id, 'analysis') && message.passes.analysis}
                  <div class="border-l-2 border-sophia-dark-sage/50 pl-4 py-2 text-sm prose prose-invert prose-sm">
                    {@html renderMarkdown(message.passes.analysis)}
                  </div>
                {/if}
                {#if isPassExpanded(message.id, 'critique') && message.passes.critique}
                  <div class="border-l-2 border-sophia-dark-copper/50 pl-4 py-2 text-sm prose prose-invert prose-sm">
                    {@html renderMarkdown(message.passes.critique)}
                  </div>
                {/if}
                {#if isPassExpanded(message.id, 'synthesis') && message.passes.synthesis}
                  <div class="border-l-2 border-sophia-dark-blue/50 pl-4 py-2 text-sm prose prose-invert prose-sm">
                    {@html renderMarkdown(message.passes.synthesis)}
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

            {#if conversation.currentPasses.analysis}
              <div class="border-l-2 border-sophia-dark-sage/50 pl-4 py-2 {conversation.currentPass === 'analysis' ? 'animate-pulse' : ''}">
                <div class="flex items-center gap-2 mb-1">
                  <p class="font-mono text-xs text-sophia-dark-sage">Analysis (Proponent)</p>
                  {#if conversation.currentPass === 'analysis'}
                    <div class="w-1.5 h-1.5 bg-sophia-dark-sage rounded-full animate-pulse"></div>
                  {/if}
                </div>
                <div class="prose prose-invert prose-sm">
                  {@html renderMarkdown(conversation.currentPasses.analysis)}
                </div>
              </div>
            {/if}

            {#if conversation.currentPasses.critique}
              <div class="border-l-2 border-sophia-dark-copper/50 pl-4 py-2 {conversation.currentPass === 'critique' ? 'animate-pulse' : ''}">
                <div class="flex items-center gap-2 mb-1">
                  <p class="font-mono text-xs text-sophia-dark-copper">Critique (Adversary)</p>
                  {#if conversation.currentPass === 'critique'}
                    <div class="w-1.5 h-1.5 bg-sophia-dark-copper rounded-full animate-pulse"></div>
                  {/if}
                </div>
                <div class="prose prose-invert prose-sm">
                  {@html renderMarkdown(conversation.currentPasses.critique)}
                </div>
              </div>
            {/if}

            {#if conversation.currentPasses.synthesis}
              <div class="border-l-2 border-sophia-dark-blue/50 pl-4 py-2 {conversation.currentPass === 'synthesis' ? 'animate-pulse' : ''}">
                <div class="flex items-center gap-2 mb-1">
                  <p class="font-mono text-xs text-sophia-dark-blue">Synthesis (Integrator)</p>
                  {#if conversation.currentPass === 'synthesis'}
                    <div class="w-1.5 h-1.5 bg-sophia-dark-blue rounded-full animate-pulse"></div>
                  {/if}
                </div>
                <div class="prose prose-invert prose-sm">
                  {@html renderMarkdown(conversation.currentPasses.synthesis)}
                </div>
              </div>
            {/if}
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
  </main>

  <!-- FOOTER -->
  <footer class="border-t border-sophia-dark-border">
    <div class="max-w-4xl mx-auto px-4 sm:px-6 py-4">
      <div class="flex gap-2">
        <textarea
          bind:value={queryInput}
          onkeydown={handleKeydown}
          disabled={conversation.isLoading}
          rows="2"
          placeholder="What would you like to think about?"
          class="flex-1 bg-sophia-dark-surface border border-sophia-dark-border rounded px-3 py-2 font-sans text-sm text-sophia-dark-text placeholder-sophia-dark-muted focus:outline-none focus:border-sophia-dark-sage/50 disabled:opacity-50 resize-none"
        ></textarea>
        <button
          onclick={handleSubmit}
          disabled={conversation.isLoading || !queryInput.trim()}
          class="font-mono text-sm px-4 py-2 rounded border border-sophia-dark-sage/30 bg-sophia-dark-sage/10 text-sophia-dark-sage hover:border-sophia-dark-sage/50 hover:bg-sophia-dark-sage/20 disabled:opacity-30 transition-colors whitespace-nowrap h-fit self-end"
        >
          Think
        </button>
      </div>
    </div>
  </footer>
</div>

<style>
  :global(.prose) {
    --tw-prose-body: #E8E6E1;
    --tw-prose-headings: #E8E6E1;
    --tw-prose-links: #6FA3D4;
    --tw-prose-bold: #E8E6E1;
    --tw-prose-code: #E8E6E1;
  }
</style>
