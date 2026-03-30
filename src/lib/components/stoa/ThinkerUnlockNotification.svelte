<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { createEventDispatcher } from 'svelte';
	import type { ThinkerProfile } from '$lib/types/stoa.js';

	interface Props {
		thinker: ThinkerProfile | null;
		onComplete?: () => void;
	}

	let { thinker, onComplete }: Props = $props();
	const dispatch = createEventDispatcher<{ dismissed: void }>();

	const NOTIFICATION_DURATION = 4000; // 4 seconds

	let visible = $state(false);

	function emitShrineIlluminateEvent(thinkerId: string): void {
		const event = new CustomEvent('shrineIlluminate', {
			detail: { thinkerId },
			bubbles: true
		});
		window.dispatchEvent(event);
	}

	$effect(() => {
		if (thinker !== null && !visible) {
			visible = true;
			emitShrineIlluminateEvent(thinker.id);

			const timer = setTimeout(() => {
				visible = false;
				dispatch('dismissed');
				onComplete?.();
			}, NOTIFICATION_DURATION);

			return () => clearTimeout(timer);
		}
	});
</script>

{#if visible && thinker}
	<div
		class="unlock-notification"
		in:fly={{ y: -50, duration: 500 }}
		out:fade={{ duration: 400 }}
		role="status"
		aria-live="polite"
	>
		<div class="notification-content">
			<img
				src={thinker.spritePath}
				alt={thinker.name}
				class="thinker-portrait"
				width="80"
				height="80"
			/>
			<div class="notification-text">
				<h3 class="thinker-name">{thinker.name}</h3>
				<p class="unlock-message">The shrine of {thinker.name} is now open to you.</p>
			</div>
		</div>
	</div>
{/if}

<style>
	.unlock-notification {
		position: fixed;
		top: 24px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 200;
		padding: 16px 24px;
		border-radius: 12px;
		background: linear-gradient(
			135deg,
			rgba(245, 235, 220, 0.98) 0%,
			rgba(232, 220, 200, 0.96) 100%
		);
		border: 2px solid rgba(180, 130, 90, 0.6);
		box-shadow:
			0 4px 24px rgba(0, 0, 0, 0.3),
			inset 0 1px 0 rgba(255, 255, 255, 0.3);
		backdrop-filter: blur(8px);
	}

	.notification-content {
		display: flex;
		align-items: center;
		gap: 16px;
	}

	.thinker-portrait {
		width: 80px;
		height: 80px;
		border-radius: 8px;
		object-fit: cover;
		border: 2px solid rgba(160, 120, 80, 0.5);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
	}

	.notification-text {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.thinker-name {
		margin: 0;
		font-family: 'Cormorant Garamond', Georgia, serif;
		font-size: 22px;
		font-weight: 600;
		color: rgba(60, 45, 30, 0.95);
		letter-spacing: 0.02em;
	}

	.unlock-message {
		margin: 0;
		font-family: 'Cormorant Garamond', Georgia, serif;
		font-size: 15px;
		font-style: italic;
		color: rgba(80, 65, 50, 0.85);
		line-height: 1.4;
	}

	@media (max-width: 640px) {
		.unlock-notification {
			top: 16px;
			padding: 12px 16px;
			max-width: calc(100vw - 32px);
		}

		.thinker-portrait {
			width: 64px;
			height: 64px;
		}

		.thinker-name {
			font-size: 18px;
		}

		.unlock-message {
			font-size: 13px;
		}
	}
</style>
