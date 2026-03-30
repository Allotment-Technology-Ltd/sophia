export type StanceType = 'hold' | 'challenge' | 'guide' | 'teach' | 'sit_with';

export interface ConversationTurn {
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
  stance?: StanceType;
  frameworksReferenced?: string[];
}

export interface ClaimReference {
  claimId: string;
  sourceText: string;
  sourceAuthor: string;
  sourceWork: string;
  relevanceScore: number;
  citationLabel?: string;
  passageExcerpt?: string;
  publicDomainUrl?: string;
  translator?: string | null;
}

export type GroundingMode = 'graph_dense' | 'lexical_fallback' | 'degraded_none';
export type GroundingConfidenceLevel = 'high' | 'medium' | 'low';

export interface CitationQuality {
  claimId: string;
  quoteOverlap: number;
  provenanceConfidence: number;
  confidence: GroundingConfidenceLevel;
}

export interface GroundingResult {
  claims: ClaimReference[];
  mode: GroundingMode;
  warning?: string;
  confidence: GroundingConfidenceLevel;
  citationQuality?: CitationQuality[];
}

export interface DialogueRequest {
  message: string;
  sessionId: string;
  history?: ConversationTurn[];
}

export interface DialogueResponse {
  response: string;
  stance: StanceType;
  frameworksReferenced: string[];
  sourceClaims: ClaimReference[];
  escalated: boolean;
}

export type StoicLevel = 'new' | 'some_exposure' | 'regular_practitioner';

export interface StoaOnboardingProfile {
  stoicLevel: StoicLevel;
  primaryChallenge: string;
  goals: string[];
  triggers: string[];
  completedAt?: string | null;
  intakeVersion?: number;
}

export type ActionLoopTimeframe = 'today' | 'tonight' | 'this_week';
export type ActionItemStatus = 'pending' | 'done' | 'archived' | 'carried_forward';
export type ActionItemOrigin = 'auto_detected' | 'manual' | 'ritual';

export interface StoaActionItem {
  id: string;
  userId: string;
  sessionId: string;
  sourceTurnId?: string | null;
  text: string;
  timeframe: ActionLoopTimeframe;
  status: ActionItemStatus;
  origin: ActionItemOrigin;
  confidenceScore: number;
  createdAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
}

export interface ActionSuggestion {
  id: string;
  text: string;
  timeframe: ActionLoopTimeframe;
  confidenceScore: number;
  rationale: string;
}

export interface GroundingExplainer {
  reasons: string[];
  explanation: string;
}

export interface CurriculumWeek {
  weekNumber: number;
  conceptKey: string;
  conceptTitle: string;
  practicePrompt: string;
  reflectionQuestion: string;
}

export interface CurriculumProgress {
  userId: string;
  currentWeek: number;
  weekStartedAt?: string | null;
  startedAt?: string | null;
  paceMode: 'calendar_week' | 'rolling_7_day';
  completedWeeks: number[];
}

export interface JournalEntry {
  id: string;
  userId: string;
  sessionId: string;
  entryText: string;
  themes: string[];
  createdAt?: string | null;
}

export interface SessionState {
  sessionId: string;
  userId?: string | null;
  summary?: string | null;
  turns: ConversationTurn[];
  updatedAt?: string | null;
}

export type DialogueStreamEventType =
  | 'start'
  | 'delta'
  | 'stance'
  | 'metadata'
  | 'escalation_started'
  | 'escalation_result'
  | 'complete'
  | 'error';

