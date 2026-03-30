import type { StanceType, StoaSessionState, StoaZone } from '$lib/types/stoa';

const SESSION_STORAGE_KEY = 'stoa.session.id';

function createInitialState(): StoaSessionState {
  return {
    sessionId: `stoa-${crypto.randomUUID()}`,
    zone: 'colonnade',
    stance: 'hold',
    isLoading: false,
    isStreaming: false,
    audioInitialized: false,
    sceneReady: false
  };
}

function createStoaSessionStore() {
  let state = $state<StoaSessionState>(createInitialState());
  let storageHydrated = $state(false);

  function persistSessionId(nextSessionId: string): void {
    if (typeof window === 'undefined' || !storageHydrated) return;
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, nextSessionId);
  }

  function hydrate(): void {
    if (storageHydrated || typeof window === 'undefined') return;
    storageHydrated = true;

    const storedSessionId = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (storedSessionId && storedSessionId.trim()) {
      state = { ...state, sessionId: storedSessionId };
    }
  }

  function setSessionId(sessionId: string): void {
    state = { ...state, sessionId };
    persistSessionId(sessionId);
  }

  function setZone(zone: StoaZone): void {
    state = { ...state, zone };
  }

  function setStance(stance: StanceType): void {
    state = { ...state, stance };
  }

  function setLoading(isLoading: boolean): void {
    state = { ...state, isLoading };
  }

  function setStreaming(isStreaming: boolean): void {
    state = { ...state, isStreaming };
  }

  function setAudioInitialized(audioInitialized: boolean): void {
    state = { ...state, audioInitialized };
  }

  function setSceneReady(sceneReady: boolean): void {
    state = { ...state, sceneReady };
  }

  function reset(nextSessionId = `stoa-${crypto.randomUUID()}`): void {
    state = {
      ...createInitialState(),
      sessionId: nextSessionId
    };
    persistSessionId(nextSessionId);
  }

  return {
    hydrate,
    reset,
    setAudioInitialized,
    setLoading,
    setSceneReady,
    setSessionId,
    setStance,
    setStreaming,
    setZone,
    get state() {
      return state;
    },
    get sessionId() {
      return state.sessionId;
    },
    get zone() {
      return state.zone;
    },
    get stance() {
      return state.stance;
    },
    get isLoading() {
      return state.isLoading;
    },
    get isStreaming() {
      return state.isStreaming;
    },
    get audioInitialized() {
      return state.audioInitialized;
    },
    get sceneReady() {
      return state.sceneReady;
    }
  };
}

export const stoaSessionStore = createStoaSessionStore();
