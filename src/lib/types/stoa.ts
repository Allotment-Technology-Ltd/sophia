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
