import type { QuestDefinition } from './types.js';

/**
 * Epictetus quest arc - dichotomy of control and freedom
 */

export const dichotomyTestQuest: QuestDefinition = {
	id: 'dichotomy-test',
	title: 'The Dichotomy Test',
	description:
		'Master the fundamental distinction: what is in your power, and what is not. Apply this discernment three times correctly.',
	framework: 'dichotomy_of_control',
	trigger: {
		type: 'session_count',
		minSessions: 3
	},
	completion: {
		type: 'framework_used',
		frameworkId: 'dichotomy_of_control',
		minCount: 3
	},
	reward: {
		xp: 175,
		unlockThinkerId: 'epictetus'
	}
};

export const epictetusDoorQuest: QuestDefinition = {
	id: 'epictetus-door',
	title: "Epictetus's Door",
	description:
		'The door is always open. Practice twice with Epictetus to understand the freedom that lies on the other side.',
	trigger: {
		type: 'thinker_unlocked',
		thinkerId: 'epictetus'
	},
	completion: {
		type: 'session_count',
		minSessions: 2,
		thinkerId: 'epictetus'
	},
	reward: {
		xp: 150
	}
};

export const EPICTETUS_QUESTS: QuestDefinition[] = [dichotomyTestQuest, epictetusDoorQuest];
