/**
 * Shared Wikidata id parsing for thinker resolution (admin UI + Surreal record keys).
 * Accepts `Q123`, `q123`, or pasted entity URLs containing a Q-id.
 */
export function extractWikidataThinkerId(raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	const m = trimmed.toUpperCase().match(/Q\d+/);
	const qid = m?.[0];
	if (!qid || !/^[A-Za-z0-9_-]+$/.test(qid)) return null;
	return qid;
}
