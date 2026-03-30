import type { StoaProgressState, StoaZone } from '$lib/types/stoa';

/** Runtime signals passed from dialogue / journal / session orchestration. */
export type QuestContext = {
	sessionId?: string;
	/** Distinct session count for this user (lifetime or season — caller defines). */
	sessionCount?: number;
	frameworksUsed?: Array<{ frameworkId: string; situationId?: string }>;
	reasoningScore?: number;
	/** When set, `reasoning_improved` requires current score strictly above this baseline. */
	priorReasoningScore?: number;
	daysElapsed?: number;
	journalCount?: number;
	/** Journal entries tagged with morning_preparation, etc. */
	journalEntriesByFramework?: Record<string, number>;
	activeVoiceThinkerId?: string;
	/** Sessions completed with a given thinker as the active STOA voice (for voice-gated quests). */
	voiceSessionCounts?: Record<string, number>;
};

export type QuestTrigger =
	| { type: 'session_count'; minSessions: number }
	| { type: 'manual' }
	| { type: 'thinker_unlocked'; thinkerId: string }
	| { type: 'reasoning_score'; minScore: number };

export type QuestCompletion =
	| { type: 'framework_used'; frameworkId: string; minCount: number; distinctSituations?: boolean }
	| { type: 'journal_entries'; minCount: number; frameworkId?: string }
	| { type: 'days_and_journal'; daysElapsed: number; journalMinCount: number }
	| { type: 'session_with_voice'; minSessions: number; thinkerId: string }
	| { type: 'journal_distinct_frameworks'; minCount: number }
	| { type: 'reasoning_improved'; minScore: number };

export interface QuestDefinition {
	id: string;
	title: string;
	frameworks?: string[];
	trigger: QuestTrigger;
	completion: QuestCompletion;
	rewardXp: number;
	unlockThinkerId?: string;
	unlockZone?: StoaZone;
	dialogueSeed?: string;
}

export type { StoaProgressState };
