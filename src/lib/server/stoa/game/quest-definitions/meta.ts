import type { QuestDefinition } from '../types';

export const META_QUESTS: QuestDefinition[] = [
	{
		id: 'examined-life',
		title: 'The Examined Life',
		trigger: { type: 'reasoning_score', minScore: 0.65 },
		completion: { type: 'reasoning_improved', minScore: 0.75 },
		rewardXp: 500,
		unlockThinkerId: 'zeno',
		dialogueSeed:
			'Something has shifted in how you reason. You are no longer just using the frameworks — you are thinking with them.'
	}
];
