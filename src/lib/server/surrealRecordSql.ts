/**
 * SurrealDB.js + SCHEMAFULL gotchas (production ingest path):
 *
 * 1. **String fields that store a textual record fingerprint** (e.g. `work.source_id`,
 *    `thinker_resolution_audit_log.source_id`) must not receive bound values that Surreal
 *    parses as **record** types. Passing `RecordId` or a string like `source:uuid` as a
 *    parameter often coerces to a record. Use `string::concat('source:', $key)` with only
 *    the id segment bound, or build the string in SurrealQL.
 *
 * 2. **Record references in RELATE / WHERE** — bare literals like `subject:foo_bar` break
 *    the lexer for some ids. Use `type::record($tb, $key)` inside `LET`, then
 *    `RELATE $from->edge->$to` — SurrealDB 2.x rejects `RELATE type::record(...)->…`
 *    (`type::thing` is also invalid; use `type::record` only via LET or in expressions).
 *
 * 3. **CI** — Before merging changes to ingest / graph Surreal writes, run
 *    `pnpm check:surreal-writes` (also runs in the deploy workflow).
 *
 * @see scripts/check-surreal-write-lint.ts
 */

/** Normalize SDK RecordId or string to `table:id`. */
export function toSurrealRecordIdStr(id: unknown): string {
	if (typeof id === 'string' && id.includes(':')) return id.trim();
	if (id && typeof id === 'object') {
		const o = id as { tb?: unknown; id?: unknown };
		if (typeof o.tb === 'string' && o.id !== undefined && String(o.id)) {
			return `${o.tb}:${String(o.id)}`;
		}
	}
	return String(id ?? '').trim();
}

/**
 * Surreal edge fields (`in` / `out`) sometimes deserialize as a bare Wikidata id (`Q123`)
 * without the `thinker:` table prefix. `splitRecordTableAndKey` needs `table:key`.
 */
export function normalizeBareWikidataQidToThinkerRecordId(id: string): string {
	const s = id.trim();
	if (!s) return s;
	if (s.includes(':')) return s;
	if (/^Q\d+$/i.test(s)) return `thinker:${s}`;
	return s;
}

/** Split `table:key` on first colon; key may contain underscores. */
export function splitRecordTableAndKey(id: unknown): { tb: string; key: string } | null {
	const full = toSurrealRecordIdStr(id);
	const i = full.indexOf(':');
	if (i <= 0) return null;
	const tb = full.slice(0, i);
	const key = full.slice(i + 1);
	if (!tb || !key) return null;
	return { tb, key };
}

/** Id segment after `table:` (e.g. source row key for `string::concat('source:', …)`). */
export function recordKeyForTable(id: unknown, table: string): string {
	const parts = splitRecordTableAndKey(id);
	if (!parts || parts.tb !== table) {
		const full = toSurrealRecordIdStr(id);
		const i = full.indexOf(':');
		if (i > 0 && full.slice(0, i) === table) return full.slice(i + 1);
		throw new Error(`Expected ${table}:… record id, got: ${full}`);
	}
	return parts.key;
}

/** SCHEMAFULL `string` field storing a textual `source:…` id (not a record type). */
export const SOURCE_ID_STRING_SQL = "string::concat('source:', $source_row_key)" as const;

/** `array<string>` with one source id (e.g. `source_ids`, `contexts` on unresolved_thinker_reference). */
export const SOURCE_ID_STRING_ARRAY_ONE_SQL = `[string::concat('source:', $source_row_key)]` as const;
