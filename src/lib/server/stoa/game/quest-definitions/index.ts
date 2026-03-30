/**
 * Quest registry - exports all quest definitions
 */

export * from './types.js';
export { MARCUS_QUESTS } from './marcus.js';
export { EPICTETUS_QUESTS } from './epictetus.js';
export { SENECA_QUESTS } from './seneca.js';
export { META_QUESTS } from './meta.js';

import { MARCUS_QUESTS } from './marcus.js';
import { EPICTETUS_QUESTS } from './epictetus.js';
import { SENECA_QUESTS } from './seneca.js';
import { META_QUESTS } from './meta.js';
import type { QuestDefinition } from './types.js';

/**
 * All available quests in the Stoa game
 */
export const ALL_QUESTS: QuestDefinition[] = [
	...MARCUS_QUESTS,
	...EPICTETUS_QUESTS,
	...SENECA_QUESTS,
	...META_QUESTS
];

/**
 * Map of quest IDs to quest definitions for quick lookup
 */
export const QUEST_MAP: Map<string, QuestDefinition> = new Map(
	ALL_QUESTS.map((q) => [q.id, q])
);

/**
 * Get a quest definition by ID
 */
export function getQuestById(id: string): QuestDefinition | undefined {
	return QUEST_MAP.get(id);
}

/**
 * Get all quests that unlock a specific thinker
 */
export function getQuestsForThinkerUnlock(thinkerId: string): QuestDefinition[] {
	return ALL_QUESTS.filter((q) => q.reward.unlockThinkerId === thinkerId);
}

/**
 * Get starting quests (manual trigger or session_count min 1)
 */
export function getStartingQuests(): QuestDefinition[] {
	return ALL_QUESTS.filter(
		(q) =>
			q.trigger.type === 'manual' ||
			(q.trigger.type === 'session_count' && q.trigger.minSessions <= 1)
	);
}
