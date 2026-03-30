/**
 * Quest system type definitions for Stoa game logic
 */

export type TriggerType =
	| 'session_count'
	| 'thinker_unlocked'
	| 'reasoning_score'
	| 'manual';

export type CompletionType =
	| 'framework_used'
	| 'journal_entries'
	| 'days_elapsed'
	| 'session_count'
	| 'reasoning_score';

export interface SessionCountTrigger {
	type: 'session_count';
	minSessions: number;
	thinkerId?: string;
}

export interface ThinkerUnlockedTrigger {
	type: 'thinker_unlocked';
	thinkerId: string;
}

export interface ReasoningScoreTrigger {
	type: 'reasoning_score';
	minScore: number;
}

export interface ManualTrigger {
	type: 'manual';
}

export type QuestTrigger =
	| SessionCountTrigger
	| ThinkerUnlockedTrigger
	| ReasoningScoreTrigger
	| ManualTrigger;

export interface FrameworkUsedCompletion {
	type: 'framework_used';
	frameworkId: string;
	minCount: number;
}

export interface JournalEntriesCompletion {
	type: 'journal_entries';
	minCount: number;
	differentFrameworks?: boolean;
}

export interface DaysElapsedCompletion {
	type: 'days_elapsed';
	minDays: number;
}

export interface SessionCountCompletion {
	type: 'session_count';
	minSessions: number;
	thinkerId?: string;
}

export interface ReasoningScoreCompletion {
	type: 'reasoning_score';
	minScore: number;
}

export type QuestCompletion =
	| FrameworkUsedCompletion
	| JournalEntriesCompletion
	| DaysElapsedCompletion
	| SessionCountCompletion
	| ReasoningScoreCompletion;

export interface QuestReward {
	xp: number;
	unlockThinkerId?: string;
	unlockZone?: string;
}

export interface QuestDefinition {
	id: string;
	title: string;
	description?: string;
	framework?: string | string[];
	trigger: QuestTrigger;
	completion: QuestCompletion | QuestCompletion[];
	reward: QuestReward;
	dialogueSeed?: string;
}

/**
 * Context passed to quest engine for evaluation
 */
export interface QuestContext {
	sessionId: string;
	userId: string;
	frameworksUsed: string[];
	reasoningScore?: number;
	daysElapsed?: number;
	journalCount?: number;
	journalFrameworks?: string[];
	sessionCount?: number;
	sessionsWithThinker?: Record<string, number>;
	unlockedThinkers?: string[];
	completedQuestIds?: string[];
	activeQuestIds?: string[];
}

/**
 * Represents a completed quest record in the database
 */
export interface QuestCompletionRecord {
	id?: string;
	user_id: string;
	quest_id: string;
	completed_at: string;
	xp_awarded: number;
	unlock_awarded?: string | null;
	session_evidence: string[];
}

/**
 * Student progress state from the database
 */
export interface StudentProgressRecord {
	id?: string;
	user_id: string;
	xp: number;
	level: number;
	unlocked_thinkers: string[];
	mastered_frameworks: string[];
	active_quest_ids: string[];
	completed_quest_ids: string[];
	created_at: string;
	updated_at: string;
}
