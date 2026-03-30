export const LEVEL_THRESHOLDS: number[] = [0, 300, 750, 1500, 2500, 4000, 6000, 9000, 13000, 18000];

export const LEVEL_TITLES: string[] = [
	'The Seeker',
	'The Questioner',
	'The Practitioner',
	'The Stoic Student',
	'The Examined Mind',
	'The Philosopher',
	'The Sage in Training',
	'The Inner Citadel',
	'The Disciple of Logos',
	'The Stoic'
];

export interface LevelFromXp {
	level: number;
	title: string;
	xpToNext: number;
	levelProgress: number;
}

export function getLevelFromXp(xp: number): LevelFromXp {
	const safeXp = Math.max(0, Math.floor(Number.isFinite(xp) ? xp : 0));
	let levelIndex = 0;
	for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i -= 1) {
		if (safeXp >= LEVEL_THRESHOLDS[i]) {
			levelIndex = i;
			break;
		}
	}

	const level = levelIndex + 1;
	const title = LEVEL_TITLES[Math.min(levelIndex, LEVEL_TITLES.length - 1)] ?? LEVEL_TITLES[0];
	const nextThreshold = LEVEL_THRESHOLDS[levelIndex + 1];
	const xpToNext = typeof nextThreshold === 'number' ? Math.max(0, nextThreshold - safeXp) : 0;
	const currentThreshold = LEVEL_THRESHOLDS[levelIndex] ?? 0;
	const levelProgress =
		typeof nextThreshold === 'number' && nextThreshold > currentThreshold
			? Math.max(0, Math.min(1, (safeXp - currentThreshold) / (nextThreshold - currentThreshold)))
			: 1;
	return { level, title, xpToNext, levelProgress };
}
