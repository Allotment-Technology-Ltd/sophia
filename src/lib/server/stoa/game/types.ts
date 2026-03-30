import type { StoaProgressState } from '$lib/types/stoa';

export type QuestTrigger =
	| { type: 'manual' }
	| { type: 'session_count'; minSessions: number }
	| { type: 'thinker_unlocked'; thinkerId: string }
	| { type: 'reasoning_score'; minScore: number; requiresImprovement?: boolean };

export type QuestCompletionRule =
	| { type: 'framework_used'; frameworkId: string; minCount: number; distinctRealSituations?: boolean }
	| { type: 'journal_entries'; minCount: number; requiresDistinctFrameworks?: boolean }
	| { type: 'days_elapsed'; minDays: number }
	| { type: 'session_count'; minSessions: number; thinkerId?: string }
	| { type: 'reasoning_score'; minScore: number; requiresImprovement?: boolean }
	| { type: 'distinct_session_days'; minDays: number; requireConsecutive?: boolean }
	| { type: 'manual_signal'; signalId: string }
	| { type: 'challenge_engagement'; minTurnIndex?: number }
	| { type: 'stance_streak'; stance: 'hold' | 'challenge' | 'guide' | 'teach' | 'sit_with'; minConsecutiveTurns: number }
	| { type: 'session_start_window'; startHourInclusive: number; endHourExclusive: number };

export interface QuestRepeatableRule {
	cooldown: 'daily' | 'weekly';
}

export interface QuestReward {
	xp: number;
	unlockThinkerId?: string;
	unlockZoneId?: string;
}

export interface QuestDefinition {
	id: string;
	title: string;
	description?: string;
	frameworks: string[];
	trigger: QuestTrigger;
	completion: QuestCompletionRule[];
	reward: QuestReward;
	repeatable?: false | QuestRepeatableRule;
	dialogueSeed?: string;
}

export interface QuestContext {
	sessionId: string;
	turnIndex: number;
	frameworksUsed: string[];
	reasoningScore: number;
	daysElapsed: number;
	journalCount: number;
	stance?: 'hold' | 'challenge' | 'guide' | 'teach' | 'sit_with';
	manualSignals?: string[];
	sessionStartHourLocal?: number | null;
}

export interface QuestCompletionRow {
	id?: string;
	user_id?: string;
	quest_id?: string;
	completed_at?: string;
	xp_awarded?: number;
	unlock_awarded?: string | null;
	session_evidence?: string[];
	completion_count?: number;
}

export type StoaProgressRecord = StoaProgressState & {
	id?: string;
	user_id?: string;
	created_at?: string;
	updated_at?: string;
};
