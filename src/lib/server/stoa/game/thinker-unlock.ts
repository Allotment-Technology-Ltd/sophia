/**
 * Thinker unlock system - manages philosopher profiles and unlock state
 */

import type { ThinkerProfile, StoaZone } from '../../../types/stoa.js';
import { getProgress } from './progress-store.js';

/**
 * All five Stoic thinkers in the game
 */
export const THINKER_REGISTRY: ThinkerProfile[] = [
	{
		id: 'marcus',
		name: 'Marcus Aurelius',
		dates: '121–180 CE',
		zone: 'colonnade' as StoaZone,
		isUnlocked: true, // Default unlocked
		spritePath: '/sprites/stoa/thinkers/marcus.png',
		voiceSignature: 'Marcus, the emperor-philosopher, speaks with measured gravity'
	},
	{
		id: 'epictetus',
		name: 'Epictetus',
		dates: '50–135 CE',
		zone: 'sea-terrace' as StoaZone,
		isUnlocked: false,
		spritePath: '/sprites/stoa/thinkers/epictetus.png',
		voiceSignature: 'Epictetus, the freed slave, speaks with sharp, practical clarity'
	},
	{
		id: 'seneca',
		name: 'Seneca the Younger',
		dates: '4 BCE–65 CE',
		zone: 'shrines' as StoaZone,
		isUnlocked: false,
		spritePath: '/sprites/stoa/thinkers/seneca.png',
		voiceSignature: 'Seneca, the statesman-writer, speaks with elegant, urgent prose'
	},
	{
		id: 'chrysippus',
		name: 'Chrysippus of Soli',
		dates: '279–206 BCE',
		zone: 'library' as StoaZone,
		isUnlocked: false,
		spritePath: '/sprites/stoa/thinkers/chrysippus.png',
		voiceSignature: 'Chrysippus, the logician, speaks with precise, systematic reasoning'
	},
	{
		id: 'zeno',
		name: 'Zeno of Citium',
		dates: '334–262 BCE',
		zone: 'garden' as StoaZone,
		isUnlocked: false,
		spritePath: '/sprites/stoa/thinkers/zeno.png',
		voiceSignature: 'Zeno, the founder, speaks with foundational, quiet authority'
	}
];

/**
 * Map of thinker IDs to profiles for quick lookup
 */
export const THINKER_MAP: Map<string, ThinkerProfile> = new Map(
	THINKER_REGISTRY.map((t) => [t.id, t])
);

/**
 * Check if a thinker is unlocked for a specific user
 */
export async function isUnlocked(userId: string, thinkerId: string): Promise<boolean> {
	// Marcus is always unlocked by default
	if (thinkerId === 'marcus') return true;

	const progress = await getProgress(userId);
	return progress.unlockedThinkers.includes(thinkerId);
}

/**
 * Get all unlocked thinkers for a user
 */
export async function getUnlockedThinkers(userId: string): Promise<ThinkerProfile[]> {
	const progress = await getProgress(userId);

	return THINKER_REGISTRY.filter((thinker) =>
		progress.unlockedThinkers.includes(thinker.id)
	).map((thinker) => ({
		...thinker,
		isUnlocked: true
	}));
}

/**
 * Get all thinkers (both locked and unlocked) with current unlock status
 */
export async function getAllThinkers(userId: string): Promise<ThinkerProfile[]> {
	const progress = await getProgress(userId);

	return THINKER_REGISTRY.map((thinker) => ({
		...thinker,
		isUnlocked:
			thinker.id === 'marcus' || progress.unlockedThinkers.includes(thinker.id)
	}));
}

/**
 * Get a specific thinker profile by ID
 */
export function getThinkerById(thinkerId: string): ThinkerProfile | undefined {
	return THINKER_MAP.get(thinkerId);
}

/**
 * Get the unlock quest for a thinker (if any)
 */
export function getThinkerUnlockQuestId(thinkerId: string): string | undefined {
	const unlockQuests: Record<string, string> = {
		epictetus: 'dichotomy-test',
		seneca: 'seneca-letters',
		zeno: 'examined-life'
		// chrysippus would have its own quest if defined
	};

	return unlockQuests[thinkerId];
}

/**
 * Get the default thinker (always unlocked)
 */
export function getDefaultThinker(): ThinkerProfile {
	return THINKER_REGISTRY[0]; // Marcus Aurelius
}

/**
 * Get thinkers by zone
 */
export function getThinkersByZone(zone: StoaZone): ThinkerProfile[] {
	return THINKER_REGISTRY.filter((t) => t.zone === zone);
}
