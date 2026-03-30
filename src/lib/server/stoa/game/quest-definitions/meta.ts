import type { QuestDefinition } from './types.js';

/**
 * Meta quests - mastery and synthesis
 */

export const examinedLifeQuest: QuestDefinition = {
	id: 'examined-life',
	title: 'The Examined Life',
	description:
		'You have begun to reason with clarity. Now deepen that practice. Improve your reasoning score to demonstrate mastery.',
	trigger: {
		type: 'reasoning_score',
		minScore: 0.65
	},
	completion: {
		type: 'reasoning_score',
		minScore: 0.75
	},
	reward: {
		xp: 500,
		unlockThinkerId: 'zeno'
	},
	dialogueSeed:
		'Something has shifted in how you reason. You are no longer just using the frameworks — you are thinking with them.'
};

export const META_QUESTS: QuestDefinition[] = [examinedLifeQuest];
