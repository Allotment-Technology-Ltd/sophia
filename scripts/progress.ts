/**
 * Progress utilities for ingestion pipeline CLI output.
 * Zero dependencies — uses only ANSI escape codes and Node.js built-ins.
 *
 * Spinner/transient output → stderr (never pollutes stdout logs)
 * Persistent batch summary lines → stdout
 */

export const IS_TTY = process.stdout.isTTY === true;

// ─── Spinner ─────────────────────────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export interface Spinner {
	stop(finalMessage?: string): void;
	update(message: string): void;
}

export function startSpinner(message: string): Spinner {
	if (!IS_TTY) {
		process.stderr.write(`  ... ${message}\n`);
		return {
			stop(finalMessage?: string) {
				if (finalMessage) process.stderr.write(`  ${finalMessage}\n`);
			},
			update(msg: string) {
				process.stderr.write(`  ... ${msg}\n`);
			}
		};
	}

	let frame = 0;
	let currentMessage = message;
	const startTime = Date.now();

	const interval = setInterval(() => {
		const elapsed = Math.round((Date.now() - startTime) / 1000);
		const spinner = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
		frame++;
		process.stderr.write(`\r  ${spinner} ${currentMessage} (${elapsed}s)   `);
	}, 100);

	return {
		stop(finalMessage?: string) {
			clearInterval(interval);
			process.stderr.write('\r\x1b[K'); // clear spinner line
			if (finalMessage) process.stderr.write(`  ${finalMessage}\n`);
		},
		update(msg: string) {
			currentMessage = msg;
		}
	};
}

// ─── Stage Timer ─────────────────────────────────────────────────────────────

export interface StageTimer {
	/** Returns human-readable elapsed time, e.g. "1m 23s" or "45s" */
	end(): string;
}

export function startStageTimer(): StageTimer {
	const startMs = Date.now();
	return {
		end(): string {
			const s = Math.round((Date.now() - startMs) / 1000);
			if (s < 60) return `${s}s`;
			return `${Math.floor(s / 60)}m ${s % 60}s`;
		}
	};
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

/**
 * Returns a progress bar string like "[████████░░░░] 64/128 (50%)"
 * Pure function — no side effects.
 */
export function renderProgressBar(current: number, total: number, width = 28): string {
	const pct = total === 0 ? 1 : Math.min(current / total, 1);
	const filled = Math.round(pct * width);
	const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
	return `[${bar}] ${current}/${total} (${Math.round(pct * 100)}%)`;
}

// ─── Batch Progress Line ─────────────────────────────────────────────────────

export interface BatchLineOpts {
	current: number; // 1-indexed source number
	total: number;
	title: string;
	stage: string; // e.g. "complete" or "FAILED"
	done: number;
	failed: number;
	skipped: number;
	costUsd: number;
	elapsedMs: number;
}

/**
 * Prints a persistent (newline-terminated) batch summary line to stdout.
 * Includes ETA estimate based on average time per completed source.
 */
export function printBatchLine(opts: BatchLineOpts): void {
	const { current, total, title, stage, done, failed, skipped, costUsd, elapsedMs } = opts;
	const shortTitle = title.length > 38 ? title.slice(0, 35) + '...' : title;
	const costGbp = (costUsd * 0.79).toFixed(3);
	const elapsedS = Math.round(elapsedMs / 1000);
	const avgS = current > 0 ? elapsedS / current : 0;
	const remainingS = Math.round(avgS * (total - current));
	const etaStr =
		remainingS > 0
			? ` | ~${Math.floor(remainingS / 60)}m${remainingS % 60}s left`
			: '';

	console.log(
		`  [${current}/${total}] ${shortTitle} → ${stage} | ✓${done} ✗${failed} ↷${skipped} | £${costGbp}${etaStr}`
	);
}

// ─── Misc Formatters ─────────────────────────────────────────────────────────

export function formatDuration(ms: number): string {
	const s = Math.round(ms / 1000);
	if (s < 60) return `${s}s`;
	return `${Math.floor(s / 60)}m ${s % 60}s`;
}
