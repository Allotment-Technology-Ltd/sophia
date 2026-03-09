<script lang="ts">
  import { conversation } from '$lib/stores/conversation.svelte';
  import { referencesStore } from '$lib/stores/references.svelte';
  import { historyStore } from '$lib/stores/history.svelte';
  import { panelStore } from '$lib/stores/panel.svelte';
  import { renderMarkdown } from '$lib/utils/markdown';
  import { goto, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { getIdToken } from '$lib/firebase';
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
  import LensSelector from '$lib/components/LensSelector.svelte';
  import ModelSelector from '$lib/components/ModelSelector.svelte';
  import DepthSelector from '$lib/components/DepthSelector.svelte';
  import ReasoningQualityBadge from '$lib/components/ReasoningQualityBadge.svelte';
  import ConstitutionImpactPanel from '$lib/components/ConstitutionImpactPanel.svelte';
  import PassFeedback from '$lib/components/PassFeedback.svelte';
  import PassNavigator from '$lib/components/PassNavigator.svelte';
  import EpistemicStatus from '$lib/components/EpistemicStatus.svelte';
  import Loading from '$lib/components/Loading.svelte';
  import ModelComparePanel from '$lib/components/ModelComparePanel.svelte';
  import FollowUpInput from '$lib/components/FollowUpInput.svelte';
  import FollowUpHints from '$lib/components/FollowUpHints.svelte';
  import QuestionCounter from '$lib/components/QuestionCounter.svelte';
  import { extractFurtherQuestions } from '$lib/utils/extractQuestions';
  import DialecticalTriangle from '$lib/components/DialecticalTriangle.svelte';
  import { getRandomExamples, type LensId } from '$lib/constants/examples';

  // ── State ─────────────────────────────────────────────────────────────────
  let queryInput = $state('');
  let selectedLens = $state<string>('');
  type ModelProvider = 'auto' | 'vertex' | 'anthropic';
  type ModelOption = {
    value: string;
    label: string;
    description: string;
    provider: 'vertex' | 'anthropic';
    id: string;
  };

  let modelOptions = $state<ModelOption[]>([]);
  let selectedModelValue = $state<string>('auto');
  const FALLBACK_MODEL_OPTIONS: ModelOption[] = [
    {
      value: 'vertex::gemini-2.0-flash',
      label: 'Gemini · gemini-2.0-flash',
      description: 'Vertex reasoning model',
      provider: 'vertex',
      id: 'gemini-2.0-flash'
    }
  ];
  let selectedDepth = $state<'quick' | 'standard' | 'deep'>('standard');
  let selectedDomain = $state<'auto' | 'ethics' | 'philosophy_of_mind'>('auto');
  const domainSelectorEnabled =
    (import.meta.env.PUBLIC_ENABLE_DOMAIN_OVERRIDE_UI ?? 'true').toLowerCase() === 'true';
  let activeTab = $state<TabId>('references');
  let activeResultPass = $state<'analysis' | 'critique' | 'synthesis' | 'verification'>('analysis');
  let revealed = $state(false);

  type PassKey = 'analysis' | 'critique' | 'synthesis' | 'verification';

  const SUGGESTION_SLOT_COUNT = 1;
  const ROTATE_INTERVAL_MS = 8000;
  const FINAL_DRAW_SETTLE_MS = 850;
  let suggestionTick = $state(0);
  let baseExamplePool = $state<string[]>([]);
  let completionAnimationSettled = $state(false);

  const LOADING_STATUS: Record<string, string> = {
    analysis: 'Mapping the philosophical landscape…',
    critique: 'Finding the weakest premises…',
    synthesis: 'Integrating tensions…',
    verification: 'Running web verification…',
  };

  const PASS_LABELS: Record<string, string> = {
    analysis: 'Analysis',
    critique: 'Critique',
    synthesis: 'Synthesis',
    verification: 'Verification'
  };

  const DEPTH_LABELS: Record<'quick' | 'standard' | 'deep', { auto: string; vertex: string; anthropic: string }> = {
    quick: {
      auto: 'Quick (~10s)',
      vertex: 'Quick (~10s)',
      anthropic: 'Quick (~20s)'
    },
    standard: {
      auto: 'Standard (~25s)',
      vertex: 'Standard (~25s)',
      anthropic: 'Standard (~45-70s)'
    },
    deep: {
      auto: 'Deep (~40s)',
      vertex: 'Deep (~40s)',
      anthropic: 'Deep (~80-140s)'
    }
  };

  const DOMAIN_ALLOWED_LENSES: Record<'auto' | 'ethics' | 'philosophy_of_mind', string[]> = {
    auto: [''],
    ethics: ['', 'utilitarian', 'deontological', 'virtue_ethics', 'rawlsian', 'care_ethics'],
    philosophy_of_mind: ['', 'physicalist', 'dualist', 'functionalist', 'enactivist', 'phenomenological']
  };

  function parseSelectedModel(selection: string): { provider: ModelProvider; modelId?: string } {
    if (!selection || selection === 'auto') return { provider: 'auto' };
    const splitIdx = selection.indexOf('::');
    if (splitIdx <= 0) return { provider: 'auto' };
    const provider = selection.slice(0, splitIdx) as 'vertex' | 'anthropic';
    const modelId = selection.slice(splitIdx + 2);
    if (!modelId) return { provider: 'auto' };
    return { provider, modelId };
  }

  const selectedModel = $derived(parseSelectedModel(selectedModelValue));

  onMount(async () => {
    try {
      const token = await getIdToken();
      const response = await fetch('/api/models', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const payload = await response.json();
      const fetched = Array.isArray(payload.models) ? payload.models : [];
      modelOptions = fetched
        .filter((item: any) => item?.id && (item?.provider === 'vertex' || item?.provider === 'anthropic'))
        .map((item: any) => ({
          value: `${item.provider}::${item.id}`,
          label: item.label ?? `${item.provider === 'anthropic' ? 'Claude' : 'Gemini'} · ${item.id}`,
          description: item.description ?? 'Reasoning model',
          provider: item.provider,
          id: item.id
        }));
    } catch {
      modelOptions = [...FALLBACK_MODEL_OPTIONS];
    }
  });

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
  const requiredPassesByDepth: Record<'quick' | 'standard' | 'deep', Array<'analysis' | 'critique' | 'synthesis'>> = {
    quick: ['analysis'],
    standard: ['analysis', 'critique', 'synthesis'],
    deep: ['analysis', 'critique', 'synthesis']
  };
  let isResultsState = $derived(
    !!lastAssistantMsg &&
    (!conversation.isLoading || conversation.currentPass === 'verification')
  );

  let completedPasses = $derived.by(() => {
    return conversation.completedPasses.filter((pass) =>
      pass === 'analysis' || pass === 'critique' || pass === 'synthesis'
    );
  });
  let completionReadyForDepth = $derived.by(() => {
    const required = requiredPassesByDepth[selectedDepth];
    return required.every((pass) => completedPasses.includes(pass));
  });
  // Loading screen covers all three analysis passes; verification runs in the
  // background while results remain visible (currentPass === 'verification').
  let isLoadingState = $derived(
    (
      conversation.isLoading &&
      conversation.currentPass !== 'verification'
    ) || (
      !revealed &&
      completionReadyForDepth &&
      !completionAnimationSettled
    )
  );

  let availablePasses = $derived.by(() => {
    if (!lastAssistantMsg?.passes) return ['analysis'];
    const available: Array<'analysis' | 'critique' | 'synthesis' | 'verification'> = [];
    if (lastAssistantMsg.passes.analysis) available.push('analysis');
    if (lastAssistantMsg.passes.critique) available.push('critique');
    if (lastAssistantMsg.passes.synthesis) available.push('synthesis');
    // Verification tab should always be available once any analysis result exists.
    available.push('verification');
    return available.length > 0 ? available : ['analysis'];
  });

  let loadingStatusText = $derived.by(() => {
    if (!conversation.currentPass) return 'Thinking…';
    const base = LOADING_STATUS[conversation.currentPass] ?? 'Thinking…';
    const provider = conversation.passModels[conversation.currentPass]?.provider ?? conversation.loadingModelProvider;
    if (provider === 'anthropic' && (conversation.currentPass === 'critique' || conversation.currentPass === 'synthesis')) {
      return `${base} Claude deep reasoning can take longer.`;
    }
    return base;
  });

  let loadingPassLabel = $derived(
    conversation.currentPass ? (PASS_LABELS[conversation.currentPass] ?? 'Analysis') : 'Analysis'
  );

  let loadingModelLabel = $derived.by(() => {
    const passModel = conversation.currentPass ? conversation.passModels[conversation.currentPass] : undefined;
    if (passModel) return `${passModel.provider === 'anthropic' ? 'Claude' : 'Gemini'} · ${passModel.modelId}`;
    if (conversation.loadingModelProvider === 'anthropic') return `Claude${conversation.loadingModelId ? ` · ${conversation.loadingModelId}` : ''}`;
    if (conversation.loadingModelProvider === 'vertex') return `Gemini${conversation.loadingModelId ? ` · ${conversation.loadingModelId}` : ''}`;
    return 'Auto';
  });

  let loadingDepthLabel = $derived.by(() => {
    const passModel = conversation.currentPass ? conversation.passModels[conversation.currentPass] : undefined;
    const provider =
      passModel?.provider ??
      (conversation.loadingModelProvider === 'auto' ? 'auto' : conversation.loadingModelProvider);
    return DEPTH_LABELS[selectedDepth][provider];
  });

  let loadingWorkingLines = $derived.by(() => {
    const pass = conversation.currentPass;
    if (!pass) return [] as string[];
    return (conversation.passWorkings[pass] ?? []).slice(-1);
  });

  let epistemicContent = $derived.by(() => {
    if (!conversation.confidenceSummary) return null;
    const { avgConfidence, lowConfidenceCount, totalClaims } = conversation.confidenceSummary;
    return `Average confidence across ${totalClaims} claim${totalClaims !== 1 ? 's' : ''}: ${(avgConfidence * 100).toFixed(0)}%. ${lowConfidenceCount} claim${lowConfidenceCount !== 1 ? 's' : ''} flagged for review.`;
  });

  let resultsCompletedPasses = $derived.by(() => {
    if (!lastAssistantMsg?.passes) return [];
    return (['analysis', 'critique', 'synthesis', 'verification'] as const).filter(
      (k) => !!lastAssistantMsg!.passes![k]
    );
  });

  const resultDepthMode = $derived(
    lastAssistantMsg?.metadata?.depth_mode ?? null
  );

  const currentDepthMode = $derived(
    resultDepthMode ?? selectedDepth
  );

  const nextDepthUpgrade = $derived.by(() => {
    // Upgrades are only valid when the current result explicitly reports depth.
    if (resultDepthMode === 'quick') return 'standard' as const;
    if (resultDepthMode === 'standard') return 'deep' as const;
    return null;
  });

  const currentQueryModelProvider = $derived(
    lastAssistantMsg?.metadata?.selected_model_provider ?? selectedModel.provider
  );
  const currentQueryModelId = $derived(
    lastAssistantMsg?.metadata?.selected_model_id ?? selectedModel.modelId
  );

  const alternateModelOptions = $derived.by(() => {
    const all = modelOptions;
    if (all.length === 0) return [] as ModelOption[];
    return all.filter(
      (option) =>
        option.provider !== currentQueryModelProvider ||
        option.id !== currentQueryModelId
    );
  });

  const compareOption = $derived.by(() => {
    const crossProvider = alternateModelOptions.find((option) => option.provider !== currentQueryModelProvider);
    if (crossProvider) return crossProvider;
    if (alternateModelOptions.length === 0) return null;
    return alternateModelOptions[0];
  });

  const currentQuery = $derived(
    conversation.messages.findLast((m) => m.role === 'user')?.content ?? ''
  );

  const geminiCachedResult = $derived.by(() =>
    !currentQuery
      ? null
      : historyStore.getCachedResult(currentQuery, {
          lens: selectedLens || undefined,
          depthMode: currentDepthMode,
          modelProvider: 'vertex',
          modelId: modelOptions.find((option) => option.provider === 'vertex')?.id,
          domainMode: selectedDomain === 'auto' ? 'auto' : 'manual',
          domain: selectedDomain === 'auto' ? undefined : selectedDomain
        })
  );

  const claudeCachedResult = $derived.by(() =>
    !currentQuery
      ? null
      : historyStore.getCachedResult(currentQuery, {
          lens: selectedLens || undefined,
          depthMode: currentDepthMode,
          modelProvider: 'anthropic',
          modelId: modelOptions.find((option) => option.provider === 'anthropic')?.id,
          domainMode: selectedDomain === 'auto' ? 'auto' : 'manual',
          domain: selectedDomain === 'auto' ? undefined : selectedDomain
        })
  );

  const hasCachedGemini = $derived(!!geminiCachedResult);
  const hasCachedClaude = $derived(!!claudeCachedResult);

  function getCachedForModel(option: ModelOption | null): ReturnType<typeof historyStore.getCachedResult> {
    if (!option || !currentQuery) return null;
    return historyStore.getCachedResult(currentQuery, {
      lens: selectedLens || undefined,
      depthMode: currentDepthMode,
      modelProvider: option.provider,
      modelId: option.id,
      domainMode: selectedDomain === 'auto' ? 'auto' : 'manual',
      domain: selectedDomain === 'auto' ? undefined : selectedDomain
    });
  }

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

  function calculateDisplayedCost(metadata: {
    total_input_tokens: number;
    total_output_tokens: number;
    model_cost_breakdown?: { total_estimated_cost_usd: number };
  }): number {
    return metadata.model_cost_breakdown?.total_estimated_cost_usd ??
      calculateCost(metadata.total_input_tokens, metadata.total_output_tokens);
  }

  function formatModelLabel(provider: 'vertex' | 'anthropic', model: string): string {
    const shortModel = model.length > 28 ? `${model.slice(0, 28)}…` : model;
    return `${provider}:${shortModel}`;
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
    await conversation.submitQuery(query, selectedLens || undefined, {
      depthMode: selectedDepth,
      modelProvider: selectedModel.provider,
      modelId: selectedModel.modelId,
      domainMode: selectedDomain === 'auto' ? 'auto' : 'manual',
      domain: selectedDomain === 'auto' ? undefined : selectedDomain
    });
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
    await conversation.submitQuery(lastQuery, selectedLens || undefined, {
      depthMode: selectedDepth,
      modelProvider: selectedModel.provider,
      modelId: selectedModel.modelId,
      domainMode: selectedDomain === 'auto' ? 'auto' : 'manual',
      domain: selectedDomain === 'auto' ? undefined : selectedDomain
    });
  }

  async function rerunWithModel(modelOption: ModelOption): Promise<void> {
    if (conversation.isLoading) return;
    const lastQuery = conversation.messages.findLast((m) => m.role === 'user')?.content;
    if (!lastQuery) return;
    selectedModelValue = modelOption.value;
    activeResultPass = 'analysis';
    revealed = false;
    await conversation.submitQuery(lastQuery, selectedLens || undefined, {
      depthMode: currentDepthMode,
      modelProvider: modelOption.provider,
      modelId: modelOption.id,
      domainMode: selectedDomain === 'auto' ? 'auto' : 'manual',
      domain: selectedDomain === 'auto' ? undefined : selectedDomain,
      bypassQuestionLimit: true
    });
  }

  async function switchToModelResult(modelOption: ModelOption): Promise<void> {
    if (conversation.isLoading) return;
    const lastQuery = conversation.messages.findLast((m) => m.role === 'user')?.content;
    if (!lastQuery) return;
    selectedModelValue = modelOption.value;
    activeResultPass = 'analysis';
    const switched = conversation.showCachedVariant(lastQuery, {
      lens: selectedLens || undefined,
      depthMode: currentDepthMode,
      modelProvider: modelOption.provider,
      modelId: modelOption.id,
      domainMode: selectedDomain === 'auto' ? 'auto' : 'manual',
      domain: selectedDomain === 'auto' ? undefined : selectedDomain
    });
    if (switched) {
      revealed = true;
      return;
    }
    revealed = false;
    await rerunWithModel(modelOption);
  }

  async function upgradeDepth(): Promise<void> {
    if (!nextDepthUpgrade || conversation.isLoading) return;
    const lastQuery = conversation.messages.findLast((m) => m.role === 'user')?.content;
    if (!lastQuery) return;
    const previousPasses = lastAssistantMsg?.passes;
    const reuse =
      currentDepthMode === 'quick' && nextDepthUpgrade === 'standard'
        ? {
            fromDepth: 'quick' as const,
            analysis: previousPasses?.analysis
          }
        : currentDepthMode === 'standard' && nextDepthUpgrade === 'deep'
          ? {
              fromDepth: 'standard' as const,
              analysis: previousPasses?.analysis,
              critique: previousPasses?.critique,
              synthesis: previousPasses?.synthesis
            }
          : undefined;
    selectedDepth = nextDepthUpgrade;
    activeResultPass = 'analysis';
    revealed = false;
    await conversation.submitQuery(lastQuery, selectedLens || undefined, {
      depthMode: nextDepthUpgrade,
      modelProvider: selectedModel.provider,
      modelId: selectedModel.modelId,
      domainMode: selectedDomain === 'auto' ? 'auto' : 'manual',
      domain: selectedDomain === 'auto' ? undefined : selectedDomain,
      bypassQuestionLimit: true,
      reuse
    });
  }

  // ── Effects ───────────────────────────────────────────────────────────────
  $effect(() => {
    if (selectedDomain === 'auto' && selectedLens !== '') {
      selectedLens = '';
      return;
    }
    const allowed = DOMAIN_ALLOWED_LENSES[selectedDomain];
    if (allowed && !allowed.includes(selectedLens)) {
      selectedLens = '';
    }
  });

  $effect(() => {
    if (!completionReadyForDepth) {
      completionAnimationSettled = false;
      return;
    }

    if (completionAnimationSettled) {
      return;
    }

    const timer = setTimeout(() => {
      completionAnimationSettled = true;
    }, FINAL_DRAW_SETTLE_MS);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    if (
      conversation.currentPass &&
      ['analysis', 'critique', 'synthesis', 'verification'].includes(conversation.currentPass)
    ) {
      activeResultPass = conversation.currentPass as
        | 'analysis'
        | 'critique'
        | 'synthesis'
        | 'verification';
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

  function normalizeText(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function tokenize(text: string): string[] {
    const stopWords = new Set([
      'the', 'and', 'for', 'with', 'that', 'this', 'from', 'what', 'when', 'where', 'which',
      'should', 'would', 'could', 'about', 'into', 'over', 'than', 'have', 'been', 'your',
      'their', 'there', 'does', 'is', 'are', 'how', 'why'
    ]);
    return normalizeText(text)
      .split(' ')
      .filter((token) => token.length >= 4 && !stopWords.has(token));
  }

  function collectContextTerms(): Set<string> {
    const terms = new Set<string>();
    const seed = queryInput.trim().length > 0
      ? [queryInput]
      : historyStore.items.slice(0, 4).map((item) => item.question);
    for (const text of seed) {
      for (const token of tokenize(text)) terms.add(token);
    }
    return terms;
  }

  const DOMAIN_KEYWORDS: Record<'ethics' | 'philosophy_of_mind', string[]> = {
    ethics: [
      'moral', 'ethic', 'duty', 'rights', 'justice', 'obligation', 'harm', 'welfare',
      'virtue', 'fairness', 'care', 'deontological', 'utilitarian', 'rawls'
    ],
    philosophy_of_mind: [
      'mind', 'consciousness', 'qualia', 'experience', 'brain', 'physicalism',
      'dualism', 'self', 'identity', 'intentionality', 'free will', 'functionalism'
    ]
  };

  const LENS_KEYWORDS: Record<string, string[]> = {
    utilitarian: ['consequence', 'utility', 'welfare', 'aggregate', 'outcome', 'maximize'],
    deontological: ['duty', 'rule', 'right', 'obligation', 'principle', 'constraint'],
    virtue_ethics: ['virtue', 'character', 'flourishing', 'habit', 'wisdom'],
    rawlsian: ['fairness', 'justice', 'equality', 'basic liberty', 'veil', 'difference principle'],
    care_ethics: ['care', 'relationship', 'dependency', 'vulnerability', 'empathy', 'context'],
    physicalist: ['physicalism', 'brain', 'neural', 'material', 'reduction', 'naturalism'],
    dualist: ['dualism', 'soul', 'mental substance', 'zombie', 'qualia', 'non-physical'],
    functionalist: ['function', 'causal role', 'multiple realizability', 'computation', 'state machine'],
    enactivist: ['embodied', 'enactive', 'sensorimotor', 'situated cognition', 'environment'],
    phenomenological: ['lived experience', 'first-person', 'intentionality', 'phenomenology', 'subjective']
  };

  function scoreKeywordMatch(text: string, keywords: string[]): number {
    const normalized = normalizeText(text);
    if (!normalized || keywords.length === 0) return 0;
    let score = 0;
    for (const keyword of keywords) {
      if (normalized.includes(keyword)) score += 1;
    }
    return score;
  }

  function inferAutoDomain(): 'ethics' | 'philosophy_of_mind' {
    const seed = [
      queryInput,
      ...historyStore.items.slice(0, 3).map((item) => item.question)
    ].filter(Boolean);
    const joined = seed.join(' ');
    const ethicsScore = scoreKeywordMatch(joined, DOMAIN_KEYWORDS.ethics);
    const mindScore = scoreKeywordMatch(joined, DOMAIN_KEYWORDS.philosophy_of_mind);
    return mindScore > ethicsScore ? 'philosophy_of_mind' : 'ethics';
  }

  const suggestionDomain = $derived(
    selectedDomain === 'auto' ? inferAutoDomain() : selectedDomain
  );

  function scoreRelevance(question: string, terms: Set<string>): number {
    if (terms.size === 0) return 0;
    const qTokens = tokenize(question);
    if (qTokens.length === 0) return 0;
    let matches = 0;
    for (const token of qTokens) {
      if (terms.has(token)) matches += 1;
    }
    return matches;
  }

  function matchesDomainContext(result: {
    domain?: 'ethics' | 'philosophy_of_mind';
    domain_mode?: 'auto' | 'manual';
    query: string;
  }): boolean {
    if (result.domain_mode === 'manual' && result.domain) {
      return result.domain === suggestionDomain;
    }
    // For legacy/auto cached items, infer from query text as fallback.
    return scoreKeywordMatch(result.query, DOMAIN_KEYWORDS[suggestionDomain]) > 0;
  }

  function matchesLensContext(result: { lens?: string; query: string }): boolean {
    if (!selectedLens) return true;
    if (result.lens) return result.lens === selectedLens;
    // Legacy cache fallback: infer from query text.
    return scoreKeywordMatch(result.query, LENS_KEYWORDS[selectedLens] ?? []) > 0;
  }

  const followOnSuggestions = $derived.by(() => {
    const contextTerms = collectContextTerms();
    const seen = new Set<string>();
    const strict: Array<{ text: string; score: number; recency: number }> = [];
    const fallback: Array<{ text: string; score: number; recency: number }> = [];
    const cached = historyStore.cachedResults;

    for (let i = 0; i < cached.length; i += 1) {
      const result = cached[i];
      const isDomainMatch = matchesDomainContext(result);
      const isLensMatch = matchesLensContext(result);
      const questions = extractFurtherQuestions(result.passes?.synthesis ?? '');
      for (const question of questions) {
        const trimmed = question.trim();
        if (trimmed.length < 12) continue;
        const key = normalizeText(trimmed);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const relevanceScore = scoreRelevance(trimmed, contextTerms);
        const domainScore = scoreKeywordMatch(trimmed, DOMAIN_KEYWORDS[suggestionDomain]);
        const lensScore = selectedLens ? scoreKeywordMatch(trimmed, LENS_KEYWORDS[selectedLens] ?? []) : 0;
        const item = {
          text: trimmed,
          score: relevanceScore + domainScore * 2 + lensScore * 2 + (isDomainMatch ? 2 : 0) + (isLensMatch ? 2 : 0),
          recency: i
        };
        if (isDomainMatch && isLensMatch) strict.push(item);
        else fallback.push(item);
      }
    }

    strict.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.recency - b.recency;
    });
    fallback.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.recency - b.recency;
    });

    const chosen = strict.length >= SUGGESTION_SLOT_COUNT ? strict : [...strict, ...fallback];
    return chosen.map((entry) => entry.text);
  });

  const rotatingQuestions = $derived.by(() => {
    const merged = [...followOnSuggestions, ...baseExamplePool];
    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const question of merged) {
      const key = normalizeText(question);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      deduped.push(question);
    }

    if (deduped.length === 0) return [];
    if (deduped.length <= SUGGESTION_SLOT_COUNT) return deduped;

    const start = suggestionTick % deduped.length;
    const rotating: string[] = [];
    for (let i = 0; i < SUGGESTION_SLOT_COUNT; i += 1) {
      rotating.push(deduped[(start + i) % deduped.length]);
    }
    return rotating;
  });

  $effect(() => {
    baseExamplePool = getRandomExamples(20, {
      domain: suggestionDomain,
      lens: (selectedLens as LensId) || ''
    }).map((item) => item.text);
  });

  $effect(() => {
    if (!isQueryState) return;
    if (typeof window === 'undefined') return;
    const timer = window.setInterval(() => {
      suggestionTick += 1;
    }, ROTATE_INTERVAL_MS);
    return () => window.clearInterval(timer);
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
              <div class="reasoning-frame">
                <div class="frame-title">Reasoning Frame</div>
                {#if domainSelectorEnabled}
                  <div class="domain-row">
                    <label for="domain-select">Domain</label>
                    <select id="domain-select" bind:value={selectedDomain}>
                      <option value="auto">Auto</option>
                      <option value="ethics">Ethics</option>
                      <option value="philosophy_of_mind">Philosophy of Mind</option>
                    </select>
                  </div>
                {/if}
                <LensSelector bind:value={selectedLens} domain={selectedDomain} disabled={conversation.isLoading} />
                <ModelSelector
                  bind:value={selectedModelValue}
                  options={[
                    { value: 'auto', label: 'Auto', description: 'Default depth-aware routing' },
                    ...modelOptions.map((option) => ({
                      value: option.value,
                      label: option.label,
                      description: option.description
                    }))
                  ]}
                  disabled={conversation.isLoading}
                />
              </div>

              <DepthSelector bind:value={selectedDepth} disabled={conversation.isLoading} />

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

              <div class="suggested-questions">
                <div class="suggested-header">
                  <h3>Suggested Questions</h3>
                  <p>Tailored to your selected domain and lens.</p>
                </div>
                <div class="example-pills" aria-label="Suggested questions">
                {#each rotatingQuestions as q}
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
            depthMode={selectedDepth}
            completionReady={completionAnimationSettled}
            passLabel={loadingPassLabel}
            depthLabel={loadingDepthLabel}
            modelLabel={loadingModelLabel}
            workingLines={loadingWorkingLines}
          />
        </div>
      {/if}

      <!-- ═══════════════════════════════════════════════════════════════
           STATE 2b: COMPLETE — click triangle to reveal results
           ═══════════════════════════════════════════════════════════════ -->
      {#if isResultsState && completionAnimationSettled && !revealed}
        <div
          class="complete-screen"
          in:fade={{ duration: 500 }}
          out:fade={{ duration: 300 }}
        >
          <DialecticalTriangle
            mode="complete"
            completedPasses={completedPasses}
            depthMode={currentDepthMode}
            completionReady={true}
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
              {availablePasses}
              showVerification={true}
              onSelect={(p) => {
                activeResultPass = p as 'analysis' | 'critique' | 'synthesis' | 'verification';
              }}
            />
          </aside>

          <div class="results-col">
            <!-- User query echo -->
            {#if conversation.messages.findLast(m => m.role === 'user')}
              <div class="query-echo">
                <p class="query-echo-text">{conversation.messages.findLast(m => m.role === 'user')?.content}</p>
              </div>
            {/if}

            <!-- Pass cards (tabbed: one visible at a time) -->
            {#if activeResultPass === 'analysis' && passes.analysis}
              <div id="pass-analysis">
                <PassCard pass="analysis" content={renderPass(passes.analysis)} />
                <div class="pass-feedback-row">
                  <PassFeedback queryId={lastAssistantMsg.metadata?.query_run_id} passType="analysis" />
                </div>
              </div>
            {/if}

            {#if activeResultPass === 'critique' && passes.critique}
              <div id="pass-critique">
                <PassCard pass="critique" content={renderPass(passes.critique)} />
                <div class="pass-feedback-row">
                  <PassFeedback queryId={lastAssistantMsg.metadata?.query_run_id} passType="critique" />
                </div>
              </div>
            {/if}

            {#if activeResultPass === 'synthesis' && passes.synthesis}
              <div id="pass-synthesis">
                <PassCard pass="synthesis" content={renderPass(passes.synthesis)} />
                <div class="pass-feedback-row">
                  <PassFeedback queryId={lastAssistantMsg.metadata?.query_run_id} passType="synthesis" />
                </div>
              </div>
            {/if}

            <ReasoningQualityBadge reasoningQuality={lastAssistantMsg.reasoningQuality} />
            <ConstitutionImpactPanel deltas={lastAssistantMsg.constitutionDeltas} />

            <!-- Epistemic status -->
            {#if epistemicContent}
              <EpistemicStatus content={epistemicContent} />
            {/if}

            <!-- Web verification section (tabbed) -->
            {#if activeResultPass === 'verification'}
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
                <span>${calculateDisplayedCost(m).toFixed(6)}</span>
              </div>
              {#if m.model_cost_breakdown?.by_model?.length}
                <div class="model-cost-breakdown" aria-label="Model cost breakdown">
                  {#each m.model_cost_breakdown.by_model as item}
                    <span class="model-cost-chip">
                      <strong>{formatModelLabel(item.provider, item.model)}</strong>
                      <span>{item.input_tokens} in</span>
                      <span>{item.output_tokens} out</span>
                      <span>${item.estimated_cost_usd.toFixed(6)}</span>
                    </span>
                  {/each}
                </div>
              {/if}
              {#if nextDepthUpgrade}
                <div class="upgrade-row">
                  <button
                    class="upgrade-btn"
                    onclick={upgradeDepth}
                    disabled={conversation.isLoading}
                  >
                    Upgrade to {nextDepthUpgrade === 'standard' ? 'Standard' : 'Deep'}
                  </button>
                  <span class="upgrade-note">
                    Re-run same query with richer pass depth.
                  </span>
                </div>
              {/if}
              {#if compareOption}
                {@const compareCached = getCachedForModel(compareOption)}
                <div class="upgrade-row">
                  <button
                    class="upgrade-btn"
                    onclick={() => switchToModelResult(compareOption)}
                    disabled={conversation.isLoading}
                  >
                    {compareCached ? `View ${compareOption.label}` : `Run again with ${compareOption.label}`}
                  </button>
                  <span class="upgrade-note">
                    {compareCached
                      ? 'Open cached result instantly.'
                      : 'Compare pass outputs across concrete models.'}
                  </span>
                </div>
              {/if}
            {/if}

            {#if geminiCachedResult && claudeCachedResult}
              <ModelComparePanel
                geminiPasses={{
                  analysis: geminiCachedResult.passes.analysis,
                  critique: geminiCachedResult.passes.critique,
                  synthesis: geminiCachedResult.passes.synthesis,
                  verification: geminiCachedResult.passes.verification
                }}
                claudePasses={{
                  analysis: claudeCachedResult.passes.analysis,
                  critique: claudeCachedResult.passes.critique,
                  synthesis: claudeCachedResult.passes.synthesis,
                  verification: claudeCachedResult.passes.verification
                }}
              />
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
                    questions={hints.slice(0, 1)}
                    onSelect={(q) => {
                      conversation.submitQuery(q, selectedLens || undefined, {
                        depthMode: selectedDepth,
                        modelProvider: selectedModel.provider,
                        modelId: selectedModel.modelId,
                        domainMode: selectedDomain === 'auto' ? 'auto' : 'manual',
                        domain: selectedDomain === 'auto' ? undefined : selectedDomain
                      });
                    }}
                  />
                {/if}
                <FollowUpInput
                  onSubmit={(text) =>
                    conversation.submitQuery(text, selectedLens || undefined, {
                      depthMode: selectedDepth,
                      modelProvider: selectedModel.provider,
                      modelId: selectedModel.modelId,
                      domainMode: selectedDomain === 'auto' ? 'auto' : 'manual',
                      domain: selectedDomain === 'auto' ? undefined : selectedDomain
                    })}
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

  .reasoning-frame {
    width: min(700px, 100%);
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    border-radius: 4px;
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .frame-title {
    font-family: var(--font-ui);
    font-size: 0.66rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-dim);
    text-align: left;
  }

  .domain-row {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: var(--space-2);
    font-family: var(--font-ui);
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    color: var(--color-muted);
    text-transform: uppercase;
  }

  .domain-row select {
    background: var(--color-surface);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    border-radius: 3px;
    padding: 6px 8px;
    font-size: 0.78rem;
    text-transform: none;
    letter-spacing: 0;
    min-width: 180px;
  }

  .query-actions {
    display: flex;
    justify-content: center;
    margin-top: var(--space-2);
  }

  .suggested-questions {
    width: min(700px, 100%);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .suggested-header {
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .suggested-header h3 {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 0.78rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-muted);
  }

  .suggested-header p {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 0.72rem;
    color: var(--color-dim);
  }

  .pass-feedback-row {
    display: flex;
    justify-content: flex-end;
    margin-top: 6px;
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
    font-size: 0.68rem;
    color: var(--color-muted);
    padding-top: var(--space-2);
    border-top: 1px solid var(--color-border);
    flex-wrap: wrap;
  }

  .model-cost-breakdown {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: 6px;
  }

  .model-cost-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    padding: 4px 10px;
    font-family: var(--font-ui);
    font-size: 0.65rem;
    color: var(--color-muted);
    background: var(--color-surface);
  }

  .model-cost-chip strong {
    color: var(--color-text);
    font-weight: 600;
  }

  .upgrade-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: -6px;
  }

  .upgrade-btn {
    font-family: var(--font-ui);
    font-size: 0.7rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    border: 1px solid var(--color-sage-border);
    color: var(--color-sage);
    background: transparent;
    border-radius: 3px;
    padding: 6px 10px;
    cursor: pointer;
  }

  .upgrade-btn:hover {
    background: color-mix(in srgb, var(--color-sage) 12%, transparent);
  }

  .upgrade-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .upgrade-note {
    font-family: var(--font-ui);
    font-size: 0.72rem;
    color: var(--color-dim);
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
