export type StoaZone =
  | 'colonnade'
  | 'sea-terrace'
  | 'shrines'
  | 'library'
  | 'garden'
  | 'world-map';

export type StanceType = 'hold' | 'challenge' | 'guide' | 'teach' | 'sit_with';

export interface StoaSessionState {
  sessionId: string;
  zone: StoaZone;
  stance: StanceType;
  isLoading: boolean;
  isStreaming: boolean;
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
  levelTitle?: string;
  xpToNextLevel?: number;
  levelProgress?: number;
  unlockedThinkers: string[];
  masteredFrameworks: string[];
  activeQuestIds: string[];
  completedQuestIds: string[];
  reasoningTrend?: 'improved' | 'steady' | 'inconsistent';
}

export interface ReasoningAssessment {
  sessionId: string;
  turnIndex: number;
  qualityScore: number;
  dimensions: {
    logicalConsistency: number;
    frameworkApplication: number;
    epistemicCalibration: number;
    dichotomyClarity: number | null;
    emotionalHonesty: number;
  };
  frameworksApplied: string[];
  improvementNotes: string[];
  improvementDetected?: boolean;
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

export type WorldMapNodeType = 'thinker' | 'framework' | 'concept';
export type WorldMapEdgeType = 'taught' | 'supports' | 'contradicts' | 'founded';

export interface WorldMapNode {
  id: string;
  label: string;
  type: WorldMapNodeType;
  position: { x: number; y: number; z: number };
  isUnlocked: boolean;
  isActive: boolean;
  isCurrentPosition?: boolean;
  details?: {
    dates?: string;
    description?: string;
    misuseWarning?: string;
    keyWorks?: string[];
    portraitUrl?: string;
  };
}

export interface WorldMapEdge {
  from: string;
  to: string;
  type: WorldMapEdgeType;
  strength: number;
}

export interface WorldMapResponse {
  nodes: WorldMapNode[];
  edges: WorldMapEdge[];
}

// Arrival reason — what brought the student
export type ArrivalReason =
  | 'seeking_peace'
  | 'seeking_direction'
  | 'carrying_burden'
  | 'uncertain';

// Which zone the student starts in — set by arrival reason
export type StartingPath = 'garden' | 'colonnade' | 'sea_terrace';

// Assessment output after first free exchange
export type PhilosophyLevel = 'novice' | 'familiar' | 'practised';
export type ThinkingStyle = 'concrete' | 'abstract' | 'mixed';

// State machine for the opening prologue
export type PrologueState =
  | 'setup_reason'
  | 'setup_struggle'
  | 'loading_scene'
  | 'cinematic'
  | 'beat_1'
  | 'beat_2'
  | 'beat_3'
  | 'beat_4'
  | 'beat_5'
  | 'beat_6'
  | 'open_world';

// Student profile — persisted in SurrealDB stoa_profile table
// NOTE: no name field — STOA addresses everyone as "student"
export interface StoaProfile {
  userId: string;
  arrivalReason: ArrivalReason;
  startingPath: StartingPath;
  beat3Choice: string;
  openingStruggle: string | null;
  openingStruggleEmbedding: number[] | null;
  philosophyLevel: PhilosophyLevel | null;
  thinkingStyle: ThinkingStyle | null;
  emotionalPresence: 'present' | 'defended' | 'unclear' | null;
  primaryStruggleType: 'cognitive' | 'emotional' | 'existential' | 'unclear' | null;
  suggestedOpeningStance: StanceType | null;
  firstSessionId: string;
  createdAt: string;
  lastSeenAt: string;
  totalSessions: number;
}

// Maps starting path to scene configuration
export interface StartingPathConfig {
  path: StartingPath;
  lightState: 'morning' | 'afternoon' | 'dusk';
  defaultStance: StanceType;
  audioPrimarySound: 'birdsong' | 'sea' | 'sea_close';
}

export const STARTING_PATH_CONFIG: Record<StartingPath, StartingPathConfig> = {
  garden: {
    path: 'garden',
    lightState: 'morning',
    defaultStance: 'sit_with',
    audioPrimarySound: 'birdsong'
  },
  colonnade: {
    path: 'colonnade',
    lightState: 'afternoon',
    defaultStance: 'guide',
    audioPrimarySound: 'sea'
  },
  sea_terrace: {
    path: 'sea_terrace',
    lightState: 'dusk',
    defaultStance: 'hold',
    audioPrimarySound: 'sea_close'
  }
};
