/**
 * Thinker unlock system - manages philosopher profiles and unlock state.
 * Uses shared thinker metadata so client code can import the same registry
 * without pulling server modules into browser bundles.
 */

import type { ThinkerProfile, StoaZone } from '../../../types/stoa.js';
import { getProgress } from './progress-store.js';
import { STOA_THINKER_MAP, STOA_THINKER_REGISTRY } from '$lib/stoa/thinkers';

/**
 * All five Stoic thinkers in the game
 */
export const THINKER_REGISTRY: ThinkerProfile[] = STOA_THINKER_REGISTRY.map((t) => ({ ...t }));

/**
 * Map of thinker IDs to profiles for quick lookup
 */
export const THINKER_MAP: Map<string, ThinkerProfile> = new Map(STOA_THINKER_MAP);

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
