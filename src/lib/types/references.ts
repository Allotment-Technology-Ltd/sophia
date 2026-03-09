export type AnalysisPhase = 'analysis' | 'critique' | 'synthesis';
// 'search' phase added in Phase 4

export type BadgeVariant = 'thesis' | 'premise' | 'objection' | 'response' | 'definition' | 'empirical';

export type RelationType =
  | 'supports'
  | 'contradicts'
  | 'responds-to'
  | 'depends-on'
  | 'qualifies'
  | 'assumes'
  | 'resolves';

export interface Claim {
  id: string;
  text: string;
  badge: BadgeVariant;
  source: string;           // 'Author, Work · Year' or 'Analysis'
  tradition: string;
  detail: string;           // 2-3 sentence contextual note
  phase: AnalysisPhase;
  backRefIds?: string[];    // IDs of claims this references back to
  confidence?: number;      // 0.0-1.0 confidence score
  sourceUrl?: string;       // URL to source document if available from web grounding
}

export interface RelationBundle {
  claimId: string;
  relations: Array<{
    type: RelationType;
    target: string;         // target claim id
    label: string;
  }>;
}

export interface SourceReference {
  id: string;
  title: string;
  author: string[];
  claimCount: number;
  groundingConfidence?: {
    score: number;
    supportingUris: string[];
  };
}
