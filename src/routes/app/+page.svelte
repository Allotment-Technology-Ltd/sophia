<script lang="ts">
  import { conversation } from '$lib/stores/conversation.svelte';
  import { referencesStore } from '$lib/stores/references.svelte';
  import { historyStore } from '$lib/stores/history.svelte';
  import { comparisonStore } from '$lib/stores/comparison.svelte';
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
  import PassTracker from '$lib/components/PassTracker.svelte';
  import EpistemicStatus from '$lib/components/EpistemicStatus.svelte';
  import Loading from '$lib/components/Loading.svelte';
  import ModelComparePanel from '$lib/components/ModelComparePanel.svelte';
  import FollowUpInput from '$lib/components/FollowUpInput.svelte';
  import FollowUpHints from '$lib/components/FollowUpHints.svelte';
  import QuestionCounter from '$lib/components/QuestionCounter.svelte';
  import { extractFurtherQuestions } from '$lib/utils/extractQuestions';
  import DialecticalTriangle from '$lib/components/DialecticalTriangle.svelte';
  import { getRandomExamples, type LensId } from '$lib/constants/examples';
  import {
    DEFAULT_MODEL_CATALOG,
    PROVIDER_UI_META,
    REASONING_PROVIDER_ORDER,
    getModelProviderLabel,
    isReasoningProvider,
    parseReasoningProvider,
    type ByokProvider,
    type ModelProvider,
    type ReasoningProvider
  } from '$lib/types/providers';

  // ── State ─────────────────────────────────────────────────────────────────
  let queryInput = $state('');
  let selectedLens = $state<string>('');
  type ModelOption = {
    value: string;
    label: string;
    description: string;
    provider: ReasoningProvider;
    id: string;
  };
  type QueryKeySource = 'platform' | ReasoningProvider;
  interface ByokProviderStatus {
    provider: ByokProvider;
    configured: boolean;
    status: 'not_configured' | 'pending_validation' | 'active' | 'invalid' | 'revoked';
    fingerprint_last8: string | null;
    validated_at: string | null;
    updated_at: string | null;
    last_error: string | null;
  }
  interface IngestionBillingSnapshot {
    publicRemaining: number | null;
    privateRemaining: number | null;
    walletAvailableCents: number | null;
    walletCurrency: 'GBP' | 'USD';
  }
  interface RunCostPassEstimate {
    pass: 'analysis' | 'critique' | 'synthesis' | 'verification';
    modelLabels: string[];
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  }
  interface RunCostEntry {
    id: string;
    runLabel: string;
    query: string;
    queryRunId: string | null;
    depthMode: 'quick' | 'standard' | 'deep' | null;
    selectedModelLabel: string;
    totalInputTokens: number;
    totalOutputTokens: number;
    durationMs: number;
    totalEstimatedCostUsd: number;
    passEstimates: RunCostPassEstimate[];
  }

  let modelOptions = $state<ModelOption[]>([]);
  let byokProviders = $state<ByokProviderStatus[]>([]);
  let keySource = $state<QueryKeySource>('platform');
  let byokStatusError = $state('');
  let selectedModelValue = $state<string>('auto');
  let customModelId = $state('');
  let previousKeySource: QueryKeySource = 'platform';
  const FALLBACK_MODELS = DEFAULT_MODEL_CATALOG;
  const QUERY_KEY_PROVIDER_ORDER = REASONING_PROVIDER_ORDER;
  let selectedDepth = $state<'quick' | 'standard' | 'deep'>('standard');
  let userLinksInput = $state('');
  let ingestSelections = $state<Record<string, boolean>>({});
  let ingestVisibilities = $state<Record<string, 'public_shared' | 'private_user_only'>>({});
  let publicShareAcks = $state<Record<string, boolean>>({});
  let ingestionBilling = $state<IngestionBillingSnapshot>({
    publicRemaining: null,
    privateRemaining: null,
    walletAvailableCents: null,
    walletCurrency: 'GBP'
  });
  let ingestionBillingLoading = $state(false);
  let ingestionBillingError = $state('');
  let selectedDomain = $state<'auto' | 'ethics' | 'philosophy_of_mind'>('auto');
  const domainSelectorEnabled =
    (import.meta.env.PUBLIC_ENABLE_DOMAIN_OVERRIDE_UI ?? 'true').toLowerCase() === 'true';
  let activeTab = $state<TabId>('references');
  let activeResultPass = $state<'analysis' | 'critique' | 'synthesis' | 'verification'>('analysis');
  let autoFocusFirstPass = $state(true);

  const SUGGESTION_SLOT_COUNT = 1;
  const ROTATE_INTERVAL_MS = 8000;
  let suggestionTick = $state(0);
  let baseExamplePool = $state<string[]>([]);

  const LOADING_STATUS: Record<string, string> = {
    analysis: 'SOPHIA is assembling the first pass of your question - let her think for a moment…',
    critique: 'Testing the first position for hidden tensions…',
    synthesis: 'Weaving a balanced resolution from both sides…',
    verification: 'Reviewing sources and scholarly grounding…',
  };

  const PASS_LABELS: Record<string, string> = {
    analysis: 'Foundations',
    critique: 'Challenges',
    synthesis: 'Resolution',
    verification: 'Evidence & Sources'
  };

  const DEPTH_LABELS: Record<'quick' | 'standard' | 'deep', Record<'auto' | ReasoningProvider, string>> = {
    quick: {
      auto: 'Quick (~10s)',
      vertex: 'Quick (~10s)',
      anthropic: 'Quick (~20s)',
      openai: 'Quick (~15-25s)',
      xai: 'Quick (~15-25s)',
      groq: 'Quick (~8-18s)',
      mistral: 'Quick (~15-25s)',
      deepseek: 'Quick (~15-25s)',
      together: 'Quick (~15-25s)',
      openrouter: 'Quick (~20-35s)',
      perplexity: 'Quick (~15-30s)'
    },
    standard: {
      auto: 'Standard (~25s)',
      vertex: 'Standard (~25s)',
      anthropic: 'Standard (~45-70s)',
      openai: 'Standard (~40-65s)',
      xai: 'Standard (~40-70s)',
      groq: 'Standard (~20-35s)',
      mistral: 'Standard (~35-60s)',
      deepseek: 'Standard (~35-65s)',
      together: 'Standard (~35-60s)',
      openrouter: 'Standard (~45-75s)',
      perplexity: 'Standard (~35-60s)'
    },
    deep: {
      auto: 'Deep (~40s)',
      vertex: 'Deep (~40s)',
      anthropic: 'Deep (~80-140s)',
      openai: 'Deep (~70-130s)',
      xai: 'Deep (~70-130s)',
      groq: 'Deep (~45-90s)',
      mistral: 'Deep (~65-120s)',
      deepseek: 'Deep (~70-130s)',
      together: 'Deep (~65-120s)',
      openrouter: 'Deep (~80-150s)',
      perplexity: 'Deep (~65-120s)'
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
    const provider = parseReasoningProvider(selection.slice(0, splitIdx));
    if (!provider) return { provider: 'auto' };
    const modelId = selection.slice(splitIdx + 2);
    if (!modelId) return { provider: 'auto' };
    return { provider, modelId };
  }

  function applyModelSelection(provider?: ModelProvider, modelId?: string): void {
    if (!provider || provider === 'auto') {
      selectedModelValue = 'auto';
      return;
    }
    if (modelId?.trim()) {
      selectedModelValue = `${provider}::${modelId.trim()}`;
      return;
    }
    const fallback = modelOptions.find((option) => option.provider === provider);
    selectedModelValue = fallback ? fallback.value : 'auto';
  }

  const selectedModel = $derived(parseSelectedModel(selectedModelValue));
  const selectableModelOptions = $derived.by(() => {
    if (keySource === 'platform') {
      return modelOptions.filter((option) => option.provider === 'vertex');
    }
    return modelOptions.filter((option) => option.provider === keySource);
  });
  const modelSelectOptions = $derived.by(() => {
    const dynamicOptions = selectableModelOptions.map((option) => ({
      value: option.value,
      label: option.label,
      description: option.description,
      disabled: false
    }));
    if (keySource !== 'platform') {
      return [
        { value: 'auto', label: 'Auto', description: 'Default depth-aware routing', disabled: false },
        ...dynamicOptions
      ];
    }

    const byokOnlyProviderRows = QUERY_KEY_PROVIDER_ORDER
      .filter((provider) => provider !== 'vertex')
      .map((provider) => ({
        provider,
        labelPrefix: getModelProviderLabel(provider),
        byokLabel: PROVIDER_UI_META[provider].label,
        ids: [
          ...modelOptions.filter((option) => option.provider === provider).map((option) => option.id),
          ...(FALLBACK_MODELS[provider] ?? [])
        ]
      }));
    const byokOnly = byokOnlyProviderRows.flatMap((row) =>
      row.ids
        .filter((id, idx, arr) => arr.indexOf(id) === idx)
        .map((id) => ({
          value: `${row.provider}::${id}`,
          label: `${row.labelPrefix} · ${id} (BYOK only)`,
          description: `Requires an active ${row.byokLabel} BYOK key`,
          disabled: true
        }))
    );

    return [
      { value: 'auto', label: 'Auto', description: 'Default depth-aware routing', disabled: false },
      ...dynamicOptions,
      ...byokOnly
    ];
  });

  function buildFallbackModelOptions(source: QueryKeySource): ModelOption[] {
    const fallback: ModelOption[] = [];
    const providersToInclude = source === 'platform' ? (['vertex'] as ReasoningProvider[]) : [source];
    for (const provider of providersToInclude) {
      for (const id of FALLBACK_MODELS[provider] ?? []) {
        const providerLabel = getModelProviderLabel(provider);
        fallback.push({
          value: `${provider}::${id}`,
          label: `${providerLabel} · ${id}`,
          description: source === provider ? `User BYOK ${providerLabel} model` : `${providerLabel} model`,
          provider,
          id
        });
      }
    }
    return fallback;
  }

  function customModelPlaceholder(provider: ReasoningProvider): string {
    return (FALLBACK_MODELS[provider] ?? [])[0] ?? 'model-id';
  }

  async function loadByokProviders(token: string): Promise<void> {
    try {
      const response = await fetch('/api/byok/providers', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const payload = await response.json();
      const incoming = Array.isArray(payload.providers) ? payload.providers as ByokProviderStatus[] : [];
      byokProviders = incoming;
      byokStatusError = '';
    } catch (err) {
      byokProviders = [];
      byokStatusError = err instanceof Error ? err.message : 'Unable to load BYOK providers';
    }
  }

  async function refreshIngestionBilling(token: string): Promise<void> {
    ingestionBillingLoading = true;
    ingestionBillingError = '';
    try {
      const response = await fetch('/api/billing/entitlements', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const payload = await response.json();
      const entitlements = payload?.entitlements ?? {};
      const wallet = payload?.wallet ?? {};
      ingestionBilling = {
        publicRemaining: Number.isFinite(entitlements?.publicRemaining)
          ? Number(entitlements.publicRemaining)
          : null,
        privateRemaining: Number.isFinite(entitlements?.privateRemaining)
          ? Number(entitlements.privateRemaining)
          : null,
        walletAvailableCents: Number.isFinite(wallet?.available_cents)
          ? Number(wallet.available_cents)
          : null,
        walletCurrency: wallet?.currency === 'USD' ? 'USD' : 'GBP'
      };
    } catch (err) {
      ingestionBillingError = err instanceof Error ? err.message : 'Unable to load ingestion limits';
    } finally {
      ingestionBillingLoading = false;
    }
  }

  async function loadModelOptions(
    token: string | null,
    source: QueryKeySource
  ): Promise<void> {
    const params = new URLSearchParams();
    params.set('credential_mode', source === 'platform' ? 'platform' : 'byok');
    if (source !== 'platform') {
      params.set('byok_provider', source);
    }
    const url = `/api/models?${params.toString()}`;
    const response = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const payload = await response.json();
    const fetched = Array.isArray(payload.models) ? payload.models : [];
    modelOptions = fetched
      .filter((item: any) => item?.id && isReasoningProvider(item?.provider))
      .map((item: any) => {
        const provider = item.provider as ReasoningProvider;
        return {
          value: `${provider}::${item.id}`,
          label: item.label ?? `${getModelProviderLabel(provider)} · ${item.id}`,
          description: item.description ?? 'Reasoning model',
          provider,
          id: item.id
        };
      });
  }

  onMount(async () => {
    try {
      const token = await getIdToken();
      if (token) {
        await loadByokProviders(token);
        await refreshIngestionBilling(token);
      }
      await loadModelOptions(token, keySource);
    } catch {
      modelOptions = buildFallbackModelOptions(keySource);
    }
  });

  const activeByokProviders = $derived.by(() =>
    byokProviders
      .filter((provider) => provider.status === 'active')
      .map((provider) => provider.provider)
      .filter((provider): provider is ReasoningProvider => isReasoningProvider(provider))
  );

  const hasAnyActiveByok = $derived(activeByokProviders.length > 0);

  const canRunDeepWithCurrentKey = $derived.by(() => {
    if (keySource === 'platform') return false;
    return activeByokProviders.includes(keySource);
  });

  const keySourceDescription = $derived.by(() => {
    if (keySource === 'platform') {
      return 'Use platform-funded capacity (quick/standard only, daily budget applies).';
    }
    const providerLabel = PROVIDER_UI_META[keySource].label;
    return canRunDeepWithCurrentKey
      ? `Use your ${providerLabel} key for this run.`
      : `${providerLabel} key not active yet. Configure it in Settings first.`;
  });

  $effect(() => {
    if (keySource === 'platform') return;
    if (activeByokProviders.includes(keySource)) return;
    keySource = 'platform';
  });

  $effect(() => {
    if (previousKeySource === keySource) return;
    customModelId = '';
    previousKeySource = keySource;
  });

  $effect(() => {
    if (selectedDepth !== 'deep') return;
    if (canRunDeepWithCurrentKey) return;
    selectedDepth = 'standard';
  });

  $effect(() => {
    if (modelSelectOptions.length === 0) return;
    if (selectedModelValue === 'auto') return;
    const selectedOption = modelSelectOptions.find((option) => option.value === selectedModelValue);
    if (selectedOption && !selectedOption.disabled) return;
    selectedModelValue = 'auto';
  });

  $effect(() => {
    if (runtimeUserLinks.length === 0) return;
    let changed = false;
    const next = { ...ingestVisibilities };
    for (const url of runtimeUserLinks) {
      if (!ingestSelections[url]) continue;
      const current = next[url] ?? 'public_shared';
      if (current === 'public_shared' && !publicIngestionAvailable && privateIngestionAvailable) {
        next[url] = 'private_user_only';
        changed = true;
      } else if (current === 'private_user_only' && !privateIngestionAvailable && publicIngestionAvailable) {
        next[url] = 'public_shared';
        changed = true;
      }
    }
    if (changed) ingestVisibilities = next;
  });

  $effect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    (async () => {
      const token = await getIdToken();
      if (!token) return;
      try {
        await loadModelOptions(token, keySource);
      } catch {
        if (!cancelled) {
          modelOptions = buildFallbackModelOptions(keySource);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
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
  let hasStreamingCorePass = $derived.by(() => {
    const live = conversation.currentPasses;
    return Boolean(live.analysis.trim() || live.critique.trim() || live.synthesis.trim());
  });
  let displayedPasses = $derived.by(() => {
    if (conversation.isLoading) {
      return {
        analysis: conversation.currentPasses.analysis ?? '',
        critique: conversation.currentPasses.critique ?? '',
        synthesis: conversation.currentPasses.synthesis ?? '',
        verification: conversation.currentPasses.verification ?? ''
      };
    }
    return {
      analysis: lastAssistantMsg?.passes?.analysis ?? '',
      critique: lastAssistantMsg?.passes?.critique ?? '',
      synthesis: lastAssistantMsg?.passes?.synthesis ?? '',
      verification: lastAssistantMsg?.passes?.verification ?? ''
    };
  });
  let hasDisplayedCorePass = $derived.by(() =>
    Boolean(displayedPasses.analysis || displayedPasses.critique || displayedPasses.synthesis)
  );
  const requiredPassesByDepth: Record<'quick' | 'standard' | 'deep', Array<'analysis' | 'critique' | 'synthesis'>> = {
    quick: ['analysis'],
    standard: ['analysis', 'critique', 'synthesis'],
    deep: ['analysis', 'critique', 'synthesis']
  };
  let isResultsState = $derived(
    conversation.isLoading ? hasStreamingCorePass : hasDisplayedCorePass
  );
  let showLiveProgressHero = $derived.by(
    () =>
      conversation.isLoading &&
      (conversation.currentPass === 'analysis' ||
        conversation.currentPass === 'critique' ||
        conversation.currentPass === 'synthesis')
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
  // Fullscreen loader is shown only before the first pass starts streaming.
  let isLoadingState = $derived(conversation.isLoading && !hasStreamingCorePass);

  let availablePasses = $derived.by(() => {
    const available: Array<'analysis' | 'critique' | 'synthesis' | 'verification'> = [];
    if (displayedPasses.analysis) available.push('analysis');
    if (displayedPasses.critique) available.push('critique');
    if (displayedPasses.synthesis) available.push('synthesis');
    if (
      displayedPasses.verification ||
      conversation.currentPass === 'verification' ||
      (!conversation.isLoading && (displayedPasses.analysis || displayedPasses.critique || displayedPasses.synthesis))
    ) {
      available.push('verification');
    }
    return available.length > 0 ? available : ['analysis'];
  });

  let loadingStatusText = $derived.by(() => {
    if (!conversation.currentPass) {
      return hasStreamingCorePass
        ? 'SOPHIA is continuing the inquiry…'
        : 'SOPHIA is assembling the first pass of your question - let her think for a moment…';
    }
    const base = LOADING_STATUS[conversation.currentPass] ?? 'Thinking…';
    const provider = conversation.passModels[conversation.currentPass]?.provider ?? conversation.loadingModelProvider;
    if (provider && provider !== 'vertex' && provider !== 'auto' && (conversation.currentPass === 'critique' || conversation.currentPass === 'synthesis')) {
      return `${base} ${getModelProviderLabel(provider)} deep reasoning can take longer.`;
    }
    return base;
  });

  let loadingPassLabel = $derived(
    conversation.currentPass ? (PASS_LABELS[conversation.currentPass] ?? 'Foundations') : 'Foundations'
  );

  let loadingModelLabel = $derived.by(() => {
    const passModel = conversation.currentPass ? conversation.passModels[conversation.currentPass] : undefined;
    if (passModel) {
      return `${getModelProviderLabel(passModel.provider)} · ${passModel.modelId}`;
    }
    if (conversation.loadingModelProvider && conversation.loadingModelProvider !== 'auto') {
      return `${getModelProviderLabel(conversation.loadingModelProvider)}${conversation.loadingModelId ? ` · ${conversation.loadingModelId}` : ''}`;
    }
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

  let liveProgressHint = $derived.by(() => {
    if (!completedPasses.includes('analysis')) {
      return 'The first layer is taking shape.';
    }
    if (!completionReadyForDepth) {
      return 'You can begin reading while the deeper passes continue.';
    }
    return 'Thought complete. Here is what emerged.';
  });

  let epistemicContent = $derived.by(() => {
    if (!conversation.confidenceSummary) return null;
    const { avgConfidence, lowConfidenceCount, totalClaims } = conversation.confidenceSummary;
    return `Average confidence across ${totalClaims} claim${totalClaims !== 1 ? 's' : ''}: ${(avgConfidence * 100).toFixed(0)}%. ${lowConfidenceCount} claim${lowConfidenceCount !== 1 ? 's' : ''} flagged for review.`;
  });

  let resultsCompletedPasses = $derived.by(() => {
    if (conversation.isLoading) {
      return conversation.completedPasses.filter((pass) =>
        pass === 'analysis' || pass === 'critique' || pass === 'synthesis' || pass === 'verification'
      );
    }
    return (['analysis', 'critique', 'synthesis', 'verification'] as const).filter((k) => !!displayedPasses[k]);
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

  const currentQuery = $derived(
    conversation.messages.findLast((m) => m.role === 'user')?.content ?? ''
  );

  const currentQueryNormalized = $derived(
    currentQuery.trim().toLowerCase()
  );
  const runtimeUserLinks = $derived(
    parseUserLinksInput(userLinksInput)
  );
  const selectedIngestionCount = $derived.by(() =>
    runtimeUserLinks.filter((url) => ingestSelections[url] === true).length
  );
  const publicIngestionAvailable = $derived.by(() => {
    const remaining = ingestionBilling.publicRemaining;
    return remaining === null ? true : remaining > 0;
  });
  const privateIngestionAvailable = $derived.by(() => {
    const remaining = ingestionBilling.privateRemaining;
    const wallet = ingestionBilling.walletAvailableCents;
    const remainingOk = remaining === null ? true : remaining > 0;
    const walletOk = wallet === null ? true : wallet > 0;
    return remainingOk && walletOk;
  });
  const canQueueAnyIngestion = $derived.by(() => publicIngestionAvailable || privateIngestionAvailable);
  const hasPendingPublicShareAcknowledgement = $derived.by(() =>
    runtimeUserLinks.some(
      (url) =>
        ingestSelections[url] === true &&
        (ingestVisibilities[url] ?? 'public_shared') === 'public_shared' &&
        publicShareAcks[url] !== true
    )
  );

  const comparisonCandidate = $derived.by(() => {
    const normalizedQuery = currentQueryNormalized;
    if (!normalizedQuery || !lastAssistantMsg?.passes) return null;
    const currentRunId = lastAssistantMsg.metadata?.query_run_id;
    const currentPasses = lastAssistantMsg.passes;
    const candidates = historyStore.cachedResults.filter(
      (entry) => entry.query.trim().toLowerCase() === normalizedQuery
    );
    for (const entry of candidates) {
      const candidateRunId = entry.metadata?.query_run_id;
      if (currentRunId && candidateRunId && currentRunId === candidateRunId) continue;
      const samePasses =
        entry.passes.analysis === (currentPasses.analysis ?? '') &&
        entry.passes.critique === (currentPasses.critique ?? '') &&
        entry.passes.synthesis === (currentPasses.synthesis ?? '') &&
        (entry.passes.verification ?? '') === (currentPasses.verification ?? '');
      if (!currentRunId && samePasses) continue;
      return entry;
    }
    return null;
  });

  const currentVariantLabel = $derived.by(() =>
    formatRunVariantLabel(lastAssistantMsg?.metadata, 'Current run')
  );

  const comparisonVariantLabel = $derived.by(() =>
    comparisonCandidate
      ? formatRunVariantLabel(comparisonCandidate.metadata, 'Previous run')
      : 'Previous run'
  );

  const runCostHistory = $derived.by(() => {
    const messages = conversation.messages;
    const entries: RunCostEntry[] = [];
    for (let idx = 0; idx < messages.length; idx += 1) {
      const message = messages[idx];
      if (message.role !== 'assistant' || !message.metadata) continue;
      const query = findNearestUserQuery(messages, idx);
      const metadata = message.metadata;
      entries.push({
        id: message.id,
        runLabel: `Run ${entries.length + 1}`,
        query,
        queryRunId: metadata.query_run_id ?? null,
        depthMode: metadata.depth_mode ?? null,
        selectedModelLabel: formatSelectedModel(metadata),
        totalInputTokens: metadata.total_input_tokens ?? 0,
        totalOutputTokens: metadata.total_output_tokens ?? 0,
        durationMs: metadata.duration_ms ?? 0,
        totalEstimatedCostUsd: calculateDisplayedCost(metadata),
        passEstimates: estimatePassCosts(metadata)
      });
    }
    return [...entries].reverse();
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  function stripSophiaMeta(text: string): string {
    return text
      .replace(/```sophia-meta[\s\S]*?```/g, '')
      .replace(/\n?\{\s*"sections"\s*:\s*\[[\s\S]*$/m, '')
      .trim();
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

  function formatModelLabel(provider: ReasoningProvider, model: string): string {
    const shortModel = model.length > 28 ? `${model.slice(0, 28)}…` : model;
    return `${provider}:${shortModel}`;
  }

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function parseUserLinksInput(value: string): string[] {
    return value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 5);
  }

  function linkIngestionSelected(url: string): boolean {
    return ingestSelections[url] === true;
  }

  function linkIngestionVisibility(url: string): 'public_shared' | 'private_user_only' {
    return ingestVisibilities[url] ?? 'public_shared';
  }

  function publicShareAcknowledged(url: string): boolean {
    return publicShareAcks[url] === true;
  }

  function setLinkIngestionSelected(url: string, selected: boolean): void {
    ingestSelections = {
      ...ingestSelections,
      [url]: selected
    };
    if (selected) {
      const current = ingestVisibilities[url] ?? 'public_shared';
      const fallbackVisibility = publicIngestionAvailable
        ? 'public_shared'
        : privateIngestionAvailable
          ? 'private_user_only'
          : current;
      if (
        (current === 'public_shared' && !publicIngestionAvailable) ||
        (current === 'private_user_only' && !privateIngestionAvailable)
      ) {
        ingestVisibilities = {
          ...ingestVisibilities,
          [url]: fallbackVisibility
        };
      }
    }
    if (!selected) {
      publicShareAcks = {
        ...publicShareAcks,
        [url]: false
      };
    }
  }

  function setLinkIngestionVisibility(
    url: string,
    visibility: 'public_shared' | 'private_user_only'
  ): void {
    if (visibility === 'public_shared' && !publicIngestionAvailable) return;
    if (visibility === 'private_user_only' && !privateIngestionAvailable) return;
    ingestVisibilities = {
      ...ingestVisibilities,
      [url]: visibility
    };
    if (visibility !== 'public_shared') {
      publicShareAcks = {
        ...publicShareAcks,
        [url]: false
      };
    }
  }

  function setPublicShareAck(url: string, acknowledged: boolean): void {
    publicShareAcks = {
      ...publicShareAcks,
      [url]: acknowledged
    };
  }

  function buildLinkIngestionPreferences(
    userLinks: string[]
  ): Array<{
    url: string;
    ingest_selected: boolean;
    ingest_visibility: 'public_shared' | 'private_user_only';
    acknowledge_public_share?: boolean;
  }> {
    return userLinks.map((url) => {
      const selected = linkIngestionSelected(url);
      const visibility = linkIngestionVisibility(url);
      return {
        url,
        ingest_selected: selected,
        ingest_visibility: visibility,
        acknowledge_public_share: visibility === 'public_shared' ? publicShareAcknowledged(url) : undefined
      };
    });
  }

  function formatWalletCents(value: number | null, currency: 'GBP' | 'USD'): string {
    if (value === null) return '—';
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency
    }).format(Math.max(0, value) / 100);
  }

  function formatRunVariantLabel(
    metadata:
      | {
          selected_model_provider?: ModelProvider;
          selected_model_id?: string;
          depth_mode?: 'quick' | 'standard' | 'deep';
          user_links_count?: number;
        }
      | undefined,
    fallback: string
  ): string {
    if (!metadata) return fallback;
    const provider = metadata.selected_model_provider && metadata.selected_model_provider !== 'auto'
      ? getModelProviderLabel(metadata.selected_model_provider)
      : 'Auto';
    const model = metadata.selected_model_id ? ` · ${metadata.selected_model_id}` : '';
    const depth = metadata.depth_mode ? ` · ${metadata.depth_mode}` : '';
    const links = metadata.user_links_count ? ` · ${metadata.user_links_count} links` : '';
    return `${provider}${model}${depth}${links}`;
  }

  function findNearestUserQuery(messages: Array<{ role: 'user' | 'assistant'; content: string }>, assistantIndex: number): string {
    for (let idx = assistantIndex - 1; idx >= 0; idx -= 1) {
      if (messages[idx]?.role === 'user') return messages[idx].content;
    }
    return 'Query';
  }

  function formatSelectedModel(metadata: {
    selected_model_provider?: ModelProvider;
    selected_model_id?: string;
    model_cost_breakdown?: {
      by_model?: Array<{ provider: ReasoningProvider; model: string; estimated_cost_usd: number }>;
    };
  }): string {
    if (metadata.selected_model_provider && metadata.selected_model_provider !== 'auto') {
      const provider = getModelProviderLabel(metadata.selected_model_provider);
      const model = metadata.selected_model_id ? ` · ${metadata.selected_model_id}` : '';
      return `${provider}${model}`;
    }
    const byModel = metadata.model_cost_breakdown?.by_model ?? [];
    if (byModel.length === 0) return 'Auto';
    const dominant = [...byModel].sort((a, b) => b.estimated_cost_usd - a.estimated_cost_usd)[0];
    return `${getModelProviderLabel(dominant.provider)} · ${dominant.model}`;
  }

  function estimatePassCosts(metadata: {
    model_cost_breakdown?: {
      by_model: Array<{
        provider: ReasoningProvider;
        model: string;
        passes: string[];
        input_tokens: number;
        output_tokens: number;
        estimated_cost_usd: number;
      }>;
    };
  }): RunCostPassEstimate[] {
    type PassId = 'analysis' | 'critique' | 'synthesis' | 'verification';
    const byModel = metadata.model_cost_breakdown?.by_model ?? [];
    if (byModel.length === 0) return [];
    const passMap = new Map<PassId, RunCostPassEstimate>();
    for (const item of byModel) {
      const rawPasses = Array.isArray(item.passes) ? item.passes : [];
      const resolvedPasses = rawPasses
        .filter((pass): pass is PassId =>
          pass === 'analysis' || pass === 'critique' || pass === 'synthesis' || pass === 'verification'
        );
      if (resolvedPasses.length === 0) continue;
      const bucketPasses: PassId[] = resolvedPasses;
      const weight = 1 / bucketPasses.length;
      const modelLabel = `${getModelProviderLabel(item.provider)} · ${item.model}`;
      for (const pass of bucketPasses) {
        const existing = passMap.get(pass) ?? {
          pass,
          modelLabels: [],
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: 0
        };
        if (!existing.modelLabels.includes(modelLabel)) {
          existing.modelLabels = [...existing.modelLabels, modelLabel];
        }
        existing.inputTokens += item.input_tokens * weight;
        existing.outputTokens += item.output_tokens * weight;
        existing.estimatedCostUsd += item.estimated_cost_usd * weight;
        passMap.set(pass, existing);
      }
    }
    const order: PassId[] = [
      'analysis',
      'critique',
      'synthesis',
      'verification'
    ];
    return order
      .map((pass) => passMap.get(pass))
      .filter((entry): entry is RunCostPassEstimate => Boolean(entry))
      .map((entry) => ({
        ...entry,
        inputTokens: Math.round(entry.inputTokens),
        outputTokens: Math.round(entry.outputTokens),
        estimatedCostUsd: Number(entry.estimatedCostUsd.toFixed(6))
      }));
  }

  function buildRuntimeResourceOptions(): {
    resourceMode: 'standard' | 'expanded';
    userLinks: string[];
    linkPreferences: Array<{
      url: string;
      ingest_selected: boolean;
      ingest_visibility: 'public_shared' | 'private_user_only';
      acknowledge_public_share?: boolean;
    }>;
    queueForNightlyIngest: boolean;
  } {
    const userLinks = parseUserLinksInput(userLinksInput);
    const linkPreferences = buildLinkIngestionPreferences(userLinks);
    return {
      resourceMode: userLinks.length > 0 ? 'expanded' : 'standard',
      userLinks,
      linkPreferences,
      queueForNightlyIngest: linkPreferences.some((pref) => pref.ingest_selected)
    };
  }

  function buildCredentialOptions(): {
    credentialMode: 'platform' | 'byok';
    byokProvider?: ByokProvider;
  } {
    if (keySource === 'platform') {
      return {
        credentialMode: 'platform'
      };
    }
    return {
      credentialMode: 'byok',
      byokProvider: keySource
    };
  }

  function buildModelOptionsForSubmit(): {
    modelProvider: ModelProvider;
    modelId?: string;
  } {
    const customModel = customModelId.trim();
    if (customModel && keySource !== 'platform') {
      return {
        modelProvider: keySource,
        modelId: customModel
      };
    }
    return {
      modelProvider: selectedModel.provider,
      modelId: selectedModel.modelId
    };
  }

  function prepareForNewRun(): void {
    activeResultPass = 'analysis';
    autoFocusFirstPass = true;
  }

  function lockToPass(pass: 'analysis' | 'critique' | 'synthesis' | 'verification'): void {
    activeResultPass = pass;
    autoFocusFirstPass = false;
  }

  // ── Handlers ──────────────────────────────────────────────────────────────
  async function handleSubmit(): Promise<void> {
    if (!queryInput.trim() || conversation.isLoading || hasPendingPublicShareAcknowledgement) return;
    const query = queryInput.trim();
    queryInput = '';
    prepareForNewRun();
    await conversation.submitQuery(query, selectedLens || undefined, {
      queryKind: 'new',
      depthMode: selectedDepth,
      ...buildCredentialOptions(),
      ...buildModelOptionsForSubmit(),
      domainMode: selectedDomain === 'auto' ? 'auto' : 'manual',
      domain: selectedDomain === 'auto' ? undefined : selectedDomain,
      ...buildRuntimeResourceOptions()
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
    const depthMode = entry.depthMode ?? 'standard';
    const modelProvider = entry.modelProvider ?? 'auto';
    const modelId = entry.modelId;

    selectedDepth = depthMode;
    applyModelSelection(modelProvider, modelId);
    prepareForNewRun();

    const cached = historyStore.findCachedResult(entry.question, {
      depthMode,
      modelProvider,
      modelId
    });

    if (cached) {
      conversation.showCachedResult(entry.question, cached, { appendUserMessage: true });
      autoFocusFirstPass = false;
      return;
    }

    await conversation.submitQuery(entry.question, selectedLens || undefined, {
      queryKind: 'new',
      depthMode,
      ...buildCredentialOptions(),
      modelProvider,
      modelId,
      domainMode: selectedDomain === 'auto' ? 'auto' : 'manual',
      domain: selectedDomain === 'auto' ? undefined : selectedDomain,
      ...buildRuntimeResourceOptions(),
      bypassQuestionLimit: true
    });
  }

  function handleTabChange(tab: TabId): void {
    activeTab = tab;
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('panelTab', tab);
    replaceState(url.toString(), page.state);
  }

  async function openGraphVisualization(mode: 'panel' | 'full' = 'full'): Promise<void> {
    if (mode === 'panel') {
      activeTab = 'map';
      panelStore.openPanel();
      handleTabChange('map');
      return;
    }
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.pathname = '/map';
      url.searchParams.delete('panelTab');
      await goto(url.toString(), { replaceState: false, noScroll: true, keepFocus: true });
      return;
    }
    await goto('/map');
  }

  async function retryLastQuery(): Promise<void> {
    const lastQuery = conversation.messages.findLast(m => m.role === 'user')?.content;
    if (!lastQuery) return;
    prepareForNewRun();
    await conversation.submitQuery(lastQuery, selectedLens || undefined, {
      queryKind: 'new',
      depthMode: selectedDepth,
      ...buildCredentialOptions(),
      ...buildModelOptionsForSubmit(),
      domainMode: selectedDomain === 'auto' ? 'auto' : 'manual',
      domain: selectedDomain === 'auto' ? undefined : selectedDomain,
      ...buildRuntimeResourceOptions()
    });
  }

  async function rerunWithExternalSources(): Promise<void> {
    if (conversation.isLoading || hasPendingPublicShareAcknowledgement) return;
    const lastQuery = conversation.messages.findLast((m) => m.role === 'user')?.content;
    if (!lastQuery) return;
    prepareForNewRun();
    await conversation.submitQuery(lastQuery, selectedLens || undefined, {
      queryKind: 'rerun',
      depthMode: currentDepthMode,
      ...buildCredentialOptions(),
      ...buildModelOptionsForSubmit(),
      domainMode: selectedDomain === 'auto' ? 'auto' : 'manual',
      domain: selectedDomain === 'auto' ? undefined : selectedDomain,
      ...buildRuntimeResourceOptions(),
      bypassQuestionLimit: true
    });
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
    prepareForNewRun();
    await conversation.submitQuery(lastQuery, selectedLens || undefined, {
      queryKind: 'rerun',
      depthMode: nextDepthUpgrade,
      ...buildCredentialOptions(),
      ...buildModelOptionsForSubmit(),
      domainMode: selectedDomain === 'auto' ? 'auto' : 'manual',
      domain: selectedDomain === 'auto' ? undefined : selectedDomain,
      ...buildRuntimeResourceOptions(),
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
    if (!autoFocusFirstPass) return;
    if (!displayedPasses.analysis) return;
    activeResultPass = 'analysis';
    autoFocusFirstPass = false;
  });

  $effect(() => {
    if (typeof window === 'undefined') return;

    const syncTabFromUrl = () => {
      const url = new URL(window.location.href);
      const panelTab = url.searchParams.get('panelTab');
      const hasMapState = url.searchParams.has('mapNode') || url.searchParams.has('mapRel');
      if (panelTab === 'references' || panelTab === 'map' || panelTab === 'history' || panelTab === 'settings') {
        activeTab = panelTab;
        panelStore.openPanel();
        return;
      }
      if (hasMapState) {
        activeTab = 'map';
        panelStore.openPanel();
      }
    };

    syncTabFromUrl();
    window.addEventListener('popstate', syncTabFromUrl);
    return () => window.removeEventListener('popstate', syncTabFromUrl);
  });

  $effect(() => {
    if (!comparisonCandidate || !currentQueryNormalized) {
      comparisonStore.clear();
      return;
    }
    comparisonStore.setBaselineFromCached(comparisonCandidate, comparisonVariantLabel);
  });

  let pageTitle = $derived.by(() => {
    const lastUser = conversation.messages.findLast(m => m.role === 'user')?.content;
    if (isLoadingState) return 'Analysing… — SOPHIA';
    if (conversation.isLoading && isResultsState) return 'Streaming passes… — SOPHIA';
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
            <h1 class="query-heading">What do you want to think about today?</h1>
            <p class="query-sub">Ask a question that matters. SOPHIA will explore it through analysis, critique, and synthesis - three voices in one conversation.</p>
            <p class="query-persona">You can just start typing. Or choose a sample question below.</p>

            <div class="query-input-wrap">
              <QuestionInput
                bind:value={queryInput}
                onSubmit={handleSubmit}
                disabled={conversation.isLoading}
                onkeydown={handleKeydown}
              />

              <div class="suggested-frame">
                <div class="suggested-header">
                  <h3>Try one of these timeless questions:</h3>
                  <p>Tap one to begin, then revise it in your own words.</p>
                </div>
                <div class="example-pills" aria-label="Suggested questions">
                {#each rotatingQuestions as q}
                  <button
                    class="pill"
                    onclick={() => { queryInput = q; }}
                  >
                    {q}
                  </button>
                {/each}
                </div>
              </div>

              <div class="key-model-frame">
                <div class="frame-title">Thinking Engine</div>
                <p class="frame-copy">
                  Choose where SOPHIA should reason from for this inquiry.
                </p>
                <div class="credential-stack">
                  <div class="key-source-row">
                    <label for="key-source-select">Choose your key</label>
                    <select id="key-source-select" bind:value={keySource}>
                      <option value="platform">Platform key (limited)</option>
                      {#each QUERY_KEY_PROVIDER_ORDER as provider}
                        <option value={provider} disabled={!activeByokProviders.includes(provider)}>
                          My {PROVIDER_UI_META[provider].label} key {!activeByokProviders.includes(provider) ? '(not active)' : ''}
                        </option>
                      {/each}
                    </select>
                  </div>
                  <ModelSelector
                    bind:value={selectedModelValue}
                    options={modelSelectOptions}
                    disabled={conversation.isLoading}
                  />
                  {#if keySource !== 'platform'}
                    <div class="custom-model-row">
                      <label for="custom-model-id">Or enter any model id</label>
                      <input
                        id="custom-model-id"
                        type="text"
                        bind:value={customModelId}
                        disabled={conversation.isLoading}
                        placeholder={customModelPlaceholder(keySource)}
                        spellcheck="false"
                        autocomplete="off"
                      />
                    </div>
                    <p class="custom-model-hint">
                      Custom model ids are sent directly with your {PROVIDER_UI_META[keySource].label} key.
                    </p>
                  {/if}
                </div>
                <p class="key-source-hint">{keySourceDescription}</p>
                {#if byokStatusError}
                  <p class="key-source-error">Unable to refresh BYOK status: {byokStatusError}</p>
                {/if}
              </div>

              <div class="reasoning-frame">
                <div class="frame-title">Advanced settings →</div>
                <p class="frame-copy">
                  Adjust SOPHIA's reasoning depth, domain focus, or data sources. These options are for when you want to steer her reasoning more precisely.
                </p>
                {#if domainSelectorEnabled}
                  <div class="domain-row">
                    <label for="domain-select">Reasoning Focus</label>
                    <select id="domain-select" bind:value={selectedDomain}>
                      <option value="auto">Auto</option>
                      <option value="ethics">Ethics</option>
                      <option value="philosophy_of_mind">Philosophy of Mind</option>
                    </select>
                  </div>
                {/if}
                <LensSelector bind:value={selectedLens} domain={selectedDomain} disabled={conversation.isLoading} />
              </div>

              <DepthSelector
                bind:value={selectedDepth}
                disabled={conversation.isLoading}
                allowDeep={canRunDeepWithCurrentKey}
              />

              <div class="resource-frame">
                <div class="frame-title">Reference Material (optional)</div>
                <p class="resource-copy">
                  Add URLs you want SOPHIA to consider in her analysis.
                </p>
                <div class="ingestion-budget">
                  <span>Remaining public ingestions: {ingestionBilling.publicRemaining ?? '—'}</span>
                  <span>Remaining private ingestions: {ingestionBilling.privateRemaining ?? '—'}</span>
                  <span>Wallet: {formatWalletCents(ingestionBilling.walletAvailableCents, ingestionBilling.walletCurrency)}</span>
                  <button
                    class="ingestion-refresh"
                    type="button"
                    onclick={async () => {
                      const token = await getIdToken();
                      if (token) await refreshIngestionBilling(token);
                    }}
                    disabled={ingestionBillingLoading}
                  >
                    {ingestionBillingLoading ? 'Refreshing…' : 'Refresh limits'}
                  </button>
                </div>
                <label class="resource-label" for="user-links">Sources to prioritize (optional)</label>
                <textarea
                  id="user-links"
                  bind:value={userLinksInput}
                  class="links-input"
                  rows="4"
                  placeholder="https://example.com/source-1"
                ></textarea>
                {#if runtimeUserLinks.length > 0}
                  <div class="ingestion-preferences">
                    <p class="resource-note">
                      Choose which links to ingest overnight and whether each source is private or shared.
                    </p>
                    {#each runtimeUserLinks as link}
                      <div class="ingestion-item">
                        <div class="ingestion-head">
                          <label class="ingestion-toggle">
                            <input
                              type="checkbox"
                              checked={linkIngestionSelected(link)}
                              disabled={!canQueueAnyIngestion}
                              onchange={(event) =>
                                setLinkIngestionSelected(
                                  link,
                                  (event.currentTarget as HTMLInputElement).checked
                                )}
                            />
                            <span>Queue this source for ingestion</span>
                          </label>
                          <p class="ingestion-link">{link}</p>
                        </div>
                        {#if linkIngestionSelected(link)}
                          <div class="ingestion-visibility">
                            <label>
                              <input
                                type="radio"
                                name={`visibility-${link}`}
                                checked={linkIngestionVisibility(link) === 'public_shared'}
                                disabled={!publicIngestionAvailable}
                                onchange={() => setLinkIngestionVisibility(link, 'public_shared')}
                              />
                              Public shared ({ingestionBilling.publicRemaining ?? '—'} left)
                            </label>
                            <label>
                              <input
                                type="radio"
                                name={`visibility-${link}`}
                                checked={linkIngestionVisibility(link) === 'private_user_only'}
                                disabled={!privateIngestionAvailable}
                                onchange={() => setLinkIngestionVisibility(link, 'private_user_only')}
                              />
                              Private to my account ({ingestionBilling.privateRemaining ?? '—'} left)
                            </label>
                          </div>
                          {#if !publicIngestionAvailable || !privateIngestionAvailable}
                            <p class="ingestion-limit-note">
                              {#if !publicIngestionAvailable && !privateIngestionAvailable}
                                No ingestion capacity left. Top up wallet and/or wait for monthly reset.
                              {:else if !publicIngestionAvailable}
                                Public ingestion allowance reached.
                              {:else if !privateIngestionAvailable}
                                Private ingestion unavailable (private allowance reached or wallet empty).
                              {/if}
                            </p>
                          {/if}
                          {#if linkIngestionVisibility(link) === 'public_shared'}
                            <label class="ingestion-ack">
                              <input
                                type="checkbox"
                                checked={publicShareAcknowledged(link)}
                                onchange={(event) =>
                                  setPublicShareAck(
                                    link,
                                    (event.currentTarget as HTMLInputElement).checked
                                  )}
                              />
                              <span>
                                I confirm this source may be shared with all users under the
                                <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.
                              </span>
                            </label>
                          {/if}
                        {/if}
                      </div>
                    {/each}
                  </div>
                {/if}
                <p class="resource-note">
                  {#if hasPendingPublicShareAcknowledgement}
                    Public-share acknowledgement is required for selected public sources.
                  {:else if !canQueueAnyIngestion}
                    Ingestion options are disabled until allowance resets or wallet is topped up.
                  {:else if runtimeUserLinks.length > 0}
                    {runtimeUserLinks.length} link(s) will be used now. {selectedIngestionCount} selected for overnight ingestion.
                  {:else}
                    You can also add sources after the first run, then re-run and compare pass/graph differences.
                  {/if}
                </p>
                {#if ingestionBillingError}
                  <p class="resource-note resource-error">Unable to load billing limits: {ingestionBillingError}</p>
                {/if}
              </div>

              <div class="query-actions">
                <Button
                  variant="primary"
                  onclick={handleSubmit}
                  disabled={conversation.isLoading || !queryInput.trim() || hasPendingPublicShareAcknowledgement}
                >
                  Begin Reasoning →
                </Button>
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
            completionReady={false}
            passLabel={loadingPassLabel}
            depthLabel={loadingDepthLabel}
            modelLabel={loadingModelLabel}
            workingLines={loadingWorkingLines}
          />
        </div>
      {/if}

      <!-- ═══════════════════════════════════════════════════════════════
           STATE 3: RESULTS — two-column layout
           ═══════════════════════════════════════════════════════════════ -->
      {#if isResultsState}
        {@const passes = displayedPasses}

        <div class="results-layout" in:fly={{ y: 24, duration: 500, delay: 100, easing: quintOut }}>
          <aside class="pass-nav-col">
            <PassNavigator
              activePass={activeResultPass}
              completedPasses={resultsCompletedPasses}
              {availablePasses}
              showVerification={true}
              onSelect={(p) => {
                lockToPass(p as 'analysis' | 'critique' | 'synthesis' | 'verification');
              }}
            />
            <section class="run-cost-panel" aria-label="Insight depth estimate">
              <header class="run-cost-panel-head">
                <h3>Insight depth estimate</h3>
                {#if conversation.isLoading}
                  <span class="run-cost-live">Live</span>
                {/if}
              </header>
              {#if runCostHistory.length === 0}
                <p class="run-cost-empty">Insight details appear after the first pass completes.</p>
              {:else}
                <div class="run-cost-list">
                  {#each runCostHistory as run, idx (run.id)}
                    <article class="run-cost-run">
                      <div class="run-cost-run-head">
                        <strong>{idx === 0 ? 'Current run' : run.runLabel}</strong>
                        <span>{run.depthMode ? `${run.depthMode} depth` : 'depth —'}</span>
                      </div>
                      <p class="run-cost-query">{run.query}</p>
                      <div class="run-cost-summary">
                        <span>{run.selectedModelLabel}</span>
                        <span>{run.totalInputTokens} in</span>
                        <span>{run.totalOutputTokens} out</span>
                        <span>{formatDuration(run.durationMs)}</span>
                        <span>${run.totalEstimatedCostUsd.toFixed(6)}</span>
                      </div>
                      {#if run.passEstimates.length > 0}
                        <table class="run-cost-table">
                          <thead>
                            <tr>
                              <th>Pass</th>
                              <th>Model</th>
                              <th>Text Volume</th>
                              <th>Usage</th>
                            </tr>
                          </thead>
                          <tbody>
                            {#each run.passEstimates as passEstimate}
                              <tr>
                                <td>{PASS_LABELS[passEstimate.pass]}</td>
                                <td>{passEstimate.modelLabels.join(' + ')}</td>
                                <td>{passEstimate.inputTokens}/{passEstimate.outputTokens}</td>
                                <td>${passEstimate.estimatedCostUsd.toFixed(6)}</td>
                              </tr>
                            {/each}
                          </tbody>
                        </table>
                        <p class="run-cost-footnote">Pass rows are estimated from provider pass-group totals.</p>
                      {/if}
                    </article>
                  {/each}
                </div>
              {/if}
            </section>
          </aside>

          <div class="results-col">
            {#if showLiveProgressHero}
              <div class="live-progress-hero" aria-live="polite">
                <div class="live-progress-stage" aria-hidden="true">
                  <DialecticalTriangle
                    mode="loading"
                    currentPass={conversation.currentPass}
                    {completedPasses}
                    depthMode={selectedDepth}
                    size={200}
                  />
                </div>
                <div class="live-progress-copy">
                  <p class="live-progress-title">Live generation in progress</p>
                  <p class="live-progress-status">{loadingStatusText}</p>
                  <p class="live-progress-hint">{liveProgressHint}</p>
                  <PassTracker
                    currentPass={conversation.currentPass}
                    {completedPasses}
                  />
                </div>
              </div>
            {/if}

            <!-- User query echo -->
            {#if conversation.messages.findLast(m => m.role === 'user')}
              <div class="query-echo">
                <p class="query-echo-text">{conversation.messages.findLast(m => m.role === 'user')?.content}</p>
              </div>
            {/if}

            <div class="graph-cta">
              <div class="graph-cta-copy">
                <strong>See how the answer was built.</strong>
                <span>Open the graph visualisation to inspect traversal paths, filters, and argument structure.</span>
              </div>
              <div class="graph-cta-actions">
                <button class="graph-cta-btn" onclick={() => openGraphVisualization('full')}>
                  Open Graph Visualisation
                </button>
                <button class="graph-cta-btn ghost" onclick={() => openGraphVisualization('panel')}>
                  Study Side by Side
                </button>
              </div>
            </div>

            <!-- Pass cards (tabbed: one visible at a time) -->
            {#if activeResultPass === 'analysis' && passes.analysis}
              <div id="pass-analysis">
                <PassCard pass="analysis" content={renderPass(passes.analysis)} />
                {#if !conversation.isLoading && lastAssistantMsg?.metadata?.query_run_id}
                  <div class="pass-feedback-row">
                    <PassFeedback queryId={lastAssistantMsg.metadata?.query_run_id} passType="analysis" />
                  </div>
                {/if}
              </div>
            {/if}

            {#if activeResultPass === 'critique' && passes.critique}
              <div id="pass-critique">
                <PassCard pass="critique" content={renderPass(passes.critique)} />
                {#if !conversation.isLoading && lastAssistantMsg?.metadata?.query_run_id}
                  <div class="pass-feedback-row">
                    <PassFeedback queryId={lastAssistantMsg.metadata?.query_run_id} passType="critique" />
                  </div>
                {/if}
              </div>
            {/if}

            {#if activeResultPass === 'synthesis' && passes.synthesis}
              <div id="pass-synthesis">
                <PassCard pass="synthesis" content={renderPass(passes.synthesis)} />
                {#if !conversation.isLoading && lastAssistantMsg?.metadata?.query_run_id}
                  <div class="pass-feedback-row">
                    <PassFeedback queryId={lastAssistantMsg.metadata?.query_run_id} passType="synthesis" />
                  </div>
                {/if}
              </div>
            {/if}

            <ReasoningQualityBadge reasoningQuality={!conversation.isLoading ? lastAssistantMsg?.reasoningQuality : undefined} />
            <ConstitutionImpactPanel deltas={!conversation.isLoading ? lastAssistantMsg?.constitutionDeltas : undefined} />

            <!-- Epistemic status -->
            {#if epistemicContent}
              <EpistemicStatus content={epistemicContent} />
            {/if}

            <div class="resource-rerun-card">
              <div class="resource-rerun-head">
                <h3>Add Reference Material (optional) And Re-Run</h3>
                <p>
                  Add links to guide retrieval, or rerun with a different thinking engine.
                </p>
              </div>
              <div class="rerun-config-grid">
                <div class="rerun-field">
                  <label for="rerun-key-source">Key source</label>
                  <select id="rerun-key-source" bind:value={keySource} disabled={conversation.isLoading}>
                    <option value="platform">Platform key (limited)</option>
                    {#each QUERY_KEY_PROVIDER_ORDER as provider}
                      <option value={provider} disabled={!activeByokProviders.includes(provider)}>
                        My {PROVIDER_UI_META[provider].label} key {!activeByokProviders.includes(provider) ? '(not active)' : ''}
                      </option>
                    {/each}
                  </select>
                </div>
                <div class="rerun-field rerun-field-model">
                  <ModelSelector
                    bind:value={selectedModelValue}
                    options={modelSelectOptions}
                    disabled={conversation.isLoading}
                    layout="stacked"
                  />
                </div>
              </div>
              {#if keySource !== 'platform'}
                <div class="custom-model-row rerun-custom-model">
                  <label for="rerun-custom-model-id">Or enter any model id</label>
                  <input
                    id="rerun-custom-model-id"
                    type="text"
                    bind:value={customModelId}
                    disabled={conversation.isLoading}
                    placeholder={customModelPlaceholder(keySource)}
                    spellcheck="false"
                    autocomplete="off"
                  />
                </div>
              {/if}
              <div class="ingestion-budget compact">
                <span>Public left: {ingestionBilling.publicRemaining ?? '—'}</span>
                <span>Private left: {ingestionBilling.privateRemaining ?? '—'}</span>
                <span>Wallet: {formatWalletCents(ingestionBilling.walletAvailableCents, ingestionBilling.walletCurrency)}</span>
              </div>
              <textarea
                bind:value={userLinksInput}
                class="links-input"
                rows="3"
                placeholder="https://example.com/new-source"
              ></textarea>
              {#if runtimeUserLinks.length > 0}
                <div class="ingestion-preferences compact">
                  {#each runtimeUserLinks as link}
                    <div class="ingestion-item">
                      <div class="ingestion-head">
                        <label class="ingestion-toggle">
                          <input
                            type="checkbox"
                            checked={linkIngestionSelected(link)}
                            disabled={!canQueueAnyIngestion}
                            onchange={(event) =>
                              setLinkIngestionSelected(
                                link,
                                (event.currentTarget as HTMLInputElement).checked
                              )}
                          />
                          <span>Queue ingestion</span>
                        </label>
                        <p class="ingestion-link">{link}</p>
                      </div>
                      {#if linkIngestionSelected(link)}
                        <div class="ingestion-visibility">
                          <label>
                            <input
                              type="radio"
                              name={`rerun-visibility-${link}`}
                              checked={linkIngestionVisibility(link) === 'public_shared'}
                              disabled={!publicIngestionAvailable}
                              onchange={() => setLinkIngestionVisibility(link, 'public_shared')}
                            />
                            Public ({ingestionBilling.publicRemaining ?? '—'} left)
                          </label>
                          <label>
                            <input
                              type="radio"
                              name={`rerun-visibility-${link}`}
                              checked={linkIngestionVisibility(link) === 'private_user_only'}
                              disabled={!privateIngestionAvailable}
                              onchange={() => setLinkIngestionVisibility(link, 'private_user_only')}
                            />
                            Private ({ingestionBilling.privateRemaining ?? '—'} left)
                          </label>
                        </div>
                        {#if !publicIngestionAvailable || !privateIngestionAvailable}
                          <p class="ingestion-limit-note">
                            {#if !publicIngestionAvailable && !privateIngestionAvailable}
                              No ingestion capacity left. Top up wallet and/or wait for monthly reset.
                            {:else if !publicIngestionAvailable}
                              Public ingestion allowance reached.
                            {:else}
                              Private ingestion unavailable (private allowance reached or wallet empty).
                            {/if}
                          </p>
                        {/if}
                        {#if linkIngestionVisibility(link) === 'public_shared'}
                          <label class="ingestion-ack">
                            <input
                              type="checkbox"
                              checked={publicShareAcknowledged(link)}
                              onchange={(event) =>
                                setPublicShareAck(
                                  link,
                                  (event.currentTarget as HTMLInputElement).checked
                                )}
                            />
                            <span>I confirm this source can be shared publicly.</span>
                          </label>
                        {/if}
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
              <div class="upgrade-row">
                <button
                  class="upgrade-btn"
                  onclick={rerunWithExternalSources}
                  disabled={conversation.isLoading || hasPendingPublicShareAcknowledgement}
                >
                  Explore Again
                </button>
                <span class="upgrade-note">
                  Uses selected key/model above. {selectedIngestionCount} link(s) selected for ingestion.
                </span>
              </div>
            </div>

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
                      Scholarly Review
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
                    Run Scholarly Review
                  </button>
                {/if}
              </div>
            {/if}

            <!-- Metadata -->
            {#if !conversation.isLoading && lastAssistantMsg?.metadata}
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
            {/if}

            {#if !conversation.isLoading && comparisonCandidate && lastAssistantMsg?.passes}
              <ModelComparePanel
                leftLabel={comparisonVariantLabel}
                rightLabel={currentVariantLabel}
                leftPasses={{
                  analysis: comparisonCandidate.passes.analysis,
                  critique: comparisonCandidate.passes.critique,
                  synthesis: comparisonCandidate.passes.synthesis,
                  verification: comparisonCandidate.passes.verification
                }}
                rightPasses={{
                  analysis: lastAssistantMsg.passes.analysis,
                  critique: lastAssistantMsg.passes.critique,
                  synthesis: lastAssistantMsg.passes.synthesis,
                  verification: lastAssistantMsg.passes.verification
                }}
                leftMeta={comparisonCandidate.metadata}
                rightMeta={lastAssistantMsg.metadata}
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
                      prepareForNewRun();
                      conversation.submitQuery(q, selectedLens || undefined, {
                        queryKind: 'follow_up',
                        depthMode: selectedDepth,
                        ...buildCredentialOptions(),
                        ...buildModelOptionsForSubmit(),
                        domainMode: selectedDomain === 'auto' ? 'auto' : 'manual',
                        domain: selectedDomain === 'auto' ? undefined : selectedDomain,
                        ...buildRuntimeResourceOptions()
                      });
                    }}
                  />
                {/if}
                <FollowUpInput
                  onSubmit={(text) => {
                    prepareForNewRun();
                    conversation.submitQuery(text, selectedLens || undefined, {
                      queryKind: 'follow_up',
                      depthMode: selectedDepth,
                      ...buildCredentialOptions(),
                      ...buildModelOptionsForSubmit(),
                      domainMode: selectedDomain === 'auto' ? 'auto' : 'manual',
                      domain: selectedDomain === 'auto' ? undefined : selectedDomain,
                      ...buildRuntimeResourceOptions()
                    });
                  }}
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
    margin-bottom: var(--space-2);
    text-align: center;
  }

  .query-persona {
    margin: 0 0 var(--space-5);
    font-family: var(--font-display);
    font-size: 0.95rem;
    font-style: italic;
    color: var(--color-muted);
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

  .key-model-frame {
    width: min(700px, 100%);
    border: 1px solid var(--color-sage-border);
    background: var(--color-surface);
    border-radius: 4px;
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .credential-stack {
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

  .frame-copy {
    margin: -2px 0 2px;
    font-family: var(--font-ui);
    font-size: 0.72rem;
    color: var(--color-dim);
    text-align: left;
    line-height: 1.4;
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

  .key-source-row {
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

  .key-source-row select {
    background: var(--color-surface);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    border-radius: 3px;
    padding: 6px 8px;
    font-size: 0.78rem;
    text-transform: none;
    letter-spacing: 0;
    min-width: 240px;
  }

  .custom-model-row {
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

  .custom-model-row input {
    background: var(--color-surface);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    border-radius: 3px;
    padding: 6px 8px;
    font-size: 0.78rem;
    text-transform: none;
    letter-spacing: 0;
    min-width: 240px;
    width: min(420px, 100%);
  }

  .custom-model-hint {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 0.72rem;
    color: var(--color-dim);
    text-align: left;
    line-height: 1.4;
    text-transform: none;
    letter-spacing: 0;
  }

  .key-source-hint {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 0.72rem;
    color: var(--color-dim);
    text-align: left;
    line-height: 1.4;
    text-transform: none;
    letter-spacing: 0;
  }

  .key-source-error {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 0.7rem;
    color: var(--color-copper);
    text-align: left;
    text-transform: none;
    letter-spacing: 0;
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

  .resource-frame {
    width: min(700px, 100%);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 0.8rem;
    display: grid;
    gap: 0.65rem;
    background: color-mix(in oklab, var(--color-bg-elev) 92%, var(--color-bg) 8%);
  }

  .resource-copy {
    margin: -2px 0 2px;
    font-family: var(--font-ui);
    font-size: 0.74rem;
    color: var(--color-dim);
    text-align: left;
    line-height: 1.45;
  }

  .resource-label {
    font-size: 0.83rem;
    color: var(--color-text-muted);
  }

  .ingestion-budget {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    align-items: center;
    font-family: var(--font-ui);
    font-size: 0.7rem;
    color: var(--color-dim);
  }

  .ingestion-budget.compact {
    font-size: 0.68rem;
    margin-top: -2px;
  }

  .ingestion-refresh {
    margin-left: auto;
    font-size: 0.66rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text);
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
  }

  .ingestion-refresh:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .links-input {
    width: 100%;
    resize: vertical;
    min-height: 88px;
    background: var(--color-bg-soft);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 0.55rem 0.65rem;
    font-size: 0.9rem;
    line-height: 1.35;
  }

  .resource-note {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 0.72rem;
    color: var(--color-muted);
    text-align: left;
  }

  .ingestion-preferences {
    display: grid;
    gap: 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 0.55rem;
    background: var(--color-surface);
  }

  .ingestion-preferences.compact {
    padding: 0.5rem;
  }

  .ingestion-item {
    display: grid;
    gap: 0.45rem;
    border: 1px solid color-mix(in oklab, var(--color-border) 75%, transparent);
    border-radius: 8px;
    padding: 0.5rem;
    background: color-mix(in oklab, var(--color-bg-soft) 85%, transparent);
  }

  .ingestion-head {
    display: grid;
    gap: 0.25rem;
  }

  .ingestion-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.78rem;
    color: var(--color-text);
  }

  .ingestion-link {
    margin: 0;
    font-size: 0.72rem;
    color: var(--color-dim);
    overflow-wrap: anywhere;
  }

  .ingestion-visibility {
    display: flex;
    flex-wrap: wrap;
    gap: 0.7rem;
    font-size: 0.75rem;
    color: var(--color-text);
  }

  .ingestion-visibility label {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }

  .ingestion-ack {
    display: inline-flex;
    align-items: flex-start;
    gap: 0.35rem;
    font-size: 0.72rem;
    color: var(--color-muted);
    line-height: 1.4;
  }

  .ingestion-ack a {
    color: var(--color-blue);
    text-decoration: underline;
  }

  .ingestion-limit-note {
    margin: 0;
    font-size: 0.7rem;
    color: #f0c0aa;
  }

  .resource-error {
    color: #f0c0aa;
  }

  .resource-rerun-card {
    border: 1px solid var(--color-border);
    border-radius: 4px;
    background: var(--color-surface);
    padding: var(--space-3);
    display: grid;
    gap: var(--space-2);
  }

  .resource-rerun-head h3 {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-muted);
  }

  .resource-rerun-head p {
    margin: 6px 0 0;
    font-family: var(--font-ui);
    font-size: 0.73rem;
    color: var(--color-dim);
    line-height: 1.45;
  }

  .rerun-config-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
    align-items: start;
  }

  .rerun-field {
    display: grid;
    gap: 4px;
  }

  .rerun-field label {
    font-family: var(--font-ui);
    font-size: 0.62rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-muted);
  }

  .rerun-field select {
    background: var(--color-surface-raised);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    border-radius: 3px;
    padding: 6px 8px;
    font-size: 0.78rem;
  }

  .rerun-custom-model {
    margin-top: -2px;
  }

  .suggested-frame {
    width: min(700px, 100%);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    background: var(--color-surface);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
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
    justify-content: flex-start;
    margin-top: 2px;
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
    width: 296px;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .run-cost-panel {
    border: 1px solid var(--color-border);
    border-radius: 4px;
    background: color-mix(in srgb, var(--color-surface) 95%, var(--color-bg) 5%);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    max-height: calc(100vh - 220px);
    overflow: auto;
  }

  .run-cost-panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .run-cost-panel-head h3 {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 0.7rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-muted);
  }

  .run-cost-live {
    font-family: var(--font-ui);
    font-size: 0.62rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-sage);
  }

  .run-cost-empty {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 0.72rem;
    color: var(--color-dim);
    line-height: 1.4;
  }

  .run-cost-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .run-cost-run {
    border: 1px solid var(--color-border);
    border-radius: 3px;
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: var(--color-surface);
  }

  .run-cost-run-head {
    display: flex;
    justify-content: space-between;
    gap: var(--space-1);
    align-items: baseline;
    font-family: var(--font-ui);
  }

  .run-cost-run-head strong {
    font-size: 0.66rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text);
  }

  .run-cost-run-head span {
    font-size: 0.62rem;
    color: var(--color-dim);
    letter-spacing: 0.04em;
  }

  .run-cost-query {
    margin: 0;
    font-family: var(--font-display);
    font-size: 0.79rem;
    font-style: italic;
    color: var(--color-muted);
    line-height: 1.45;
  }

  .run-cost-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    font-family: var(--font-ui);
    font-size: 0.62rem;
    color: var(--color-dim);
  }

  .run-cost-summary span:not(:first-child) {
    border-left: 1px solid var(--color-border);
    padding-left: 8px;
  }

  .run-cost-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-family: var(--font-ui);
    font-size: 0.6rem;
    color: var(--color-muted);
  }

  .run-cost-table th {
    text-align: left;
    font-weight: 500;
    color: var(--color-dim);
    padding: 3px 2px;
    border-bottom: 1px solid var(--color-border);
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .run-cost-table td {
    padding: 4px 2px;
    border-bottom: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
    vertical-align: top;
    overflow-wrap: anywhere;
  }

  .run-cost-footnote {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 0.58rem;
    color: var(--color-dim);
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

  .live-progress-hero {
    position: sticky;
    top: calc(var(--space-2) + 2px);
    z-index: 8;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-3) var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background:
      linear-gradient(
        180deg,
        color-mix(in srgb, var(--color-surface-raised) 92%, var(--color-bg) 8%) 0%,
        color-mix(in srgb, var(--color-surface) 94%, var(--color-bg) 6%) 100%
      );
    box-shadow: 0 10px 26px color-mix(in srgb, var(--color-bg) 85%, transparent);
    backdrop-filter: blur(4px);
  }

  .live-progress-stage {
    margin-top: -2px;
    margin-bottom: -4px;
  }

  .live-progress-copy {
    width: 100%;
    display: grid;
    gap: 6px;
    justify-items: center;
  }

  .live-progress-title {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 0.64rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--color-muted);
  }

  .live-progress-status {
    margin: 0;
    font-family: var(--font-display);
    font-size: 0.86rem;
    font-style: italic;
    color: var(--color-text);
    text-align: center;
  }

  .live-progress-hint {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 0.7rem;
    color: var(--color-dim);
    text-align: center;
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

  .graph-cta {
    border: 1px solid var(--color-sage-border);
    background: color-mix(in srgb, var(--color-sage) 14%, var(--color-surface));
    border-radius: 4px;
    padding: var(--space-3);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .graph-cta-copy {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 240px;
  }

  .graph-cta-copy strong {
    font-family: var(--font-ui);
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text);
  }

  .graph-cta-copy span {
    font-family: var(--font-ui);
    font-size: 0.74rem;
    color: var(--color-muted);
    line-height: 1.4;
  }

  .graph-cta-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .graph-cta-btn {
    border: 1px solid var(--color-sage-border);
    background: var(--color-sage);
    color: var(--color-bg);
    border-radius: 3px;
    padding: 8px 12px;
    font-family: var(--font-ui);
    font-size: 0.68rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
    transition: filter var(--transition-fast), border-color var(--transition-fast);
  }

  .graph-cta-btn:hover {
    filter: brightness(1.05);
  }

  .graph-cta-btn.ghost {
    background: transparent;
    color: var(--color-sage);
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

    .run-cost-panel {
      max-height: none;
    }

    .rerun-config-grid {
      grid-template-columns: 1fr;
    }

    .query-input-wrap {
      padding: 0;
    }

    .key-source-row,
    .domain-row,
    .custom-model-row {
      flex-direction: column;
      align-items: stretch;
    }

    .key-source-row select,
    .domain-row select,
    .custom-model-row input {
      min-width: 0;
      width: 100%;
    }

    .pill {
      font-size: 0.75rem;
    }

    .query-heading {
      font-size: 1.5rem;
    }

    .live-progress-hero {
      top: 0;
      padding: var(--space-2) var(--space-2) var(--space-2);
    }

    .live-progress-status {
      font-size: 0.8rem;
    }

    .live-progress-hint {
      font-size: 0.67rem;
      line-height: 1.35;
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
