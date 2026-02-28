<script lang="ts">
  import { onMount } from 'svelte';

  interface StreamMessage {
    pass?: string;
    chunk?: string;
    done?: boolean;
    error?: string;
    complete?: boolean;
  }

  let query = '';
  let messages: Array<{role: string; content: string; timestamp: number; passes?: any}> = [];
  let loading = false;
  let error = '';
  let messagesContainer: HTMLDivElement;

  async function submitQuery() {
    if (!query.trim()) return;

    const userMsg = {
      role: 'user',
      content: query,
      timestamp: Date.now()
    };
    messages = [...messages, userMsg];
    query = '';
    loading = true;
    error = '';

    try {
      const response = await fetch('/api/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: userMsg.content })
      });

      if (!response.ok) throw new Error(\`API error: \${response.statusText}\`);

      const assistantMsg = {
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        passes: { analysis: '', critique: '', synthesis: '' }
      };
      messages = [...messages, assistantMsg];

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let currentPass: 'analysis' | 'critique' | 'synthesis' = 'analysis';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6)) as StreamMessage;
              if (data.complete) {
                loading = false;
              } else if (data.error) {
                error = data.error;
                loading = false;
              } else if (data.pass && data.chunk) {
                currentPass = data.pass as any;
                assistantMsg.passes[currentPass] += data.chunk;
                assistantMsg.content += data.chunk;
                messages = messages;
              }
            } catch (e) {}
          }
        }
      }
    } catch (err) {
      error = String(err);
      loading = false;
    }

    setTimeout(() => {
      messagesContainer?.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' });
    }, 0);
  }

  onMount(() => {
    const input = document.querySelector('input') as HTMLInputElement;
    input?.focus();
  });
</script>

<svelte:head>
  <title>SOPHIA — Philosophical Reasoning Engine</title>
</svelte:head>

<div style="display: flex; flex-direction: column; height: 100vh; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5;">
  <!-- Header -->
  <div style="background: #2d4320; color: white; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <h1 style="margin: 0; font-size: 28px; font-weight: bold;">SOPHIA</h1>
    <p style="margin: 5px 0 0; font-size: 13px; opacity: 0.9;">Philosophical Reasoning Engine (Phase 1-2 Validation)</p>
  </div>

  <!-- Messages -->
  <div bind:this={messagesContainer} style="flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 15px;">
    {#each messages as msg}
      {#if msg.role === 'user'}
        <div style="display: flex; justify-content: flex-end;">
          <div style="background: #2d4320; color: white; padding: 12px 16px; border-radius: 8px; max-width: 70%; word-wrap: break-word;">
            <strong>You:</strong>
            <div style="margin-top: 4px;">{msg.content}</div>
          </div>
        </div>
      {:else}
        <div style="display: flex; justify-content: flex-start;">
          <div style="background: white; border: 1px solid #ddd; padding: 16px; border-radius: 8px; max-width: 100%; width: 100%;">
            {#if msg.passes}
              {#if msg.passes.analysis}
                <div style="margin-bottom: 20px; border-left: 4px solid #78af60; padding-left: 12px;">
                  <strong style="color: #5a8640;">PASS 1: ANALYSIS (Proponent)</strong>
                  <div style="margin-top: 8px; font-size: 13px; line-height: 1.6; white-space: pre-wrap; color: #333;">
                    {msg.passes.analysis}
                  </div>
                </div>
              {/if}
              {#if msg.passes.critique}
                <div style="margin-bottom: 20px; border-left: 4px solid #ff9800; padding-left: 12px;">
                  <strong style="color: #e67e22;">PASS 2: CRITIQUE (Adversary)</strong>
                  <div style="margin-top: 8px; font-size: 13px; line-height: 1.6; white-space: pre-wrap; color: #333;">
                    {msg.passes.critique}
                  </div>
                </div>
              {/if}
              {#if msg.passes.synthesis}
                <div style="border-left: 4px solid #27ae60; padding-left: 12px;">
                  <strong style="color: #27ae60;">PASS 3: SYNTHESIS (Integrator)</strong>
                  <div style="margin-top: 8px; font-size: 13px; line-height: 1.6; white-space: pre-wrap; color: #333;">
                    {msg.passes.synthesis}
                  </div>
                </div>
              {/if}
            {:else}
              <p style="margin: 0; color: #999; font-size: 13px; font-style: italic;">Processing...</p>
            {/if}
          </div>
        </div>
      {/if}
    {/each}

    {#if loading}
      <div style="display: flex; justify-content: flex-start;">
        <div style="background: white; border: 1px solid #ddd; padding: 12px 16px; border-radius: 8px;">
          <p style="margin: 0; font-size: 13px; color: #999;">Analyzing your question...</p>
        </div>
      </div>
    {/if}

    {#if error}
      <div style="display: flex; justify-content: flex-start;">
        <div style="background: #fee; border: 1px solid #fcc; color: #c00; padding: 12px 16px; border-radius: 8px; font-size: 13px;">
          <strong>Error:</strong> {error}
        </div>
      </div>
    {/if}
  </div>

  <!-- Input -->
  <div style="background: white; border-top: 1px solid #ddd; padding: 16px 20px; box-shadow: 0 -1px 3px rgba(0,0,0,0.05);">
    <form on:submit|preventDefault={submitQuery}>
      <div style="display: flex; gap: 8px; margin-bottom: 12px;">
        <input
          bind:value={query}
          type="text"
          placeholder="Ask a philosophical question..."
          disabled={loading}
          style="flex: 1; padding: 10px 12px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; font-family: inherit;"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          style="padding: 10px 16px; background: #2d4320; color: white; border: none; border-radius: 4px; font-size: 14px; font-weight: 500; cursor: pointer; opacity: {loading || !query.trim() ? 0.6 : 1};"
        >
          {loading ? 'Analyzing...' : 'Analyze'}
        </button>
      </div>
      <p style="margin: 0; font-size: 12px; color: #666;">
        Test cases: Try "Is it ethical to use AI triage in emergency rooms?" or "Compare utilitarianism and deontology on organ transplants"
      </p>
    </form>
  </div>
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
</style>
