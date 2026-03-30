export type StoaZone = 'colonnade' | 'sea-terrace' | 'shrines' | 'library' | 'garden';

export type StanceType = 'hold' | 'challenge' | 'guide' | 'teach' | 'sit_with';

export interface StoaSessionState {
  sessionId: string;
  zone: StoaZone;
  stance: StanceType;
  isLoading: boolean;
  isStreaming: boolean;
  audioInitialized: boolean;
  sceneReady: boolean;
}

export interface StoaDialogueTurn {
  role: 'user' | 'stoa';
  content: string;
  timestamp: string;
  stance?: StanceType;
  frameworksReferenced?: string[];
  sourceClaims?: ClaimReference[];
}

export interface ClaimReference {
  claimId: string;
  sourceText: string;
  sourceAuthor: string;
  sourceWork: string;
  relevanceScore: number;
}

export interface StoaProgressState {
  xp: number;
  level: number;
  unlockedThinkers: string[];
  masteredFrameworks: string[];
  activeQuestIds: string[];
  completedQuestIds: string[];
}

export interface ThinkerProfile {
  id: string;
  name: string;
  dates: string;
  zone: StoaZone;
  isUnlocked: boolean;
  spritePath: string;
  voiceSignature: string;
}
