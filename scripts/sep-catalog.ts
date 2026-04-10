/**
 * Build a JSON list of Stanford Encyclopedia entry URLs from the public contents page.
 * Respect SEP robots.txt and rate limits; use for operator manifests — not a crawler.
 *
 *   npx tsx scripts/sep-catalog.ts [--out data/sep-entry-urls.json]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse } from 'node-html-parser';

const CONTENTS = 'https://plato.stanford.edu/contents.html';

async function main(): Promise<void> {
	const outIdx = process.argv.indexOf('--out');
	const outPath =
		outIdx >= 0 && process.argv[outIdx + 1]
			? process.argv[outIdx + 1]!
			: path.join(process.cwd(), 'data', 'sep-entry-urls.json');

	const res = await fetch(CONTENTS, {
		headers: {
			'User-Agent': 'SophiaSEPCatalog/1.0 (+https://github.com/Allotment-Technology-Ltd/sophia; catalog build)'
		}
	});
	if (!res.ok) {
		throw new Error(`Failed to fetch ${CONTENTS}: ${res.status}`);
	}
	const html = await res.text();
	const root = parse(html);
	const urls = new Set<string>();
	for (const a of root.querySelectorAll('a[href]')) {
		const href = a.getAttribute('href')?.trim();
		if (!href) continue;
		let abs: string;
		try {
			abs = new URL(href, CONTENTS).href;
		} catch {
			continue;
		}
		const u = new URL(abs);
		if (u.hostname !== 'plato.stanford.edu') continue;
		if (!u.pathname.includes('/entries/')) continue;
		u.hash = '';
		urls.add(u.href.replace(/\/+$/, '') + '/');
	}
	const sorted = [...urls].sort();
	const payload = {
		generatedAt: new Date().toISOString(),
		source: CONTENTS,
		count: sorted.length,
		urls: sorted
	};
	fs.mkdirSync(path.dirname(outPath), { recursive: true });
	fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf-8');
	console.log(`[sep-catalog] Wrote ${sorted.length} URLs → ${outPath}`);
}

void main().catch((e) => {
	console.error(e);
	process.exit(1);
});
