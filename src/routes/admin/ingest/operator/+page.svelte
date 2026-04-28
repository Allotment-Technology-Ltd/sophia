<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { authorizedFetchJson } from '$lib/authorizedFetchJson';
  import { MAX_DURABLE_INGEST_JOB_CONCURRENCY } from '$lib/ingestionJobConcurrency';
  import IngestionSettingsShell from '$lib/components/admin/ingest/IngestionSettingsShell.svelte';
  import OperatorByokPanel from '$lib/components/admin/ingest/config/OperatorByokPanel.svelte';
  import RoutingConfigPanel from '$lib/components/admin/ingest/config/RoutingConfigPanel.svelte';
  import JobsBatchBuilderTab from '$lib/components/admin/ingest/jobs/JobsBatchBuilderTab.svelte';
  import JobsAdvancedTab from '$lib/components/admin/ingest/jobs/JobsAdvancedTab.svelte';
  import { ADMIN_INGEST_WORKER_UI_DEFAULTS as JOB_UI } from '$lib/adminIngestWorkerUiDefaults';
  import {
    loadOperatorPhasePinsFromStorage,
    operatorPhasePinsToModelChain,
    operatorPhasePinsToWorkerExtras
  } from '$lib/ingestion/operatorPhasePins';
  import {
    DEFAULT_GUTENBERG_PHILOSOPHY_DOMAIN,
    GUTENBERG_PHILOSOPHY_DOMAINS,
    type GutenbergPhilosophyDomainId,
    isGutenbergPhilosophyDomainId
  } from '$lib/admin/gutenbergPhilosophyDomains';
  import {
    GATE_BOOTSTRAP_QUERY_FLAG,
    GATE_BOOTSTRAP_STORAGE_KEY,
    type OperatorGateBootstrapV1
  } from '$lib/ingestion/operatorGateBootstrap';

  type WizardStepId = 'configure' | 'sources' | 'mode' | 'review' | 'monitor' | 'continue';
  let step = $state<WizardStepId>('configure');

  function hydrateStepFromUrl(): void {
    const s = page.url.searchParams.get('step');
    if (s === 'configure' || s === 'sources' || s === 'mode' || s === 'review' || s === 'monitor') {
      step = s;
    }
  }

  function setStep(next: WizardStepId): void {
    step = next;
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('step', next);
    url.searchParams.delete('tab');
    void goto(`${url.pathname}${url.search}`, { replaceState: true, noScroll: true });
  }

  type ConfigureTabId = 'defaults' | 'routing' | 'byok';
  let configureTab = $state<ConfigureTabId>('defaults');

  // Shared “start job” state (quick ingest + build batch share URL list)
  let urlsInput = $state('');
  type SourceCatalogId = 'sep' | 'gutenberg';
  let sourceCatalog = $state<SourceCatalogId>('sep');
  let gutenbergIdsInput = $state('2680\n45109');
  let gutenbergSuggestLimit = $state<string | number>(10);
  let gutenbergDomain = $state<GutenbergPhilosophyDomainId>(DEFAULT_GUTENBERG_PHILOSOPHY_DOMAIN);
  let gutenbergExcludeIngested = $state(true);
  let gutenbergSuggestBusy = $state(false);
  let gutenbergSuggestMsg = $state('');
  let concurrency = $state(MAX_DURABLE_INGEST_JOB_CONCURRENCY);
  let notes = $state('');
  let validateLlm = $state(false);
  let mergeIntoRunningJob = $state(false);
  let jobValidationTailOnly = $state(false);
  type RunMode = 'standard' | 'extract_then_promote';
  let runMode = $state<RunMode>('standard');

  // Durable job advanced defaults (remembered in browser).
  let workerTuningOpen = $state(false);
  let jobForceReingest = $state(false);
  let jobExtractionConcurrency = $state<string | number>(JOB_UI.extractionConcurrency);
  let jobExtractionMaxTokens = $state<string | number>(JOB_UI.extractionMaxTokensPerSection);
  let jobPassageInsertConcurrency = $state<string | number>(JOB_UI.passageInsertConcurrency);
  let jobClaimInsertConcurrency = $state<string | number>(JOB_UI.claimInsertConcurrency);
  let jobRemediationMaxClaims = $state<string | number>(JOB_UI.remediationMaxClaims);
  let jobRelationsOverlap = $state<string | number>(JOB_UI.relationsBatchOverlapClaims);
  let jobIngestProvider = $state<'auto' | 'anthropic' | 'vertex' | 'mistral'>('auto');
  let jobGoogleThroughputEnabled = $state(true);
  let jobGoogleExtractionFloor = $state<string | number>(JOB_UI.googleExtractionConcurrencyFloor);
  let jobFailOnGroupingCollapse = $state(true);
  let jobIngestLogPins = $state(false);
  let jobRemediationEnabled = $state(true);
  let jobRemediationRevalidate = $state(false);
  let jobRemediationTargetedRevalidate = $state(true);
  let jobWatchdogPhaseIdleJson = $state('');
  let jobWatchdogBaselineMult = $state('');
  let jobGlobalMaxConcurrentTogether = $state<string | number>(2);
  let jobGlobalMaxConcurrentVoyage = $state<string | number>(1);
  let jobRelateStoreConcurrency = $state<string | number>(4);

  type BatchExtractionModelMode = 'default' | 'openai_compat' | 'pin_model';
  let batchExtractionModelMode = $state<BatchExtractionModelMode>('default');
  let extractionOpenAiCompatibleBaseUrl = $state('');
  let extractionOpenAiCompatibleModel = $state('');
  let extractionPinnedProviderModel = $state('auto');

  let preferTogetherForDurableJobs = $state(false);
  let preferTogetherModelId = $state('meta-llama/Llama-3.3-70B-Instruct-Turbo');
  let applyOperatorPhaseModelPins = $state(false);

  let submitBusy = $state(false);
  let submitMsg = $state('');

  function fillUrlsFromGutenbergIds(): void {
    const ids = gutenbergIdsInput
      .split(/[^\d]+/g)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => Number.parseInt(s, 10))
      .filter((n) => Number.isFinite(n) && n > 0 && n < 10_000_000);
    const uniq = Array.from(new Set(ids));
    urlsInput = uniq.map((n) => `https://www.gutenberg.org/ebooks/${n}`).join('\n');
  }

  function applyStoicismGutenbergPack(): void {
    gutenbergIdsInput = '2680\n45109';
    fillUrlsFromGutenbergIds();
  }

  const WORKSPACE_SETTINGS_KEY = 'sophia.admin.ingestWorkspace.defaults.v1';
  function hydrateWorkspaceSettings(): void {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(WORKSPACE_SETTINGS_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as Record<string, unknown>;
      if (typeof p.concurrency === 'number') concurrency = p.concurrency;
      if (typeof p.notes === 'string') notes = p.notes;
      if (typeof p.validateLlm === 'boolean') validateLlm = p.validateLlm;
      if (typeof p.mergeIntoRunningJob === 'boolean') mergeIntoRunningJob = p.mergeIntoRunningJob;
      if (typeof p.jobValidationTailOnly === 'boolean') jobValidationTailOnly = p.jobValidationTailOnly;
      if (p.runMode === 'standard' || p.runMode === 'extract_then_promote') runMode = p.runMode;
      if (typeof p.workerTuningOpen === 'boolean') workerTuningOpen = p.workerTuningOpen;
      if (typeof p.jobForceReingest === 'boolean') jobForceReingest = p.jobForceReingest;
      if (typeof p.jobExtractionConcurrency === 'string' || typeof p.jobExtractionConcurrency === 'number')
        jobExtractionConcurrency = p.jobExtractionConcurrency;
      if (typeof p.jobExtractionMaxTokens === 'string' || typeof p.jobExtractionMaxTokens === 'number')
        jobExtractionMaxTokens = p.jobExtractionMaxTokens;
      if (typeof p.jobPassageInsertConcurrency === 'string' || typeof p.jobPassageInsertConcurrency === 'number')
        jobPassageInsertConcurrency = p.jobPassageInsertConcurrency;
      if (typeof p.jobClaimInsertConcurrency === 'string' || typeof p.jobClaimInsertConcurrency === 'number')
        jobClaimInsertConcurrency = p.jobClaimInsertConcurrency;
      if (typeof p.jobRemediationMaxClaims === 'string' || typeof p.jobRemediationMaxClaims === 'number')
        jobRemediationMaxClaims = p.jobRemediationMaxClaims;
      if (typeof p.jobRelationsOverlap === 'string' || typeof p.jobRelationsOverlap === 'number')
        jobRelationsOverlap = p.jobRelationsOverlap;
      if (p.jobIngestProvider === 'auto' || p.jobIngestProvider === 'anthropic' || p.jobIngestProvider === 'vertex' || p.jobIngestProvider === 'mistral')
        jobIngestProvider = p.jobIngestProvider;
      if (typeof p.jobGoogleThroughputEnabled === 'boolean') jobGoogleThroughputEnabled = p.jobGoogleThroughputEnabled;
      if (typeof p.jobGoogleExtractionFloor === 'string' || typeof p.jobGoogleExtractionFloor === 'number')
        jobGoogleExtractionFloor = p.jobGoogleExtractionFloor;
      if (typeof p.jobFailOnGroupingCollapse === 'boolean') jobFailOnGroupingCollapse = p.jobFailOnGroupingCollapse;
      if (typeof p.jobIngestLogPins === 'boolean') jobIngestLogPins = p.jobIngestLogPins;
      if (typeof p.jobRemediationEnabled === 'boolean') jobRemediationEnabled = p.jobRemediationEnabled;
      if (typeof p.jobRemediationRevalidate === 'boolean') jobRemediationRevalidate = p.jobRemediationRevalidate;
      if (typeof p.jobRemediationTargetedRevalidate === 'boolean')
        jobRemediationTargetedRevalidate = p.jobRemediationTargetedRevalidate;
      if (typeof p.jobWatchdogPhaseIdleJson === 'string') jobWatchdogPhaseIdleJson = p.jobWatchdogPhaseIdleJson;
      if (typeof p.jobWatchdogBaselineMult === 'string') jobWatchdogBaselineMult = p.jobWatchdogBaselineMult;
      if (typeof p.jobGlobalMaxConcurrentTogether === 'string' || typeof p.jobGlobalMaxConcurrentTogether === 'number')
        jobGlobalMaxConcurrentTogether = p.jobGlobalMaxConcurrentTogether;
      if (typeof p.jobGlobalMaxConcurrentVoyage === 'string' || typeof p.jobGlobalMaxConcurrentVoyage === 'number')
        jobGlobalMaxConcurrentVoyage = p.jobGlobalMaxConcurrentVoyage;
      if (typeof p.jobRelateStoreConcurrency === 'string' || typeof p.jobRelateStoreConcurrency === 'number')
        jobRelateStoreConcurrency = p.jobRelateStoreConcurrency;
      if (
        p.batchExtractionModelMode === 'default' ||
        p.batchExtractionModelMode === 'openai_compat' ||
        p.batchExtractionModelMode === 'pin_model'
      ) {
        batchExtractionModelMode = p.batchExtractionModelMode;
      }
      if (typeof p.extractionOpenAiCompatibleBaseUrl === 'string')
        extractionOpenAiCompatibleBaseUrl = p.extractionOpenAiCompatibleBaseUrl;
      if (typeof p.extractionOpenAiCompatibleModel === 'string')
        extractionOpenAiCompatibleModel = p.extractionOpenAiCompatibleModel;
      if (typeof p.extractionPinnedProviderModel === 'string')
        extractionPinnedProviderModel = p.extractionPinnedProviderModel;
      if (typeof p.preferTogetherForDurableJobs === 'boolean') preferTogetherForDurableJobs = p.preferTogetherForDurableJobs;
      if (typeof p.preferTogetherModelId === 'string') preferTogetherModelId = p.preferTogetherModelId;
      if (typeof p.applyOperatorPhaseModelPins === 'boolean') applyOperatorPhaseModelPins = p.applyOperatorPhaseModelPins;
      if (typeof p.gutenbergSuggestLimit === 'string' || typeof p.gutenbergSuggestLimit === 'number') {
        gutenbergSuggestLimit = p.gutenbergSuggestLimit;
      }
      if (typeof p.gutenbergExcludeIngested === 'boolean') {
        gutenbergExcludeIngested = p.gutenbergExcludeIngested;
      }
      if (typeof p.gutenbergDomain === 'string' && isGutenbergPhilosophyDomainId(p.gutenbergDomain)) {
        gutenbergDomain = p.gutenbergDomain;
      }
    } catch {
      /* ignore */
    }
  }
  function persistWorkspaceSettings(): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(
        WORKSPACE_SETTINGS_KEY,
        JSON.stringify({
          concurrency,
          notes,
          validateLlm,
          mergeIntoRunningJob,
          jobValidationTailOnly,
          runMode,
          // Advanced defaults
          workerTuningOpen,
          jobForceReingest,
          jobExtractionConcurrency,
          jobExtractionMaxTokens,
          jobPassageInsertConcurrency,
          jobClaimInsertConcurrency,
          jobRemediationMaxClaims,
          jobRelationsOverlap,
          jobIngestProvider,
          jobGoogleThroughputEnabled,
          jobGoogleExtractionFloor,
          jobFailOnGroupingCollapse,
          jobIngestLogPins,
          jobRemediationEnabled,
          jobRemediationRevalidate,
          jobRemediationTargetedRevalidate,
          jobWatchdogPhaseIdleJson,
          jobWatchdogBaselineMult,
          jobGlobalMaxConcurrentTogether,
          jobGlobalMaxConcurrentVoyage,
          jobRelateStoreConcurrency,
          batchExtractionModelMode,
          extractionOpenAiCompatibleBaseUrl,
          extractionOpenAiCompatibleModel,
          extractionPinnedProviderModel,
          preferTogetherForDurableJobs,
          preferTogetherModelId,
          applyOperatorPhaseModelPins,
          gutenbergSuggestLimit,
          gutenbergExcludeIngested,
          gutenbergDomain
        })
      );
    } catch {
      /* ignore */
    }
  }

  function parseUrls(raw: string): string[] {
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const out: string[] = [];
    for (const line of lines) {
      try {
        new URL(line);
        out.push(line);
      } catch {
        /* skip */
      }
    }
    return [...new Set(out)];
  }

  function prefillUrlFromQueryParam(): void {
    const raw = page.url.searchParams.get('prefillUrl')?.trim();
    if (!raw) return;
    try {
      new URL(raw);
    } catch {
      return;
    }
    urlsInput = urlsInput.trim() ? `${urlsInput.trim()}\n${raw}` : raw;
    if (typeof window === 'undefined') return;
    const next = new URL(window.location.href);
    next.searchParams.delete('prefillUrl');
    void goto(`${next.pathname}${next.search}`, { replaceState: true, noScroll: true });
  }

  function hydrateCatalogFromQuery(): void {
    const c = page.url.searchParams.get('catalog')?.trim().toLowerCase();
    if (c === 'sep' || c === 'gutenberg') sourceCatalog = c;
  }

  function hydrateGateBootstrapFromSession(): void {
    if (typeof window === 'undefined') return;
    const flag = page.url.searchParams.get(GATE_BOOTSTRAP_QUERY_FLAG);
    if (flag !== '1') return;
    const raw = sessionStorage.getItem(GATE_BOOTSTRAP_STORAGE_KEY);
    if (!raw) {
      submitMsg =
        'No saved gate bootstrap found — use “Open Operator with settings” from Inquiry corpus suggested actions.';
      const next = new URL(window.location.href);
      next.searchParams.delete(GATE_BOOTSTRAP_QUERY_FLAG);
      void goto(`${next.pathname}${next.search}`, { replaceState: true, noScroll: true });
      return;
    }
    let data: OperatorGateBootstrapV1;
    try {
      data = JSON.parse(raw) as OperatorGateBootstrapV1;
      if (data.v !== 1 || !Array.isArray(data.urls)) return;
    } catch {
      return;
    }
    if (data.urls.length) urlsInput = data.urls.join('\n');
    validateLlm = data.validateLlm;
    jobValidationTailOnly = data.jobValidationTailOnly;
    mergeIntoRunningJob = data.mergeIntoRunningJob;
    jobForceReingest = data.jobForceReingest;
    if (data.notes?.trim()) notes = data.notes;
    if (data.sourceCatalog === 'sep' || data.sourceCatalog === 'gutenberg') sourceCatalog = data.sourceCatalog;
    sessionStorage.removeItem(GATE_BOOTSTRAP_STORAGE_KEY);
    step = 'sources';
    const next = new URL(window.location.href);
    next.searchParams.set('step', 'sources');
    next.searchParams.delete(GATE_BOOTSTRAP_QUERY_FLAG);
    void goto(`${next.pathname}${next.search}`, { replaceState: true, noScroll: true });
    submitMsg =
      'Loaded suggested job settings from the Inquiry corpus gate. Review Sources and Mode before starting.';
  }

  const urlCount = $derived(parseUrls(urlsInput).length);
  const sourcesComplete = $derived(urlCount > 0);
  const modeComplete = $derived(runMode === 'standard' || runMode === 'extract_then_promote');
  const reviewReady = $derived(sourcesComplete && modeComplete);
  const shellJourneyStage = $derived(
    step === 'configure'
      ? 'configure'
      : step === 'sources'
        ? 'sources'
        : step === 'mode' || step === 'review'
          ? 'run'
          : 'monitor'
  );

  function resetSourcesOnly(): void {
    urlsInput = '';
    // Clear helper UI feedback but keep holistic defaults.
    sepSuggestMessage = '';
    sepLastStats = '';
    presetMsg = '';
    presetBusy = false;
    trimBusy = false;
    submitMsg = '';
  }

  /** Number inputs use `bind:value` on string-initialized state → runtime value can be `number`; coerce before `.trim()`. */
  function parseOptionalInt(input: string | number | null | undefined, min: number, max: number): number | undefined {
    const t = String(input ?? '').trim();
    if (!t) return undefined;
    const n = Number(t);
    if (!Number.isFinite(n)) return undefined;
    const i = Math.trunc(n);
    if (i < min || i > max) return undefined;
    return i;
  }

  function buildWorkerDefaultsPayload():
    | { ok: true; payload?: Record<string, unknown> }
    | { ok: false; error: string } {
    const o: Record<string, unknown> = {};
    const extC = parseOptionalInt(jobExtractionConcurrency, 1, 16);
    if (extC != null) o.extractionConcurrency = extC;
    const extTok = parseOptionalInt(jobExtractionMaxTokens, 1000, 20_000);
    if (extTok != null) o.extractionMaxTokensPerSection = extTok;
    const passC = parseOptionalInt(jobPassageInsertConcurrency, 1, 12);
    if (passC != null) o.passageInsertConcurrency = passC;
    const claimC = parseOptionalInt(jobClaimInsertConcurrency, 1, 24);
    if (claimC != null) o.claimInsertConcurrency = claimC;
    const remMax = parseOptionalInt(jobRemediationMaxClaims, 1, 200);
    if (remMax != null) o.remediationMaxClaims = remMax;
    const overlap = parseOptionalInt(jobRelationsOverlap, 1, 99);
    if (overlap != null) o.relationsBatchOverlapClaims = overlap;
    const gTogether = parseOptionalInt(jobGlobalMaxConcurrentTogether, 1, 16);
    if (gTogether != null) o.globalMaxConcurrentTogether = gTogether;
    const gVoyage = parseOptionalInt(jobGlobalMaxConcurrentVoyage, 1, 16);
    if (gVoyage != null) o.globalMaxConcurrentVoyage = gVoyage;
    const relateConc = parseOptionalInt(jobRelateStoreConcurrency, 1, 32);
    if (relateConc != null) o.relateStoreConcurrency = relateConc;
    o.ingestProvider = jobIngestProvider;
    if (!jobGoogleThroughputEnabled) o.googleGenerativeThroughput = false;
    const gFloor = parseOptionalInt(jobGoogleExtractionFloor, 1, 12);
    if (gFloor != null) o.googleExtractionConcurrencyFloor = gFloor;
    if (jobValidationTailOnly) {
      o.forceStage = 'validating';
      o.forceStageMissingCheckpoint = 'resume';
    }
    if (jobForceReingest && !jobValidationTailOnly) o.forceReingest = true;
    o.failOnGroupingPositionCollapse = jobFailOnGroupingCollapse;
    o.ingestLogPins = jobIngestLogPins;
    if (validateLlm) {
      o.ingestRemediationEnabled = jobRemediationEnabled;
      o.ingestRemediationRevalidate = jobRemediationRevalidate;
      o.ingestRemediationTargetedRevalidate = jobRemediationTargetedRevalidate;
    }
    const idleRaw = String(jobWatchdogPhaseIdleJson ?? '').trim();
    if (idleRaw) {
      try {
        const parsed = JSON.parse(idleRaw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          o.watchdogPhaseIdleJson = JSON.stringify(parsed);
        }
      } catch {
        return { ok: false, error: 'Watchdog phase idle JSON is not valid JSON.' };
      }
    }
    const multRaw = String(jobWatchdogBaselineMult ?? '').trim();
    if (multRaw) {
      const m = Number(multRaw);
      if (!Number.isFinite(m) || m < 0.5 || m > 10) {
        return { ok: false, error: 'Watchdog baseline multiplier must be between 0.5 and 10.' };
      }
      o.watchdogPhaseBaselineMult = m;
    }
    return Object.keys(o).length > 0 ? { ok: true, payload: o } : { ok: true };
  }

  async function startDurableJob(): Promise<void> {
    submitMsg = '';
    const urls = parseUrls(urlsInput);
    if (urls.length === 0) {
      submitMsg = 'Add at least one valid URL (one per line).';
      return;
    }
    if (jobValidationTailOnly && !validateLlm) {
      submitMsg = 'Validation tail mode requires “Run LLM validation stage”.';
      return;
    }
    if (runMode === 'extract_then_promote' && jobValidationTailOnly) {
      submitMsg = 'Validation tail only is not compatible with extraction-only batches.';
      return;
    }
    const workerBuild = buildWorkerDefaultsPayload();
    if (!workerBuild.ok) {
      submitMsg = workerBuild.error;
      return;
    }
    const wdBase: Record<string, unknown> =
      workerBuild.payload && typeof workerBuild.payload === 'object' && !Array.isArray(workerBuild.payload)
        ? { ...(workerBuild.payload as Record<string, unknown>) }
        : {};

    if (preferTogetherForDurableJobs) {
      const model = (preferTogetherModelId ?? '').trim() || 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
      wdBase.model_chain = {
        extract: `together__${model}`,
        relate: `together__${model}`,
        group: `together__${model}`,
        validate: 'auto',
        remediate: `together__${model}`,
        json_repair: `together__${model}`
      };
    }

    if (runMode === 'extract_then_promote') {
      if (batchExtractionModelMode === 'openai_compat') {
        const u = extractionOpenAiCompatibleBaseUrl.trim();
        const m = extractionOpenAiCompatibleModel.trim();
        if (u) wdBase.extractionOpenAiCompatibleBaseUrl = u;
        if (m) wdBase.extractionOpenAiCompatibleModel = m;
      } else if (batchExtractionModelMode === 'pin_model') {
        const pin = extractionPinnedProviderModel.trim() || 'auto';
        const existing =
          wdBase.model_chain && typeof wdBase.model_chain === 'object' && !Array.isArray(wdBase.model_chain)
            ? (wdBase.model_chain as Record<string, unknown>)
            : {};
        wdBase.model_chain = { ...existing, extract: pin };
      }
    }

    if (applyOperatorPhaseModelPins) {
      const opPins = loadOperatorPhasePinsFromStorage();
      if (opPins) {
        wdBase.model_chain = operatorPhasePinsToModelChain(opPins);
        Object.assign(wdBase, operatorPhasePinsToWorkerExtras(opPins));
      }
    }
    const hasWorkerDefaults = Object.keys(wdBase).length > 0;
    submitBusy = true;
    try {
      const body = await authorizedFetchJson<Record<string, unknown>>('/api/admin/ingest/jobs', {
        method: 'POST',
        jsonBody: {
          urls,
          concurrency: Math.max(1, Math.min(MAX_DURABLE_INGEST_JOB_CONCURRENCY, Math.trunc(concurrency) || 2)),
          notes: String(notes ?? '').trim() || null,
          validate: validateLlm,
          merge_into_latest_running_job: mergeIntoRunningJob,
          stop_after_extraction: runMode === 'extract_then_promote',
          ...(hasWorkerDefaults ? { worker_defaults: wdBase } : {})
        }
      });
      const jobId = typeof body?.jobId === 'string' ? body.jobId : '';
      if (!jobId) throw new Error('Missing job id in response.');
      persistWorkspaceSettings();
      window.location.href = `/admin/ingest/operator/activity?panel=jobs&q=${encodeURIComponent(jobId)}`;
    } catch (e) {
      submitMsg = e instanceof Error ? e.message : 'Failed to start job.';
    } finally {
      submitBusy = false;
    }
  }

  async function hydrateExtractionOpenAiCompatDefaultsIfEmpty(): Promise<void> {
    if (extractionOpenAiCompatibleBaseUrl.trim() && extractionOpenAiCompatibleModel.trim()) return;
    try {
      const body = await authorizedFetchJson<Record<string, unknown>>(
        '/api/admin/ingest/extraction-openai-compat-defaults'
      );
      if (body.ok !== true) return;
      const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl : '';
      const model = typeof body.model === 'string' ? body.model : '';
      if (!extractionOpenAiCompatibleBaseUrl.trim() && baseUrl.trim()) {
        extractionOpenAiCompatibleBaseUrl = baseUrl.trim();
      }
      if (!extractionOpenAiCompatibleModel.trim() && model.trim()) {
        extractionOpenAiCompatibleModel = model.trim();
      }
    } catch {
      // ignore
    }
  }

  // Mission Control data
  type JobRow = { id: string; status: string; summary?: Record<string, number>; updatedAt?: string };
  type NeonPromote = { id: string; sourceUrl: string; updatedAt: string };
  let missionBusy = $state(false);
  let missionErr = $state('');
  let jobs = $state<JobRow[]>([]);
  let awaitingNeon = $state<NeonPromote[]>([]);

  async function loadMission(): Promise<void> {
    missionBusy = true;
    missionErr = '';
    try {
      const [jb, rb] = await Promise.all([
        authorizedFetchJson<Record<string, unknown>>('/api/admin/ingest/jobs?limit=20'),
        authorizedFetchJson<Record<string, unknown>>('/api/admin/ingest/runs')
      ]);
      jobs = Array.isArray(jb?.jobs) ? (jb.jobs as JobRow[]) : [];
      awaitingNeon = Array.isArray(rb?.awaitingPromoteNeon) ? (rb.awaitingPromoteNeon as NeonPromote[]) : [];
    } catch (e) {
      missionErr = e instanceof Error ? e.message : String(e);
      jobs = [];
      awaitingNeon = [];
    } finally {
      missionBusy = false;
    }
  }

  // DLQ (consolidated)
  type DlqRow = {
    itemId: string;
    jobId: string;
    url: string;
    lastError: string | null;
    failureClass: string | null;
    dlqEnqueuedAt: string | null;
    attempts: number;
    dlqReplayCount: number;
  };
  let dlqItems = $state<DlqRow[]>([]);
  let dlqBusy = $state(false);
  let dlqMsg = $state('');
  // DLQ triage is canonical in Monitoring.

  async function loadDlq(): Promise<void> {
    dlqBusy = true;
    dlqMsg = '';
    try {
      const body = await authorizedFetchJson<Record<string, unknown>>('/api/admin/ingest/jobs/dlq?limit=60');
      dlqItems = Array.isArray(body?.items) ? (body.items as DlqRow[]) : [];
    } catch (e) {
      dlqMsg = e instanceof Error ? e.message : 'DLQ load failed';
      dlqItems = [];
    } finally {
      dlqBusy = false;
    }
  }

  // Continue from Neon (promote)
  let promoteBusy = $state<Record<string, boolean>>({});
  let promoteMsg = $state('');
  let runConsoleRunId = $state('');

  async function promoteRun(runId: string): Promise<void> {
    promoteMsg = '';
    promoteBusy = { ...promoteBusy, [runId]: true };
    try {
      await authorizedFetchJson(`/api/admin/ingest/run/${encodeURIComponent(runId)}/promote`, {
        method: 'POST',
        jsonBody: { stop_before_store: true }
      });
      await loadMission();
      promoteMsg = 'Promoted. Monitor in Activity or Run console.';
    } catch (e) {
      promoteMsg = e instanceof Error ? e.message : 'Promote failed';
    } finally {
      promoteBusy = { ...promoteBusy, [runId]: false };
    }
  }

  function openRunConsoleById(raw: string): void {
    const id = raw.trim();
    if (!id) return;
    window.location.href = `/admin/ingest/operator/run-console/${encodeURIComponent(id)}`;
  }

  // Build batch helpers (thin; advanced features still live on Durable Jobs)
  let cohortDays = $state(90);
  let presetBusy = $state(false);
  let presetMsg = $state('');

  // SEP catalog helper (ported from Durable Jobs)
  let sepPresetId = $state('');
  let sepCustomKeywords = $state('');
  let sepBatchCount = $state(10);
  let sepExcludeIngested = $state(true);
  let sepPresets = $state<{ id: string; label: string }[]>([]);
  let sepSuggestLoading = $state(false);
  let sepSuggestMessage = $state('');
  let sepLastStats = $state('');

  // Trim pasted URLs (ported from Durable Jobs)
  let trimStripTraining = $state(true);
  let trimStripGolden = $state(true);
  let trimStripDlq = $state(true);
  let trimBusy = $state(false);

  async function fillUrlsFromPreset(preset: 'golden' | 'training_acceptable'): Promise<void> {
    presetMsg = '';
    presetBusy = true;
    try {
      const params = new URLSearchParams();
      params.set('preset', preset);
      if (preset === 'training_acceptable') params.set('days', String(Math.trunc(Number(cohortDays)) || 90));
      const body = await authorizedFetchJson<Record<string, unknown>>(
        `/api/admin/ingest/jobs/url-presets?${params.toString()}`
      );
      const rawUrls = Array.isArray(body?.urls) ? body.urls : [];
      const lines = rawUrls
        .map((row: { url?: string }) => (typeof row?.url === 'string' ? row.url.trim() : ''))
        .filter(Boolean);
      urlsInput = lines.join('\n');
      presetMsg = `Loaded ${lines.length} URL(s).`;
    } catch (e) {
      presetMsg = e instanceof Error ? e.message : 'Preset failed';
    } finally {
      presetBusy = false;
    }
  }

  async function fillPhase1ValidationTailPresets(): Promise<void> {
    presetMsg = '';
    presetBusy = true;
    validateLlm = true;
    jobValidationTailOnly = true;
    try {
      const d = Math.min(730, Math.max(1, Math.trunc(Number(cohortDays)) || 90));
      const [goldenBody, trainBody] = await Promise.all([
        authorizedFetchJson<Record<string, unknown>>(
          `/api/admin/ingest/jobs/url-presets?preset=golden&omit_validated=1&days=${encodeURIComponent(String(d))}`
        ),
        authorizedFetchJson<Record<string, unknown>>(
          `/api/admin/ingest/jobs/url-presets?preset=training_acceptable&days=${encodeURIComponent(String(d))}&validate=1&omit_validated=1`
        )
      ]);
      const goldenRows = Array.isArray(goldenBody?.urls) ? (goldenBody.urls as { url?: string }[]) : [];
      const trainRows = Array.isArray(trainBody?.urls) ? (trainBody.urls as { url?: string }[]) : [];
      const byKey = new Map<string, string>();
      for (const row of goldenRows) {
        const u = typeof row?.url === 'string' ? row.url.trim() : '';
        if (!u) continue;
        byKey.set(u.toLowerCase(), u);
      }
      for (const row of trainRows) {
        const u = typeof row?.url === 'string' ? row.url.trim() : '';
        if (!u) continue;
        const k = u.toLowerCase();
        if (!byKey.has(k)) byKey.set(k, u);
      }
      const lines = [...byKey.values()];
      if (lines.length === 0) {
        presetMsg = 'No URLs returned from golden or training presets.';
        return;
      }
      urlsInput = lines.join('\n');
      presetMsg = `Loaded ${lines.length} URL(s) from golden + training (validate=true), omit validated.`;
    } catch (e) {
      presetMsg = e instanceof Error ? e.message : 'Preset bundle failed.';
    } finally {
      presetBusy = false;
    }
  }

  async function loadSepPresets(): Promise<void> {
    try {
      const body = await authorizedFetchJson<Record<string, unknown>>('/api/admin/ingest/sep-suggest?presetsOnly=1');
      if (Array.isArray(body?.presets)) {
        sepPresets = body.presets as { id: string; label: string }[];
      }
    } catch {
      sepPresets = [];
    }
  }

  async function fillUrlsFromSepCatalog(): Promise<void> {
    sepSuggestMessage = '';
    sepLastStats = '';
    if (!sepPresetId.trim() && !sepCustomKeywords.trim()) {
      sepSuggestMessage = 'Choose a topic preset and/or enter custom keywords (entry slug fragments).';
      return;
    }
    sepSuggestLoading = true;
    try {
      const params = new URLSearchParams();
      if (sepPresetId.trim()) params.set('preset', sepPresetId.trim());
      if (sepCustomKeywords.trim()) params.set('keywords', sepCustomKeywords.trim());
      const n = Math.max(1, Math.min(200, Math.trunc(sepBatchCount) || 10));
      params.set('limit', String(n));
      params.set('excludeIngested', sepExcludeIngested ? '1' : '0');
      const body = await authorizedFetchJson<Record<string, unknown>>(`/api/admin/ingest/sep-suggest?${params.toString()}`);
      const urls = Array.isArray(body?.urls) ? (body.urls as string[]) : [];
      const stats = body?.stats as
        | { catalogSize?: number; matchedBeforeExclude?: number; excludedIngested?: number; returned?: number }
        | undefined;
      urlsInput = urls.join('\n');
      sepLastStats = stats
        ? `Catalog ${stats.catalogSize ?? '—'} · matched ${stats.matchedBeforeExclude ?? '—'} · skipped ingested ${stats.excludedIngested ?? 0} · filled ${stats.returned ?? urls.length}`
        : '';
      sepSuggestMessage =
        urls.length === 0 ? 'No URLs matched. Try different keywords or disable exclude.' : `Placed ${urls.length} URL(s) in the list below.`;
    } catch (e) {
      sepSuggestMessage = e instanceof Error ? e.message : 'Failed to suggest URLs.';
    } finally {
      sepSuggestLoading = false;
    }
  }

  async function fillUrlsFromGutenbergPhilosophy(): Promise<void> {
    gutenbergSuggestMsg = '';
    gutenbergSuggestBusy = true;
    try {
      const params = new URLSearchParams();
      const n = Math.max(1, Math.min(200, Math.trunc(Number(gutenbergSuggestLimit)) || 10));
      params.set('limit', String(n));
      params.set('excludeIngested', gutenbergExcludeIngested ? '1' : '0');
      params.set('domain', gutenbergDomain);
      const body = await authorizedFetchJson<Record<string, unknown>>(`/api/admin/ingest/gutenberg-suggest?${params.toString()}`);
      const urls = Array.isArray(body?.urls) ? (body.urls as string[]) : [];
      urlsInput = urls.join('\n');
      const stats = body?.stats as {
        domain?: string;
        fetchedBooks?: number;
        keptPhilosophy?: number;
        excludedIngested?: number;
        returned?: number;
      } | undefined;
      const domainLabel = GUTENBERG_PHILOSOPHY_DOMAINS.find((d) => d.id === stats?.domain)?.label ?? gutenbergDomain;
      gutenbergSuggestMsg = urls.length === 0
        ? `No Gutenberg books matched domain “${domainLabel}”. Try another domain or disable exclude.`
        : `Placed ${urls.length} URL(s) · ${domainLabel}. Fetched ${stats?.fetchedBooks ?? '—'} · kept after filter ${stats?.keptPhilosophy ?? '—'} · skipped ingested ${stats?.excludedIngested ?? 0}.`;
    } catch (e) {
      gutenbergSuggestMsg = e instanceof Error ? e.message : 'Failed to suggest Gutenberg URLs.';
    } finally {
      gutenbergSuggestBusy = false;
    }
  }

  function applyDefaultsForCatalog(next: SourceCatalogId): void {
    // Catalog-specific defaults: Gutenberg → Together-first; SEP → Vertex-first (auto).
    if (next === 'gutenberg') {
      preferTogetherForDurableJobs = true;
      jobGoogleThroughputEnabled = false;
      jobIngestProvider = 'auto';
      jobGlobalMaxConcurrentTogether = 2;
      jobGlobalMaxConcurrentVoyage = 1;
      jobRelateStoreConcurrency = 4;
    } else {
      preferTogetherForDurableJobs = false;
      jobGoogleThroughputEnabled = true;
      jobIngestProvider = 'auto';
      jobGlobalMaxConcurrentTogether = 1;
      jobGlobalMaxConcurrentVoyage = 1;
      jobRelateStoreConcurrency = 4;
    }
  }

  async function trimPastedUrlList(): Promise<void> {
    presetMsg = '';
    trimBusy = true;
    try {
      const lines = urlsInput.split('\n').map((s) => s.trim()).filter(Boolean);
      if (lines.length === 0) {
        presetMsg = 'Paste URLs in the textarea first.';
        return;
      }
      const d = Math.min(730, Math.max(1, Math.trunc(Number(cohortDays)) || 90));
      const body = await authorizedFetchJson<Record<string, unknown>>('/api/admin/ingest/jobs/url-list-trim', {
        method: 'POST',
        jsonBody: {
          urls: lines,
          days: d,
          stripTrainingAcceptable: trimStripTraining,
          stripGoldenValidationDone: trimStripGolden,
          stripDlqPermanent: trimStripDlq
        }
      });
      const kept = Array.isArray(body?.kept) ? (body.kept as string[]) : [];
      urlsInput = kept.join('\n');
      const rc = body?.removedCounts as
        | { trainingAcceptable?: number; goldenValidationDone?: number; dlqPermanent?: number }
        | undefined;
      presetMsg = `Trim: kept ${body?.keptCount ?? kept.length} of ${lines.length} unique line(s). Removed — training-ready: ${rc?.trainingAcceptable ?? 0}, golden+validated (${d}d): ${rc?.goldenValidationDone ?? 0}, permanent job failures: ${rc?.dlqPermanent ?? 0}.`;
    } catch (e) {
      presetMsg = e instanceof Error ? e.message : 'Trim failed.';
    } finally {
      trimBusy = false;
    }
  }

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  onMount(() => {
    hydrateStepFromUrl();
    hydrateWorkspaceSettings();
    prefillUrlFromQueryParam();
    hydrateCatalogFromQuery();
    hydrateGateBootstrapFromSession();
    void loadMission();
    void loadSepPresets();
    // Lightweight polling only while Mission Control is visible.
    pollTimer = setInterval(() => {
      void loadMission();
    }, 12000);
  });

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
  });

  $effect(() => {
    void (
      concurrency +
      notes +
      validateLlm +
      mergeIntoRunningJob +
      jobValidationTailOnly +
      runMode +
      Number(gutenbergSuggestLimit) +
      (gutenbergExcludeIngested ? 1 : 0) +
      gutenbergDomain.length
    );
    persistWorkspaceSettings();
  });

  $effect(() => {
    void sourceCatalog;
    applyDefaultsForCatalog(sourceCatalog);
  });
</script>

<svelte:head>
  <title>Operator — Ingestion</title>
</svelte:head>

<IngestionSettingsShell
  kicker="Admin"
  activeNav="home"
  journeyStage={shellJourneyStage}
  title="Ingestion workspace"
  lead="One place to configure, launch, continue, and troubleshoot ingestion. This workspace keeps the common ingestion workflow connected."
>

  <div class="op-wizard">
    <aside class="op-steps" aria-label="Wizard steps">
      <button type="button" class="op-step" class:active={step === 'configure'} onclick={() => setStep('configure')}>
        <span class="op-step-n">{step === 'configure' ? '1' : '✓'}</span> Configure
      </button>
      <button type="button" class="op-step" class:active={step === 'sources'} onclick={() => setStep('sources')}>
        <span class="op-step-n">{sourcesComplete ? '✓' : '2'}</span> Select sources
      </button>
      <button type="button" class="op-step" class:active={step === 'mode'} onclick={() => setStep('mode')}>
        <span class="op-step-n">{sourcesComplete && modeComplete ? '✓' : '3'}</span> Choose run mode
      </button>
      <button
        type="button"
        class="op-step"
        class:active={step === 'review'}
        disabled={!sourcesComplete}
        onclick={() => setStep('review')}
        title={!sourcesComplete ? 'Add URLs first' : ''}
      >
        <span class="op-step-n">{reviewReady ? '✓' : '4'}</span> Review & start
      </button>
      <button type="button" class="op-step" class:active={step === 'monitor'} onclick={() => setStep('monitor')}>
        <span class="op-step-n">5</span> Monitor & triage
      </button>
      <button
        type="button"
        class="op-step op-step-reset"
        disabled={!sourcesComplete}
        onclick={resetSourcesOnly}
        title={!sourcesComplete ? 'No URLs to clear' : 'Clear URL list (keep defaults)'}
      >
        <span class="op-step-n">↺</span> Start another run
      </button>
      <div class="op-step-help">
        <p class="op-muted">
          This wizard guides the common path. Advanced tooling remains available via the workspace nav.
        </p>
      </div>
    </aside>

    <div class="op-work">
      {#if step === 'configure'}
        <section class="op-panel">
          <h2 class="op-h2">Configure</h2>
          <p class="op-muted">Set browser defaults for this workspace, plus environment-wide Routing and Operator BYOK.</p>

          <div class="op-tabbar" role="tablist" aria-label="Configure tabs">
            <button
              type="button"
              role="tab"
              class="op-tab"
              class:active={configureTab === 'defaults'}
              aria-selected={configureTab === 'defaults'}
              onclick={() => (configureTab = 'defaults')}
            >
              Defaults (browser)
            </button>
            <button
              type="button"
              role="tab"
              class="op-tab"
              class:active={configureTab === 'routing'}
              aria-selected={configureTab === 'routing'}
              onclick={() => (configureTab = 'routing')}
            >
              Routing (env)
            </button>
            <button
              type="button"
              role="tab"
              class="op-tab"
              class:active={configureTab === 'byok'}
              aria-selected={configureTab === 'byok'}
              onclick={() => (configureTab = 'byok')}
            >
              Operator BYOK (env)
            </button>
          </div>

          {#if configureTab === 'defaults'}
            <div class="op-row" style="margin-top: 12px;">
              <label class="op-label">
                Default concurrency
                <input
                  class="op-input"
                  type="number"
                  min="1"
                  max={MAX_DURABLE_INGEST_JOB_CONCURRENCY}
                  bind:value={concurrency}
                />
              </label>
              <label class="op-label grow">
                Default notes (optional)
                <input class="op-input" type="text" bind:value={notes} placeholder="e.g. SEP April batch" />
              </label>
            </div>
            <label class="op-check">
              <input type="checkbox" bind:checked={validateLlm} />
              Default: run LLM validation stage
            </label>
            <details class="op-details">
              <summary class="op-details-sum">Optional defaults</summary>
              <div class="op-details-body">
                <label class="op-check">
                  <input type="checkbox" bind:checked={mergeIntoRunningJob} />
                  Default: append new URLs to latest running job
                </label>
                <label class="op-check">
                  <input type="checkbox" bind:checked={jobValidationTailOnly} disabled={runMode === 'extract_then_promote'} />
                  Default: validation tail only (requires validation)
                </label>
              </div>
            </details>
          {:else if configureTab === 'routing'}
            <div style="margin-top: 12px;">
              <RoutingConfigPanel compactHeader={true} />
            </div>
          {:else if configureTab === 'byok'}
            <div style="margin-top: 12px;">
              <OperatorByokPanel compactHeader={true} />
            </div>
          {/if}
          <div class="op-actions">
            <button type="button" class="op-btn op-btn-primary" onclick={() => setStep('sources')}>
              Next: select sources
            </button>
          </div>
        </section>
      {:else if step === 'sources'}
        <section class="op-panel">
          <h2 class="op-h2">Select sources</h2>
          <p class="op-muted">Build your URL list first. Once you have URLs, we’ll choose a run mode and start.</p>

          <div class="op-cardbox" style="margin-bottom: 12px;">
            <p class="op-muted" style="margin:0 0 10px;"><strong>Source catalog</strong></p>
            <div class="op-cardbox" style="margin:0;">
              <label class="op-check">
                <input type="radio" name="sourceCatalog" value="sep" checked={sourceCatalog === 'sep'} onchange={() => (sourceCatalog = 'sep')} />
                <strong>SEP entries</strong> (Stanford Encyclopedia)
              </label>
              <label class="op-check">
                <input
                  type="radio"
                  name="sourceCatalog"
                  value="gutenberg"
                  checked={sourceCatalog === 'gutenberg'}
                  onchange={() => (sourceCatalog = 'gutenberg')}
                />
                <strong>Gutenberg</strong> (public-domain books)
              </label>
              <p class="op-muted" style="margin:8px 0 0;">
                Suggestions and presets below are scoped to the chosen catalog.
              </p>
            </div>
          </div>

          {#if sourceCatalog === 'sep'}
            <JobsBatchBuilderTab
              neonDisabled={false}
              bind:urlsInput
              bind:sepPresetId
              bind:sepCustomKeywords
              bind:sepBatchCount
              bind:sepExcludeIngested
              {sepPresets}
              {sepSuggestLoading}
              {sepSuggestMessage}
              {sepLastStats}
              bind:cohortDays
              presetMessage={presetMsg}
              {presetBusy}
              bind:trimStripTraining
              bind:trimStripGolden
              bind:trimStripDlq
              {trimBusy}
              onFillFromSep={() => void fillUrlsFromSepCatalog()}
              onPresetGolden={() => void fillUrlsFromPreset('golden')}
              onPresetTraining={() => void fillUrlsFromPreset('training_acceptable')}
              onPresetPhase1Bundle={() => void fillPhase1ValidationTailPresets()}
              onTrimUrls={() => void trimPastedUrlList()}
              onUseInStartJob={() => setStep('mode')}
            />
          {:else}
            <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <h2 class="font-serif text-lg text-sophia-dark-text">Gutenberg helper</h2>
              <p class="mt-2 text-sm text-sophia-dark-muted">
                Enter Gutenberg ebook IDs (one per line). We’ll convert them to canonical <span class="font-mono text-xs">/ebooks/&lt;id&gt;</span> URLs.
              </p>
              <div class="mt-3 op-cardbox" style="margin-bottom: 10px;">
                <p class="op-muted" style="margin:0 0 10px;">
                  <strong>Philosophy-only retrieval</strong>
                </p>
                <div class="op-row" style="margin-top: 0; flex-wrap: wrap;">
                  <label class="op-label">
                    Philosophical domain
                    <select class="op-select" bind:value={gutenbergDomain} title="Gutendex search + metadata filter for this area">
                      {#each GUTENBERG_PHILOSOPHY_DOMAINS as d (d.id)}
                        <option value={d.id} title={d.description}>{d.label}</option>
                      {/each}
                    </select>
                  </label>
                  <label class="op-label">
                    Suggest count
                    <input class="op-input" type="number" min="1" max="200" bind:value={gutenbergSuggestLimit} />
                  </label>
                  <label class="op-check" style="align-self: flex-end; margin-bottom: 6px;">
                    <input type="checkbox" bind:checked={gutenbergExcludeIngested} />
                    Exclude already ingested
                  </label>
                  <button
                    type="button"
                    class="op-btn op-btn-primary"
                    disabled={gutenbergSuggestBusy}
                    onclick={() => void fillUrlsFromGutenbergPhilosophy()}
                    title="Fetch English Gutenberg candidates from Gutendex for the selected domain, then fill the URL list"
                  >
                    {gutenbergSuggestBusy ? 'Retrieving…' : 'Retrieve Gutenberg sources'}
                  </button>
                </div>
                {#if gutenbergSuggestMsg}
                  <p class="op-muted" style="margin:8px 0 0;">{gutenbergSuggestMsg}</p>
                {/if}
              </div>
              <div class="mt-4 flex flex-wrap items-end gap-3">
                <label class="block min-w-[240px] flex-1">
                  <span class="font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-dim">Gutenberg IDs</span>
                  <textarea
                    class="mt-2 min-h-[120px] w-full rounded-lg border border-[var(--color-border)] bg-black/20 px-3 py-2 font-mono text-sm text-sophia-dark-text focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-blue)]"
                    bind:value={gutenbergIdsInput}
                    rows="5"
                  ></textarea>
                </label>
                <div class="flex flex-wrap gap-3">
                  <button type="button" class="op-btn op-btn-primary" onclick={fillUrlsFromGutenbergIds}>Fill URL list</button>
                  <button type="button" class="op-btn" onclick={applyStoicismGutenbergPack} title="Marcus Aurelius + Seneca (starter pack)">
                    Stoicism pack
                  </button>
                </div>
              </div>
              <label class="mt-4 block">
                <span class="font-mono text-xs uppercase tracking-[0.1em] text-sophia-dark-dim">URL list (shared)</span>
                <textarea class="op-textarea" rows="10" bind:value={urlsInput}></textarea>
              </label>
            </section>
          {/if}

          <div class="op-actions">
            <button type="button" class="op-btn" onclick={() => setStep('configure')}>Back</button>
            <button type="button" class="op-btn" disabled={!sourcesComplete} onclick={resetSourcesOnly}>Clear URLs</button>
            <button type="button" class="op-btn op-btn-primary" disabled={!sourcesComplete} onclick={() => setStep('mode')}>
              Next: choose run mode
            </button>
          </div>
        </section>
      {:else if step === 'mode'}
        <section class="op-panel">
          <h2 class="op-h2">Choose run mode</h2>
          <p class="op-muted">
            Batch extraction is an option for any set of sources. Choose how this run should execute.
          </p>
          <div class="op-cardbox">
            <label class="op-check">
              <input type="radio" name="runMode" value="standard" checked={runMode === 'standard'} onchange={() => (runMode = 'standard')} />
              <strong>Standard ingest</strong> (full pipeline)
            </label>
            <label class="op-check">
              <input type="radio" name="runMode" value="extract_then_promote" checked={runMode === 'extract_then_promote'} onchange={() => (runMode = 'extract_then_promote')} />
              <strong>Batch extraction</strong> (stop after extraction, then promote)
            </label>
            {#if runMode === 'extract_then_promote'}
              <p class="op-muted" style="margin-top: 8px;">
                This creates durable job items with extraction-only runs. When done, use the wizard’s “Monitor & triage” step or the Continue/promote page to promote each URL.
              </p>
            {/if}
          </div>

          <div class="op-cardbox" style="margin-top: 12px;">
            <h3 class="op-h3">Validation & remediation (this run)</h3>
            <label class="op-check">
              <input type="checkbox" bind:checked={validateLlm} />
              <strong>Run LLM validation stage</strong>
            </label>
            <p class="op-muted" style="margin: 6px 0 0;">
              When enabled, the pipeline can remediate low-confidence claims and optionally revalidate after repair.
            </p>
            {#if validateLlm}
              <div class="op-cardbox" style="margin-top: 10px;">
                <label class="op-check">
                  <input type="checkbox" bind:checked={jobRemediationEnabled} />
                  <strong>Enable remediation</strong>
                </label>
                <p class="op-muted" style="margin: 6px 0 0;">
                  Remediation runs repair passes for flagged areas. Keep it on for operator runs unless you’re doing a quick smoke test.
                </p>
                <div class="op-cardbox" style="margin-top: 10px;">
                  <p class="op-muted" style="margin:0 0 6px;"><strong>Revalidate after remediation</strong></p>
                  <label class="op-check">
                    <input
                      type="radio"
                      name="remediationRevalidateMode"
                      checked={jobRemediationRevalidate === false && jobRemediationTargetedRevalidate === true}
                      onchange={() => {
                        jobRemediationRevalidate = false;
                        jobRemediationTargetedRevalidate = true;
                      }}
                    />
                    <strong>Targeted</strong> (only repaired areas)
                  </label>
                  <label class="op-check">
                    <input
                      type="radio"
                      name="remediationRevalidateMode"
                      checked={jobRemediationRevalidate === true}
                      onchange={() => {
                        jobRemediationRevalidate = true;
                        jobRemediationTargetedRevalidate = true;
                      }}
                    />
                    <strong>Full revalidation</strong> (expensive)
                  </label>
                  <label class="op-check">
                    <input
                      type="radio"
                      name="remediationRevalidateMode"
                      checked={jobRemediationRevalidate === false && jobRemediationTargetedRevalidate === false}
                      onchange={() => {
                        jobRemediationRevalidate = false;
                        jobRemediationTargetedRevalidate = false;
                      }}
                    />
                    <strong>Off</strong>
                  </label>
                </div>
              </div>
            {/if}
          </div>

          {#if runMode === 'extract_then_promote'}
            <details class="op-details">
              <summary class="op-details-sum">Extraction model (batch extraction)</summary>
              <div class="op-details-body">
                <label class="op-check">
                  <input
                    type="radio"
                    name="batchExtractionModelMode"
                    value="default"
                    checked={batchExtractionModelMode === 'default'}
                    onchange={() => (batchExtractionModelMode = 'default')}
                  />
                  <strong>Default routing</strong> (use current Routing / Restormel bindings)
                </label>
                <label class="op-check">
                  <input
                    type="radio"
                    name="batchExtractionModelMode"
                    value="openai_compat"
                    checked={batchExtractionModelMode === 'openai_compat'}
                    onchange={() => {
                      batchExtractionModelMode = 'openai_compat';
                      void hydrateExtractionOpenAiCompatDefaultsIfEmpty();
                    }}
                  />
                  <strong>OpenAI-compatible extraction override</strong> (fine-tune / custom deployment)
                </label>
                {#if batchExtractionModelMode === 'openai_compat'}
                  <div class="op-row" style="margin-top: 10px;">
                    <label class="op-label grow">
                      Extraction base URL
                      <input class="op-input" type="text" bind:value={extractionOpenAiCompatibleBaseUrl} placeholder="https://…/v1" />
                    </label>
                    <label class="op-label">
                      Model
                      <input class="op-input" type="text" bind:value={extractionOpenAiCompatibleModel} placeholder="ft:gpt-4.1-mini:…" />
                    </label>
                  </div>
                  <p class="op-muted" style="margin-top: 6px;">
                    This only overrides <code class="op-code">extraction</code> for the job’s child runs.
                  </p>
                {/if}
                <label class="op-check">
                  <input
                    type="radio"
                    name="batchExtractionModelMode"
                    value="pin_model"
                    checked={batchExtractionModelMode === 'pin_model'}
                    onchange={() => (batchExtractionModelMode = 'pin_model')}
                  />
                  <strong>Pin extraction phase model</strong> (e.g. <code class="op-code">vertex__gemini-2.5-pro</code>)
                </label>
                {#if batchExtractionModelMode === 'pin_model'}
                  <label class="op-label" style="margin-top: 10px;">
                    Extraction pin
                    <input class="op-input" type="text" bind:value={extractionPinnedProviderModel} placeholder="auto | vertex__… | together__…" />
                  </label>
                {/if}
              </div>
            </details>
          {/if}

          <details class="op-details">
            <summary class="op-details-sum">Advanced defaults (durable worker)</summary>
            <div class="op-details-body">
              <JobsAdvancedTab
                neonDisabled={false}
                bind:validateLlm
                bind:workerTuningOpen
                bind:jobForceReingest
                bind:jobValidationTailOnly
                bind:jobExtractionConcurrency
                bind:jobExtractionMaxTokens
                bind:jobPassageInsertConcurrency
                bind:jobClaimInsertConcurrency
                bind:jobRemediationMaxClaims
                bind:jobRelationsOverlap
                bind:jobIngestProvider
                bind:jobGoogleThroughputEnabled
                bind:jobGoogleExtractionFloor
                bind:jobFailOnGroupingCollapse
                bind:jobIngestLogPins
                bind:jobRemediationEnabled
                bind:jobRemediationRevalidate
                bind:jobRemediationTargetedRevalidate
                bind:jobWatchdogPhaseIdleJson
                bind:jobWatchdogBaselineMult
                bind:preferTogetherForDurableJobs
                bind:preferTogetherModelId
                bind:applyOperatorPhaseModelPins
              />
            </div>
          </details>
          <div class="op-actions">
            <button type="button" class="op-btn" onclick={() => setStep('sources')}>Back</button>
            <button type="button" class="op-btn op-btn-primary" onclick={() => setStep('review')}>Next: review & start</button>
          </div>
        </section>
      {:else if step === 'review'}
        <section class="op-panel">
          <h2 class="op-h2">Review & start</h2>
          <p class="op-muted">Confirm configuration and start the run.</p>
          <div class="op-kpis">
            <div class="op-kpi"><p class="op-kpi-k">URLs</p><p class="op-kpi-v">{urlCount}</p></div>
            <div class="op-kpi"><p class="op-kpi-k">Mode</p><p class="op-kpi-v" style="font-size:1rem;">{runMode === 'standard' ? 'Standard' : 'Extract→Promote'}</p></div>
            <div class="op-kpi"><p class="op-kpi-k">Concurrency</p><p class="op-kpi-v">{concurrency}</p></div>
          </div>
          <ul class="op-muted" style="margin-top: 12px;">
            <li>Validation: <code class="op-code">{validateLlm ? 'on' : 'off'}</code></li>
            <li>Append to running job: <code class="op-code">{mergeIntoRunningJob ? 'on' : 'off'}</code></li>
            {#if validateLlm}
              <li>Remediation: <code class="op-code">{jobRemediationEnabled ? 'on' : 'off'}</code></li>
              <li>
                Revalidate:{' '}
                <code class="op-code">
                  {jobRemediationRevalidate ? 'full' : jobRemediationTargetedRevalidate ? 'targeted' : 'off'}
                </code>
              </li>
            {/if}
          </ul>
          {#if submitMsg}
            <p class="op-msg" role="status">{submitMsg}</p>
          {/if}
          <div class="op-actions">
            <button type="button" class="op-btn" onclick={() => setStep('mode')}>Back</button>
            <button type="button" class="op-btn" disabled={!sourcesComplete} onclick={resetSourcesOnly}>Start another run</button>
            <button type="button" class="op-btn op-btn-primary" disabled={submitBusy || urlCount === 0} onclick={() => void startDurableJob()}>
              {submitBusy ? 'Starting…' : 'Start job'}
            </button>
            <button type="button" class="op-btn op-btn-link" onclick={() => setStep('mode')}>Advanced defaults</button>
          </div>
        </section>
      {:else}
        <section class="op-panel">
          <div class="op-panel-head">
            <h2 class="op-h2">Monitor & triage</h2>
            <button type="button" class="op-btn" disabled={missionBusy} onclick={() => void loadMission()}>
              {missionBusy ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          <p class="op-muted">
            Watch progress in Activity, promote extraction-only runs when ready, and replay failures via DLQ.
          </p>
          <div class="op-actions">
            <a class="op-btn op-btn-link" href="/admin/ingest/operator/activity">Open Monitoring</a>
            <a class="op-btn op-btn-link" href="/admin/ingest/operator/triage?panel=dlq">Open DLQ</a>
            <a class="op-btn op-btn-link" href="/admin/ingest/operator/triage?panel=promote">Open promote queue</a>
            <button type="button" class="op-btn" onclick={() => setStep('continue')}>Go to promote</button>
          </div>

          <div class="op-cardbox" style="margin-top: 12px;">
            <h3 class="op-h3">Run console</h3>
            <p class="op-muted" style="margin: 0 0 10px;">
              Jump directly to the operational run console to view pipeline activity, errors, and export JSON.
            </p>
            <div class="op-actions" style="margin-top: 0;">
              <input
                class="op-select"
                placeholder="Paste run id…"
                bind:value={runConsoleRunId}
                onkeydown={(e) => {
                  if (e.key === 'Enter') openRunConsoleById(runConsoleRunId);
                }}
              />
              <button type="button" class="op-btn op-btn-primary" disabled={!runConsoleRunId.trim()} onclick={() => openRunConsoleById(runConsoleRunId)}>
                Open run console
              </button>
            </div>
            {#if awaitingNeon.length > 0}
              <div class="op-actions" style="margin-top: 8px;">
                <span class="op-muted"><strong>Quick picks</strong></span>
                {#each awaitingNeon.slice(0, 4) as r (r.id)}
                  <button type="button" class="op-btn op-btn-link" onclick={() => openRunConsoleById(r.id)}>
                    {r.id.slice(0, 10)}…
                  </button>
                {/each}
              </div>
            {/if}
          </div>
          <div class="op-split">
            <div class="op-cardbox">
              <h3 class="op-h3">Awaiting promote (Neon)</h3>
              {#if awaitingNeon.length === 0}
                <p class="op-muted">None.</p>
              {:else}
                <ul class="op-list">
                  {#each awaitingNeon.slice(0, 10) as r (r.id)}
                    <li class="op-li">
                      <button type="button" class="op-li-link" onclick={() => (window.location.href = `/admin/ingest/operator/triage?panel=promote&q=${encodeURIComponent(r.id)}`)}>
                        {r.id.slice(0, 10)}…
                      </button>
                      <span class="op-li-url">{r.sourceUrl}</span>
                      <button type="button" class="op-mini" onclick={() => openRunConsoleById(r.id)} title="Open run console">
                        Console
                      </button>
                      <button type="button" class="op-mini" disabled={promoteBusy[r.id]} onclick={() => void promoteRun(r.id)}>
                        {promoteBusy[r.id] ? '…' : 'Promote'}
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
            <div class="op-cardbox">
              <h3 class="op-h3">DLQ</h3>
              <p class="op-muted" style="margin: 0 0 10px;">
                <strong class="op-mono">{dlqItems.length}</strong> item(s) currently in DLQ.
              </p>
              <div class="op-actions">
                <a class="op-btn op-btn-link" href="/admin/ingest/operator/triage?panel=dlq">Open DLQ</a>
              </div>
              {#if dlqMsg}
                <p class="op-msg" role="status">{dlqMsg}</p>
              {/if}
            </div>
          </div>
        </section>
      {/if}
    </div>
  </div>
</IngestionSettingsShell>

<style>
  .op-wizard {
    display: grid;
    grid-template-columns: 1fr;
    gap: 14px;
    margin-top: 18px;
  }
  @media (min-width: 980px) {
    .op-wizard {
      grid-template-columns: 260px 1fr;
      align-items: start;
    }
  }
  .op-steps {
    position: sticky;
    top: calc(var(--nav-height) + 12px);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    background: color-mix(in srgb, var(--color-surface) 92%, black 8%);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: calc(100vh - var(--nav-height) - 40px);
    overflow: auto;
  }
  .op-step {
    display: flex;
    align-items: center;
    gap: 10px;
    border-radius: 10px;
    border: 1px solid transparent;
    background: transparent;
    padding: 10px 10px;
    font-size: 0.86rem;
    cursor: pointer;
    color: var(--color-text);
    text-align: left;
  }
  .op-step:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--color-sage) 35%, var(--color-border));
  }
  .op-step.active {
    border-color: color-mix(in srgb, var(--color-sage) 45%, var(--color-border));
    background: color-mix(in srgb, var(--color-sage) 12%, transparent);
    font-weight: 600;
  }
  .op-step:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .op-step-n {
    width: 22px;
    height: 22px;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.75rem;
    opacity: 0.9;
  }
  .op-step-reset {
    margin-top: 6px;
  }
  .op-step-help {
    margin-top: 6px;
    border-top: 1px solid color-mix(in srgb, var(--color-border) 80%, transparent);
    padding-top: 10px;
  }
  .op-tabbar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
    margin-bottom: 8px;
  }
  .op-tab {
    border: 1px solid color-mix(in srgb, var(--color-border) 85%, transparent);
    background: color-mix(in srgb, var(--color-surface) 75%, transparent);
    color: color-mix(in srgb, var(--color-text) 65%, transparent);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.78rem;
    padding: 6px 10px;
    border-radius: 999px;
    cursor: pointer;
  }
  .op-tab.active {
    border-color: color-mix(in srgb, var(--color-copper) 55%, var(--color-border));
    background: color-mix(in srgb, var(--color-copper) 10%, var(--color-surface));
    color: var(--color-text);
  }
  .op-work {
    min-width: 0;
  }
  .op-panel {
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    border-radius: 12px;
    padding: 16px;
  }
  .op-panel-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 10px;
  }
  .op-h2 {
    font-size: 1.05rem;
    margin: 0;
    font-family: var(--font-serif);
  }
  .op-h3 {
    font-size: 0.92rem;
    margin: 0 0 8px;
    font-family: var(--font-serif);
  }
  .op-muted {
    font-size: 0.88rem;
    opacity: 0.9;
    margin: 8px 0 12px;
    max-width: 60rem;
  }
  .op-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    margin-top: 12px;
  }
  .op-btn {
    padding: 8px 14px;
    border-radius: 8px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    cursor: pointer;
    font-size: 0.88rem;
    color: var(--color-text);
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 40px;
  }
  .op-btn-primary {
    border-color: color-mix(in srgb, var(--color-sage) 40%, var(--color-border));
    background: color-mix(in srgb, var(--color-sage) 12%, var(--color-surface));
  }
  .op-btn-link {
    background: transparent;
  }
  .op-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .op-msg {
    margin-top: 10px;
    font-size: 0.88rem;
    color: var(--color-text);
  }
  .op-kpis {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
    margin-top: 12px;
  }
  @media (min-width: 720px) {
    .op-kpis {
      grid-template-columns: 1fr 1fr 1fr;
    }
  }
  .op-kpi {
    border: 1px solid color-mix(in srgb, var(--color-border) 85%, transparent);
    border-radius: 10px;
    background: color-mix(in srgb, var(--color-surface) 92%, black 8%);
    padding: 12px 14px;
  }
  .op-kpi-k {
    margin: 0;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    opacity: 0.75;
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .op-kpi-v {
    margin: 6px 0 0;
    font-size: 1.4rem;
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .op-split {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
    margin-top: 14px;
  }
  @media (min-width: 900px) {
    .op-split {
      grid-template-columns: 1fr 1fr;
    }
  }
  .op-cardbox {
    border: 1px solid color-mix(in srgb, var(--color-border) 85%, transparent);
    border-radius: 12px;
    background: color-mix(in srgb, var(--color-surface) 92%, black 8%);
    padding: 12px 14px;
  }
  .op-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .op-li {
    display: grid;
    grid-template-columns: 120px 1fr auto;
    gap: 10px;
    align-items: center;
    font-size: 0.84rem;
  }
  .op-li-url {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.9;
  }
  .op-li-link {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.78rem;
    color: var(--color-blue);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .op-mini {
    font-size: 0.72rem;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--color-border) 90%, transparent);
    background: var(--color-surface);
    cursor: pointer;
    color: var(--color-text);
    text-decoration: none;
  }
  .op-label {
    display: block;
    font-size: 0.82rem;
    margin: 0 0 10px;
  }
  .op-textarea,
  .op-input {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.88rem;
    margin-top: 6px;
  }
  .op-row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .op-row .grow {
    flex: 1;
    min-width: 240px;
  }
  .op-check {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.86rem;
    margin: 8px 0;
  }
  .op-details {
    border: 1px solid color-mix(in srgb, var(--color-border) 85%, transparent);
    border-radius: 10px;
    padding: 10px 12px;
    background: color-mix(in srgb, var(--color-surface) 94%, black 6%);
    margin-top: 10px;
  }
  .op-details-sum {
    cursor: pointer;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    opacity: 0.85;
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .op-details-body {
    margin-top: 10px;
  }
  .op-code {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.85em;
  }
  .op-mono {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.78rem;
  }
</style>
