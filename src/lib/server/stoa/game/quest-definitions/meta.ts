import type { QuestDefinition } from '../types';

export const META_QUESTS: QuestDefinition[] = [
	{
		id: 'examined-life',
		title: 'The Examined Life',
		frameworks: [],
		trigger: {
			type: 'reasoning_score',
			minScore: 0.65,
			requiresImprovement: true
		},
		completion: [
			{
				type: 'reasoning_score',
				minScore: 0.75,
				requiresImprovement: true
			}
		],
		reward: {
			xp: 500,
			unlockThinkerId: 'zeno'
		},
		dialogueSeed:
			'Something has shifted in how you reason. You are no longer just using the frameworks — you are thinking with them.'
	}
];
