<script lang="ts">
  import { onMount } from 'svelte';
  import { stoaConversationStore } from '$lib/stores/stoaConversation.svelte';

  let draft = $state('');
  let showDetails = $state(false);
  let showOnboarding = $state(false);
  let onboardingStep = $state(1);
  let onboardingStoicLevel = $state<'new' | 'some_exposure' | 'regular_practitioner'>('new');
  let onboardingPrimaryChallenge = $state('');
  let onboardingGoals = $state('');
  let onboardingTriggers = $state('');
  let goalDraft = $state('');
  let triggerDraft = $state('');
  let practiceDraft = $state('');
  let reflectionDraft = $state('');
  let ritualMode = $state<'none' | 'morning' | 'evening'>('none');
  let ritualQ1 = $state('');
  let ritualQ2 = $state('');
  let ritualQ3 = $state('');
  let selectedSuggestions = $state<string[]>([]);
  let showGroundingExplainer = $state(false);
  let expandedSource = $state<string | null>(null);
  let doneToday = $state(false);
  let doneTonight = $state(false);
  let doneWeek = $state(false);
  let hasAgentResponse = $derived(stoaConversationStore.messages.some((message) => message.role === 'agent'));

  const CONFIDENCE_LABEL: Record<string, string> = {
    high: 'High',
    medium: 'Medium',
    low: 'Low'
  };

  function addProfile(kind: 'goals' | 'triggers' | 'practices'): void {
    if (kind === 'goals') {
      void stoaConversationStore.addProfileItem('goals', goalDraft);
      goalDraft = '';
      return;
    }
    if (kind === 'triggers') {
      void stoaConversationStore.addProfileItem('triggers', triggerDraft);
      triggerDraft = '';
      return;
    }
    void stoaConversationStore.addProfileItem('practices', practiceDraft);
    practiceDraft = '';
  }

  async function submit(): Promise<void> {
    const message = draft.trim();
    if (!message || stoaConversationStore.isLoading) return;
    draft = '';
    await stoaConversationStore.send(message);
  }

  async function submitOnboarding(): Promise<void> {
    await stoaConversationStore.completeOnboarding({
      stoicLevel: onboardingStoicLevel,
      primaryChallenge: onboardingPrimaryChallenge.trim(),
      goals: onboardingGoals
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 3),
      triggers: onboardingTriggers
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 6),
      intakeVersion: 1
    });
    showOnboarding = false;
  }

  async function confirmSuggestions(): Promise<void> {
    await stoaConversationStore.confirmActionSuggestions(selectedSuggestions);
    selectedSuggestions = [];
  }

  async function saveReflection(): Promise<void> {
    if (!reflectionDraft.trim()) return;
    await stoaConversationStore.saveJournalReflection(reflectionDraft, ['session_reflection']);
    reflectionDraft = '';
  }

  async function runRitual(): Promise<void> {
    if (ritualMode === 'none') return;
    const start = Date.now();
    if (ritualMode === 'morning') {
      await stoaConversationStore.runRitual({
        ritualType: 'morning',
        answers: {
          test: ritualQ1,
          virtue: ritualQ2
        },
        durationSeconds: Math.floor((Date.now() - start) / 1000)
      });
    } else {
      await stoaConversationStore.runRitual({
        ritualType: 'evening',
        answers: {
          wentWell: ritualQ1,
          differently: ritualQ2,
          controlCheck: ritualQ3
        },
        durationSeconds: Math.floor((Date.now() - start) / 1000)
      });
    }
    ritualQ1 = '';
    ritualQ2 = '';
    ritualQ3 = '';
    ritualMode = 'none';
  }

  onMount(async () => {
    await stoaConversationStore.loadBootstrap();
    showOnboarding = stoaConversationStore.onboardingStatus === 'required';
    if (stoaConversationStore.onboardingDraft) {
      onboardingStoicLevel = stoaConversationStore.onboardingDraft.stoicLevel;
      onboardingPrimaryChallenge = stoaConversationStore.onboardingDraft.primaryChallenge ?? '';
      onboardingGoals = stoaConversationStore.onboardingDraft.goals.join(', ');
      onboardingTriggers = stoaConversationStore.onboardingDraft.triggers.join(', ');
    }
  });
</script>

<svelte:head>
  <title>Stoa Dialogue | SOPHIA</title>
</svelte:head>

<main class="stoa-page">
  {#if showOnboarding}
    <section class="onboarding-modal" role="dialog" aria-modal="true" aria-label="STOA intake">
      <h2>Welcome to STOA</h2>
      <p>Quick intake ({onboardingStep}/4) to personalize your coach.</p>
      {#if onboardingStep === 1}
        <label for="stoic-level">How familiar are you with Stoicism?</label>
        <select id="stoic-level" bind:value={onboardingStoicLevel}>
          <option value="new">New to Stoicism</option>
          <option value="some_exposure">Some exposure</option>
          <option value="regular_practitioner">Regular practitioner</option>
        </select>
      {:else if onboardingStep === 2}
        <label for="primary-challenge">What is your primary life challenge right now?</label>
        <input id="primary-challenge" bind:value={onboardingPrimaryChallenge} placeholder="Work stress, relationship conflict, anxiety before decisions..." />
      {:else if onboardingStep === 3}
        <label for="goals">Key goals (comma separated, up to 3)</label>
        <input id="goals" bind:value={onboardingGoals} placeholder="Stay calmer in conflict, improve focus" />
      {:else}
        <label for="triggers">Recurring emotional triggers (comma separated)</label>
        <input id="triggers" bind:value={onboardingTriggers} placeholder="Criticism, uncertainty, delays" />
      {/if}
      <div class="actions">
        <button type="button" class="secondary" onclick={() => (onboardingStep = Math.max(1, onboardingStep - 1))}>
          Back
        </button>
        {#if onboardingStep < 4}
          <button type="button" class="primary" onclick={() => (onboardingStep += 1)}>Next</button>
        {:else}
          <button
            type="button"
            class="primary"
            disabled={!onboardingPrimaryChallenge.trim()}
            onclick={submitOnboarding}
          >
            Start STOA
          </button>
        {/if}
      </div>
    </section>
  {/if}

  <section class="stoa-header">
    <h1>Stoa Dialogue (Mode 6)</h1>
    <p>A focused Stoic coach with practical next steps.</p>
  </section>

  <section class="ritual-quick-actions">
    <button type="button" class="secondary" onclick={() => (ritualMode = 'morning')}>Morning Ritual</button>
    <button type="button" class="secondary" onclick={() => (ritualMode = 'evening')}>Evening Review</button>
    <a class="secondary journal-link" href="/stoa/journal">Journal History</a>
  </section>

  {#if stoaConversationStore.currentCurriculumWeek}
    <section class="curriculum-card">
      <h2>Current Stoic Concept - Week {stoaConversationStore.currentCurriculumWeek.weekNumber}</h2>
      <p class="curriculum-title">{stoaConversationStore.currentCurriculumWeek.conceptTitle}</p>
      <p><strong>Daily practice:</strong> {stoaConversationStore.currentCurriculumWeek.practicePrompt}</p>
      <p><strong>Reflection:</strong> {stoaConversationStore.currentCurriculumWeek.reflectionQuestion}</p>
      {#if stoaConversationStore.curriculumProgress}
        <button
          type="button"
          class="secondary"
          onclick={() => {
            const progress = stoaConversationStore.curriculumProgress;
            if (!progress) return;
            void stoaConversationStore.updateCurriculum({
              currentWeek: Math.min(progress.currentWeek + 1, 6),
              completedWeeks: Array.from(new Set([...progress.completedWeeks, progress.currentWeek]))
            });
          }}
        >
          Week complete
        </button>
      {/if}
    </section>
  {/if}

  {#if stoaConversationStore.pendingActions.length > 0}
    <section class="carry-forward-banner">
      <p>
        You have {stoaConversationStore.pendingActions.length} unfinished action{stoaConversationStore.pendingActions.length > 1 ? 's' : ''}
        from earlier sessions.
      </p>
      <div class="actions">
        {#each stoaConversationStore.pendingActions.slice(0, 2) as item}
          <button type="button" class="secondary" onclick={() => stoaConversationStore.updateActionStatus(item.id, 'carried_forward')}>
            Carry forward: {item.text.slice(0, 34)}...
          </button>
        {/each}
      </div>
    </section>
  {/if}

  <section class="stoa-meta" aria-live="polite">
    <span>Stance: {stoaConversationStore.currentStance}</span>
    {#if hasAgentResponse}
      <span>Sources: {stoaConversationStore.sourceClaims.length > 0 ? 'linked' : 'none'}</span>
      <span
        class="confidence-pill {stoaConversationStore.groundingConfidence}"
        role="button"
        tabindex="0"
        onclick={() => (showGroundingExplainer = !showGroundingExplainer)}
        >Grounding confidence: {CONFIDENCE_LABEL[stoaConversationStore.groundingConfidence]}</span
      >
    {/if}
  </section>

  {#if showGroundingExplainer && stoaConversationStore.groundingExplainer}
    <section class="grounding-explainer">
      <h3>Grounding confidence explainer</h3>
      <p>{stoaConversationStore.groundingExplainer.explanation}</p>
      {#if stoaConversationStore.groundingExplainer.reasons.length > 0}
        <p>Triggered by: {stoaConversationStore.groundingExplainer.reasons.join(', ')}</p>
      {/if}
    </section>
  {/if}

  {#if hasAgentResponse && stoaConversationStore.groundingMode !== 'graph_dense'}
    <p class="grounding-note {stoaConversationStore.groundingMode === 'degraded_none' ? 'warn' : 'info'}">
      {stoaConversationStore.groundingMode === 'lexical_fallback'
        ? 'Using backup source retrieval for this turn.'
        : 'Sources unavailable right now; response may be less grounded.'}
    </p>
  {/if}

  <section class="stoa-thread">
    {#if stoaConversationStore.messages.length === 0}
      <p class="empty">Start with a real situation, dilemma, or emotional challenge.</p>
    {/if}
    {#each stoaConversationStore.messages as message (message.id)}
      <article class="message {message.role}">
        <header>{message.role === 'user' ? 'You' : 'Stoa'}</header>
        <p>{message.content}</p>
        {#if message.role === 'agent' && stoaConversationStore.sourceClaims.length > 0}
          <div class="inline-citations">
            {#each stoaConversationStore.sourceClaims.slice(0, 2) as source (source.claimId)}
              <button type="button" class="citation-chip" onclick={() => (expandedSource = source.claimId)}>
                {source.citationLabel || source.sourceWork}
              </button>
            {/each}
          </div>
        {/if}
      </article>
    {/each}
  </section>

  {#if stoaConversationStore.actionLoop}
    <section class="action-loop" aria-label="Action loop check-ins">
      <h2>Action Loop</h2>
      <article class="loop-card">
        <h3>Today</h3>
        <label class="loop-check"><input type="checkbox" bind:checked={doneToday} /> Done</label>
        <p>{stoaConversationStore.actionLoop.today}</p>
      </article>
      <article class="loop-card">
        <h3>Tonight</h3>
        <label class="loop-check"><input type="checkbox" bind:checked={doneTonight} /> Done</label>
        <p>{stoaConversationStore.actionLoop.tonight}</p>
      </article>
      <article class="loop-card">
        <h3>This week</h3>
        <label class="loop-check"><input type="checkbox" bind:checked={doneWeek} /> Done</label>
        <p>{stoaConversationStore.actionLoop.thisWeek}</p>
      </article>
      <p class="follow-up">Follow-up: {stoaConversationStore.actionLoop.followUpPrompt}</p>
    </section>
  {/if}

  {#if stoaConversationStore.actionSuggestions.length > 0}
    <section class="suggestions-card">
      <h2>Suggested actions</h2>
      {#each stoaConversationStore.actionSuggestions as suggestion (suggestion.id)}
        <label class="suggestion-row">
          <input
            type="checkbox"
            checked={selectedSuggestions.includes(suggestion.id)}
            onchange={(event) => {
              const checked = (event.currentTarget as HTMLInputElement).checked;
              selectedSuggestions = checked
                ? [...selectedSuggestions, suggestion.id]
                : selectedSuggestions.filter((id) => id !== suggestion.id);
            }}
          />
          <span>{suggestion.text}</span>
          <small>{suggestion.timeframe} - {Math.round(suggestion.confidenceScore * 100)}%</small>
        </label>
      {/each}
      <div class="actions">
        <button type="button" class="primary" onclick={confirmSuggestions} disabled={selectedSuggestions.length === 0}>
          Add selected to Action Loop
        </button>
      </div>
    </section>
  {/if}

  <form class="composer" onsubmit={async (event) => { event.preventDefault(); await submit(); }}>
    <label for="stoa-message">Message</label>
    <textarea
      id="stoa-message"
      bind:value={draft}
      rows="4"
      placeholder="Describe what happened and what you are trying to navigate."
      disabled={stoaConversationStore.isLoading}
    ></textarea>
    <div class="actions">
      <button type="button" class="secondary" onclick={() => stoaConversationStore.reset()}>
        Reset
      </button>
      <button type="submit" class="primary" disabled={stoaConversationStore.isLoading || !draft.trim()}>
        {stoaConversationStore.isLoading ? 'Responding...' : 'Send'}
      </button>
    </div>
    {#if stoaConversationStore.error}
      <p class="error">{stoaConversationStore.error}</p>
    {/if}
  </form>

  {#if hasAgentResponse}
    <section class="journal-card">
      <h2>Session reflection (1-3 sentences)</h2>
      <textarea bind:value={reflectionDraft} rows="3" placeholder="What did you notice in this session?" />
      <div class="actions">
        <button type="button" class="secondary" onclick={() => (reflectionDraft = '')}>Skip</button>
        <button type="button" class="primary" onclick={saveReflection} disabled={reflectionDraft.trim().length < 20}>
          Save reflection
        </button>
      </div>
    </section>
  {/if}

  {#if stoaConversationStore.relevantJournal.length > 0}
    <section class="journal-history-card">
      <h2>Relevant past reflections</h2>
      {#each stoaConversationStore.relevantJournal as entry (entry.id)}
        <p>{entry.entryText}</p>
      {/each}
    </section>
  {/if}

  <section class="details-card">
    <button
      type="button"
      class="secondary details-toggle"
      aria-expanded={showDetails}
      onclick={() => (showDetails = !showDetails)}
    >
      {showDetails ? 'Hide details' : 'Show details'}
    </button>

    {#if showDetails}
      <div class="details-grid">
        <article class="detail-panel">
          <h3>Personal Memory</h3>
          <div class="memory-input">
            <input bind:value={goalDraft} placeholder="Add goal" />
            <button type="button" class="secondary" onclick={() => addProfile('goals')}>Add</button>
          </div>
          <p>{stoaConversationStore.profile?.goals.join(' | ') || '(none yet)'}</p>
          <div class="memory-input">
            <input bind:value={triggerDraft} placeholder="Add trigger" />
            <button type="button" class="secondary" onclick={() => addProfile('triggers')}>Add</button>
          </div>
          <p>{stoaConversationStore.profile?.triggers.join(' | ') || '(none yet)'}</p>
          <div class="memory-input">
            <input bind:value={practiceDraft} placeholder="Add practice" />
            <button type="button" class="secondary" onclick={() => addProfile('practices')}>Add</button>
          </div>
          <p>{stoaConversationStore.profile?.practices.join(' | ') || '(none yet)'}</p>
        </article>

        {#if stoaConversationStore.sourceClaims.length > 0}
          <article class="detail-panel" aria-label="Grounding sources">
            <h3>Sources</h3>
            {#each stoaConversationStore.sourceClaims as source (source.claimId)}
              <button type="button" class="source-line source-toggle" onclick={() => (expandedSource = expandedSource === source.claimId ? null : source.claimId)}>
                {source.citationLabel || source.sourceWork}
                <span>{source.sourceAuthor} - {source.sourceWork}</span>
              </button>
              {#if expandedSource === source.claimId}
                <p class="source-expanded">{source.passageExcerpt || source.sourceText}</p>
                {#if source.publicDomainUrl}
                  <a href={source.publicDomainUrl} target="_blank" rel="noreferrer">Open full text</a>
                {/if}
              {/if}
            {/each}
          </article>
        {/if}

        {#if stoaConversationStore.citationQuality.length > 0}
          <article class="detail-panel">
            <h3>Citation Quality</h3>
            {#each stoaConversationStore.citationQuality as quality (quality.claimId)}
              <p class="citation-line">
                {quality.claimId} - overlap {quality.quoteOverlap.toFixed(2)}, provenance {quality.provenanceConfidence.toFixed(2)}, confidence {quality.confidence}
              </p>
            {/each}
          </article>
        {/if}
      </div>
    {/if}
  </section>

  {#if ritualMode !== 'none'}
    <section class="onboarding-modal ritual-modal" role="dialog" aria-modal="true" aria-label="Ritual mode">
      <h2>{ritualMode === 'morning' ? 'Morning Ritual' : 'Evening Review'}</h2>
      {#if ritualMode === 'morning'}
        <label for="ritual-q1">What might test me today?</label>
        <input id="ritual-q1" bind:value={ritualQ1} />
        <label for="ritual-q2">What virtue will I need most?</label>
        <input id="ritual-q2" bind:value={ritualQ2} />
      {:else}
        <label for="ritual-q1">What went well?</label>
        <input id="ritual-q1" bind:value={ritualQ1} />
        <label for="ritual-q2">What would I do differently?</label>
        <input id="ritual-q2" bind:value={ritualQ2} />
        <label for="ritual-q3">Was I in control of what mattered?</label>
        <input id="ritual-q3" bind:value={ritualQ3} />
      {/if}
      <div class="actions">
        <button type="button" class="secondary" onclick={() => (ritualMode = 'none')}>Cancel</button>
        <button type="button" class="primary" onclick={runRitual}>Complete ritual</button>
      </div>
    </section>
  {/if}
</main>

<style>
  .stoa-page {
    max-width: 840px;
    margin: 0 auto;
    padding: var(--space-5) var(--space-4);
    display: grid;
    gap: var(--space-4);
  }

  .onboarding-modal {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: color-mix(in srgb, #000 72%, transparent);
    padding: var(--space-6);
    display: grid;
    gap: var(--space-3);
    align-content: center;
    max-width: 720px;
    margin: 0 auto;
  }

  .onboarding-modal h2,
  .onboarding-modal p {
    margin: 0;
  }

  .onboarding-modal input,
  .onboarding-modal select {
    width: 100%;
    min-height: 44px;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-text);
    padding: var(--space-2) var(--space-3);
  }

  .ritual-quick-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .journal-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    color: var(--color-text);
    text-decoration: none;
  }

  .curriculum-card,
  .carry-forward-banner,
  .grounding-explainer,
  .suggestions-card,
  .journal-card,
  .journal-history-card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    padding: var(--space-4);
    display: grid;
    gap: var(--space-2);
  }

  .curriculum-title {
    margin: 0;
    color: var(--color-muted);
    font-size: var(--text-ui);
  }

  .suggestion-row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
    padding: var(--space-2) var(--space-3);
  }

  .journal-card textarea {
    width: 100%;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-text);
    padding: var(--space-2) var(--space-3);
  }

  .source-toggle {
    width: 100%;
    text-align: left;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    padding: var(--space-2) var(--space-3);
    color: var(--color-text);
  }

  .source-expanded {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-left: 2px solid var(--color-sage-border);
    color: var(--color-dim);
    line-height: var(--leading-ui);
  }

  .stoa-header h1 {
    margin: 0 0 var(--space-2) 0;
    font-size: var(--text-d2);
  }

  .stoa-header p {
    margin: 0;
    color: var(--color-muted);
  }

  .stoa-meta {
    display: flex;
    gap: var(--space-3);
    font-size: var(--text-meta);
    color: var(--color-dim);
    flex-wrap: wrap;
  }

  .confidence-pill {
    border-radius: var(--radius-full);
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--color-border);
  }

  .confidence-pill.high {
    color: var(--color-sage-border);
    border-color: var(--color-sage-border);
  }

  .confidence-pill.medium {
    color: var(--color-copper);
    border-color: var(--color-copper);
  }

  .confidence-pill.low {
    color: var(--color-coral);
    border-color: var(--color-coral);
  }

  .grounding-note {
    margin: 0;
    font-size: var(--text-meta);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
  }

  .grounding-note.info {
    color: var(--color-dim);
    background: var(--color-surface);
  }

  .grounding-note.warn {
    color: var(--color-copper);
    background: color-mix(in srgb, var(--color-copper) 8%, var(--color-bg));
  }

  .stoa-thread {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    background: var(--color-surface);
    min-height: 280px;
    display: grid;
    gap: var(--space-3);
  }

  .message {
    padding: var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: var(--color-surface-raised);
  }

  .message.user {
    border-color: var(--color-blue-border);
    background: var(--color-blue-bg);
  }

  .message.agent {
    border-color: var(--color-sage-border);
    background: var(--color-sage-bg);
  }

  .message header {
    margin-bottom: var(--space-2);
    font-size: var(--text-label);
    color: var(--color-dim);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .message p {
    margin: 0;
    white-space: pre-wrap;
    line-height: var(--leading-ui);
  }

  .inline-citations {
    margin-top: var(--space-2);
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .citation-chip {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--color-muted);
    padding: var(--space-1) var(--space-3);
    min-height: 32px;
    cursor: pointer;
  }

  .empty {
    margin: 0;
    color: var(--color-dim);
  }

  .composer {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }

  .action-loop {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    padding: var(--space-4);
    display: grid;
    gap: var(--space-3);
  }

  .action-loop h2 {
    margin: 0;
    font-size: var(--text-ui);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-muted);
  }

  .loop-card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
    padding: var(--space-3);
    display: grid;
    gap: var(--space-2);
  }

  .loop-card h3,
  .loop-card p {
    margin: 0;
  }

  .loop-check {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    font-size: var(--text-meta);
    color: var(--color-dim);
  }

  .follow-up {
    margin: 0;
    color: var(--color-dim);
    font-size: var(--text-meta);
  }

  .details-card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    padding: var(--space-4);
    display: grid;
    gap: var(--space-3);
  }

  .details-toggle {
    width: fit-content;
  }

  .details-grid {
    display: grid;
    gap: var(--space-2);
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  }

  .detail-panel {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-raised);
    padding: var(--space-3);
    display: grid;
    gap: var(--space-2);
  }

  .detail-panel h3,
  .detail-panel p {
    margin: 0;
  }

  .memory-input {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .memory-input input {
    flex: 1;
    min-height: 36px;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-text);
    padding: var(--space-2) var(--space-3);
  }

  .source-line,
  .citation-line {
    line-height: var(--leading-ui);
    font-size: var(--text-meta);
  }

  .source-line span {
    display: block;
    margin-top: var(--space-1);
    font-size: var(--text-meta);
    color: var(--color-dim);
  }

  .composer label {
    font-size: var(--text-meta);
    color: var(--color-dim);
  }

  .composer textarea {
    width: 100%;
    background: var(--color-bg);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 12px 16px;
    resize: vertical;
    min-height: 96px;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
  }

  .actions button {
    min-height: 44px;
    padding: 8px 16px;
    border-radius: var(--radius-md);
    border: 1px solid transparent;
    font-size: var(--text-ui);
    cursor: pointer;
    transition: background var(--transition-fast), border-color var(--transition-fast);
  }

  .actions button:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
  }

  .actions button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .actions .primary {
    background: var(--color-sage);
    color: #10140f;
    border-color: var(--color-sage-border);
  }

  .actions .primary:hover:enabled {
    background: #92b896;
  }

  .actions .secondary {
    background: transparent;
    color: var(--color-text);
    border-color: var(--color-border);
  }

  button.secondary {
    min-height: 44px;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
  }

  .actions .secondary:hover:enabled {
    background: var(--color-surface-raised);
  }

  .error {
    margin: 0;
    color: var(--color-coral);
    font-size: var(--text-meta);
  }
</style>

