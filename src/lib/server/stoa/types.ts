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
  | 'metadata'
  | 'escalation_started'
  | 'escalation_result'
  | 'complete'
  | 'error';

