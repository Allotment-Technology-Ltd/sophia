<script lang="ts">
	import type { StoaProgressState } from '$lib/types/stoa.js';

	interface Props {
		progress: StoaProgressState | null;
		onClick?: () => void;
	}

	let { progress, onClick }: Props = $props();

	const levelNames: Record<number, string> = {
		1: 'The Questioner',
		2: 'The Practitioner',
		3: 'The Student',
		4: 'The Adept',
		5: 'The Philosopher',
		6: 'The Sage'
	};

	// Level thresholds: every 500 XP
	const XP_PER_LEVEL = 500;

	let xp = $derived(progress?.xp ?? 0);
	let level = $derived(progress?.level ?? 1);
	let levelName = $derived(levelNames[level] ?? `Level ${level}`);

	// Calculate progress to next level
	let currentLevelBaseXp = $derived((level - 1) * XP_PER_LEVEL);
	let xpIntoLevel = $derived(xp - currentLevelBaseXp);
	let xpNeeded = $derived(XP_PER_LEVEL);
	let progressPercent = $derived(Math.min(100, Math.max(0, (xpIntoLevel / xpNeeded) * 100)));

	function handleClick(): void {
		onClick?.();
	}
</script>

<button class="progress-hud" onclick={handleClick} aria-label="Open quest journal (J)">
	<div class="hud-content">
		<div class="xp-section">
			<span class="xp-value">{xp.toLocaleString()}</span>
			<span class="xp-label">XP</span>
		</div>
		<div class="level-section">
			<span class="level-name">{levelName}</span>
			<div class="progress-bar">
				<div class="progress-fill" style:width="{progressPercent}%"></div>
			</div>
		</div>
	</div>
</button>

<style>
	.progress-hud {
		position: fixed;
		bottom: 24px;
		right: 24px;
		z-index: 50;
		padding: 12px 16px;
		border-radius: 10px;
		border: 1px solid rgba(140, 130, 120, 0.3);
		background: rgba(26, 24, 22, 0.85);
		backdrop-filter: blur(8px);
		cursor: pointer;
		transition: all 200ms ease;
		font-family: inherit;
		text-align: left;
	}

	.progress-hud:hover {
		background: rgba(36, 34, 32, 0.92);
		border-color: rgba(160, 150, 140, 0.4);
		transform: translateY(-2px);
	}

	.hud-content {
		display: flex;
		align-items: center;
		gap: 14px;
	}

	.xp-section {
		display: flex;
		align-items: baseline;
		gap: 4px;
	}

	.xp-value {
		font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
		font-size: 18px;
		font-weight: 500;
		color: rgba(239, 229, 208, 0.95);
		letter-spacing: -0.02em;
	}

	.xp-label {
		font-family: var(--font-ui);
		font-size: 11px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: rgba(180, 170, 160, 0.7);
	}

	.level-section {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 120px;
	}

	.level-name {
		font-family: var(--font-display);
		font-size: 12px;
		font-weight: 500;
		color: rgba(210, 200, 185, 0.9);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.progress-bar {
		width: 100%;
		height: 3px;
		border-radius: 2px;
		background: rgba(60, 56, 52, 0.6);
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		border-radius: 2px;
		background: linear-gradient(90deg, rgba(190, 140, 80, 0.8), rgba(200, 160, 100, 0.9));
		transition: width 300ms ease;
	}

	@media (max-width: 640px) {
		.progress-hud {
			bottom: 16px;
			right: 16px;
			padding: 10px 14px;
		}

		.xp-value {
			font-size: 16px;
		}

		.level-name {
			font-size: 11px;
			max-width: 100px;
		}

		.level-section {
			min-width: 100px;
		}
	}
</style>
