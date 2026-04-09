// SOPHIA-only — Stoa dialogue boundaries. Keep aligned with:
// https://github.com/Allotment-Technology-Ltd/restormel-keys/blob/main/docs/restormel/state-sophia-integration.md
import type { StateEvent } from '@restormel/state';

const DEFAULT_STOA_SCOPE = 'stoa_session';

/** Compact user-turn digest at a Stoa dialogue boundary. No secrets in `user_turn_digest`. */
export function createStoaTurnDigestEvents(params: {
	id: string;
	ts: string;
	run_id: string;
	scope?: string;
	user_turn_digest_cell_id: string;
	user_turn_digest: string;
}): StateEvent[] {
	const scope = params.scope ?? DEFAULT_STOA_SCOPE;
	return [
		{
			type: 'memory_cell_upsert',
			id: params.id,
			ts: params.ts,
			scope,
			cell_id: params.user_turn_digest_cell_id,
			text: params.user_turn_digest,
			run_id: params.run_id
		}
	];
}

/** Escalation / history summarization: drop `remove_cell_ids`, insert `summary_text`. */
export function createStoaHistorySummarizationEvent(params: {
	id: string;
	ts: string;
	run_id: string;
	scope?: string;
	remove_cell_ids: string[];
	summary_cell_id: string;
	summary_text: string;
	pinned?: boolean;
}): StateEvent {
	const scope = params.scope ?? DEFAULT_STOA_SCOPE;
	return {
		type: 'memory_summarize_compact',
		id: params.id,
		ts: params.ts,
		scope,
		remove_cell_ids: [...params.remove_cell_ids],
		summary_cell_id: params.summary_cell_id,
		summary_text: params.summary_text,
		pinned: params.pinned,
		run_id: params.run_id
	};
}

/** New Stoa thread: empty default `stoa_session` scope in the projection. */
export function createStoaScopeClearEvent(params: {
	id: string;
	ts: string;
	run_id: string;
	scope?: string;
}): StateEvent {
	return {
		type: 'scope_clear',
		id: params.id,
		ts: params.ts,
		scope: params.scope ?? DEFAULT_STOA_SCOPE,
		run_id: params.run_id
	};
}
