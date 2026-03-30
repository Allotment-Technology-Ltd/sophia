import type { QuestDefinition } from '../types';

export const SIDE_QUESTS: QuestDefinition[] = [
	{
		id: 'daily-practice',
		title: 'The Daily Practice',
		description: 'Engage with Stoa on 3 consecutive days.',
		frameworks: [],
		trigger: {
			type: 'session_count',
			minSessions: 1
		},
		completion: [
			{
				type: 'distinct_session_days',
				minDays: 3,
				requireConsecutive: true
			}
		],
		reward: {
			xp: 75
		},
		repeatable: {
			cooldown: 'weekly'
		}
	},
	{
		id: 'meditations-passage',
		title: 'A Passage from the Meditations',
		description: "Discuss one passage from Marcus Aurelius's Meditations with STOA.",
		frameworks: [],
		trigger: {
			type: 'thinker_unlocked',
			thinkerId: 'marcus'
		},
		completion: [
			{
				type: 'manual_signal',
				signalId: 'meditations_passage_discussed'
			}
		],
		reward: {
			xp: 50
		},
		repeatable: false
	},
	{
		id: 'challenge-your-reasoning',
		title: 'Challenge Your Reasoning',
		description: 'Let STOA push back on your thinking without deflecting.',
		frameworks: [],
		trigger: {
			type: 'session_count',
			minSessions: 2
		},
		completion: [
			{
				type: 'challenge_engagement',
				minTurnIndex: 2
			}
		],
		reward: {
			xp: 100
		},
		repeatable: {
			cooldown: 'daily'
		}
	},
	{
		id: 'sit-with-it',
		title: 'Sit With It',
		description: 'Remain in the sit_with stance for a full exchange without seeking resolution.',
		frameworks: [],
		trigger: {
			type: 'session_count',
			minSessions: 3
		},
		completion: [
			{
				type: 'stance_streak',
				stance: 'sit_with',
				minConsecutiveTurns: 3
			}
		],
		reward: {
			xp: 125
		},
		repeatable: false
	},
	{
		id: 'stoa-at-dawn',
		title: 'Stoa at Dawn',
		description: 'Begin a session before 7am.',
		frameworks: [],
		trigger: {
			type: 'session_count',
			minSessions: 1
		},
		completion: [
			{
				type: 'session_start_window',
				startHourInclusive: 5,
				endHourExclusive: 7
			}
		],
		reward: {
			xp: 80
		},
		repeatable: {
			cooldown: 'weekly'
		}
	}
];
