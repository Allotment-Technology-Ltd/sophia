/**
 * Optional LLM pass: propose ingestable URLs to help resolve failing Inquiry corpus gates.
 * Host-filtered (SEP / IEP / Gutenberg). Uses generateObject with generateText JSON fallback for brittle providers.
 */

import { z } from 'zod';
import { generateObject, generateText } from 'ai';
import { resolveReasoningModelRoute, type ReasoningModelRoute } from '$lib/server/vertex';
import type { CoverageGateInsights } from './datasetCoverageGateInsights';
import type { DatasetTopicPresetCoverageResult } from './datasetTopicPresetCoverage';
import type { CoverageGateAiSuggestionItem, CoverageGateAiSuggestionsPayload } from '$lib/ingestion/operatorGateBootstrap';

const GateAiItemSchema = z.object({
	gate_title: z.string().min(1).max(240),
	urls: z.array(z.string()).max(14),
	rationale: z.string().min(1).max(2200),
	wizard_tip: z.string().max(900).optional()
});

const GateAiResponseSchema = z.object({
	suggestions: z.array(GateAiItemSchema).max(12)
});

function allowedIngestUrl(raw: string): string | null {
	let s = raw
		.trim()
		.replace(/^[`"'«»]+|[`"'«»]+$/g, '')
		.trim();
	if (!s) return null;
	if (!/^https?:\/\//i.test(s)) {
		if (/^(plato\.stanford\.edu|iep\.utm\.edu|www\.gutenberg\.org|gutenberg\.org)\b/i.test(s)) {
			s = `https://${s}`;
		} else {
			return null;
		}
	}
	try {
		const u = new URL(s);
		if (u.protocol === 'http:') u.protocol = 'https:';
		if (u.protocol !== 'https:') return null;
		const h = u.hostname.toLowerCase();
		if (h === 'plato.stanford.edu' && u.pathname.includes('/entries/')) {
			return u.toString();
		}
		if ((h === 'www.gutenberg.org' || h === 'gutenberg.org') && /\/ebooks\/\d+/i.test(u.pathname)) {
			return u.toString();
		}
		if (h === 'iep.utm.edu' && u.pathname.length > 1) {
			return u.toString();
		}
		return null;
	} catch {
		return null;
	}
}

function normalizeGateTitle(t: string): string {
	return t
		.trim()
		.toLowerCase()
		.replace(/[·•]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function mapSuggestionGateToCanon(gateTitle: string, failTitles: string[]): string | null {
	const g = gateTitle.trim();
	if (!g) return null;
	if (failTitles.includes(g)) return g;
	const n = normalizeGateTitle(g);
	for (const t of failTitles) {
		if (normalizeGateTitle(t) === n) return t;
	}
	for (const t of failTitles) {
		if (t.includes(g) || g.includes(t)) return t;
	}
	if (failTitles.length === 1) return failTitles[0] ?? null;
	return null;
}

function compactSnapshot(coverage: DatasetTopicPresetCoverageResult, insights: CoverageGateInsights): string {
	const failGates = insights.gates.filter((x) => x.status === 'fail' || x.status === 'unknown');
	const p1 = coverage.phase1Readiness;
	const union = p1?.union;
	const payload = {
		generatedAt: coverage.generatedAt,
		neonIngestPersistence: coverage.neonIngestPersistence,
		presetGoal: coverage.presetGoal,
		thinPresets: coverage.presets
			.filter((p) => p.ingestedCount < p.goal)
			.slice(0, 14)
			.map((p) => ({ label: p.label, ingested: p.ingestedCount, goal: p.goal })),
		phase1: union
			? {
					uniqueUrls: union.uniqueUrls,
					phase2ReadyCount: union.phase2ReadyCount,
					missingFromCorpus: union.missingFromCorpus,
					incompletePipeline: union.incompletePipeline,
					notValidatePath: union.notValidatePath,
					skippedSurrealStore: union.skippedSurrealStore,
					sampleNotReady: (union.sampleNotReady ?? []).slice(0, 18)
				}
			: null,
		failedGates: failGates.map((x) => ({
			gate: x.gate,
			status: x.status,
			evidence: x.evidence.slice(0, 1400),
			next_actions: x.next_actions.slice(0, 8)
		}))
	};
	return JSON.stringify(payload, null, 2).slice(0, 16_000);
}

function parseSuggestionsFromStructured(
	parsed: z.infer<typeof GateAiResponseSchema>,
	failTitles: string[]
): CoverageGateAiSuggestionItem[] {
	const items: CoverageGateAiSuggestionItem[] = [];
	const orphanUrls: string[] = [];
	const orphanMeta: { rationale: string; wizardTip?: string }[] = [];

	for (const s of parsed.suggestions) {
		const urls = [...new Set(s.urls.map((u) => allowedIngestUrl(u)).filter((x): x is string => Boolean(x)))];
		if (urls.length === 0) continue;
		let canon = mapSuggestionGateToCanon(s.gate_title, failTitles);
		if (!canon) {
			orphanUrls.push(...urls);
			orphanMeta.push({ rationale: s.rationale.trim(), wizardTip: s.wizard_tip?.trim() || undefined });
			continue;
		}
		items.push({
			gateTitle: canon,
			urls,
			rationale: s.rationale.trim(),
			wizardTip: s.wizard_tip?.trim() || undefined
		});
	}

	if (orphanUrls.length > 0 && failTitles.length > 0) {
		const target = failTitles[0]!;
		const rationale =
			orphanMeta.map((m) => m.rationale).join(' ') ||
			'Model suggested URLs without a matching gate title; attached to the first failing gate.';
		const wizardTip = orphanMeta.find((m) => m.wizardTip)?.wizardTip;
		items.push({
			gateTitle: target,
			urls: [...new Set(orphanUrls)].slice(0, 18),
			rationale,
			wizardTip
		});
	}

	return items;
}

async function tryGenerateObject(
	route: ReasoningModelRoute,
	system: string,
	prompt: string
): Promise<z.infer<typeof GateAiResponseSchema> | null> {
	try {
		const result = await generateObject({
			model: route.model,
			schema: GateAiResponseSchema,
			system,
			prompt,
			temperature: 0.2,
			maxOutputTokens: 3200
		});
		const p = GateAiResponseSchema.safeParse(result.object);
		return p.success ? p.data : null;
	} catch {
		return null;
	}
}

async function tryGenerateTextJson(
	route: ReasoningModelRoute,
	system: string,
	prompt: string
): Promise<z.infer<typeof GateAiResponseSchema> | null> {
	try {
		const r = await generateText({
			model: route.model,
			system: `${system} Respond with one JSON object only (no markdown fences).`,
			prompt: `${prompt}

Return JSON exactly in this form:
{"suggestions":[{"gate_title":"<must match a gate string from failedGates>","urls":["https://..."],"rationale":"...","wizard_tip":"optional"}]}`,
			temperature: 0.15,
			maxOutputTokens: 3600
		});
		let text = r.text.trim();
		const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
		if (fence) text = fence[1]!.trim();
		const cut = text.indexOf('{');
		if (cut >= 0) text = text.slice(cut);
		const parsed = JSON.parse(text) as unknown;
		const p = GateAiResponseSchema.safeParse(parsed);
		return p.success ? p.data : null;
	} catch {
		return null;
	}
}

export async function generateCoverageGateAiSourceSuggestions(
	coverage: DatasetTopicPresetCoverageResult,
	insights: CoverageGateInsights
): Promise<CoverageGateAiSuggestionsPayload> {
	const failGates = insights.gates.filter((x) => x.status === 'fail' || x.status === 'unknown');
	if (failGates.length === 0) {
		return { ok: false, error: 'No failing or unknown gates in this snapshot — nothing for the model to target.' };
	}

	const snapshot = compactSnapshot(coverage, insights);
	const route = await resolveReasoningModelRoute({
		depthMode: 'quick',
		pass: 'analysis',
		failureMode: 'degraded_default',
		restormelContext: { task: 'coverage_gate_source_suggestions', estimatedInputTokens: 4000 }
	});

	const system =
		'You output structured suggestions for philosophy corpus operators. gate_title must match a gate field from failedGates (copy exactly if possible). Prefer real SEP/IEP/Gutenberg URLs.';

	const prompt = `You help operators fix **failing inquiry-corpus gates** for a philosophy Q&A product.

Input JSON contains failedGates (exact gate titles, evidence), thinPresets (SEP bundles below depth), and phase1 cohort hints.

For **each** failedGates row, output one entry in suggestions with that row's exact "gate" as gate_title.
Propose 1–8 https URLs per gate from:
- https://plato.stanford.edu/entries/<slug>/  (well-known slugs only)
- https://iep.utm.edu/<slug>/
- https://www.gutenberg.org/ebooks/<id>

If you only know one gate well, still include other gates with 1 conservative flagship URL each (e.g. plato.stanford.edu/entries/plato/ or /entries/aristotle/ when topic fits).

Snapshot:
${snapshot}
`;

	let structured =
		(await tryGenerateObject(route, system, prompt)) ?? (await tryGenerateTextJson(route, system, prompt));

	if (!structured || structured.suggestions.length === 0) {
		return {
			ok: false,
			error:
				'AI returned no structured suggestions (provider may not support JSON mode — check model route / API keys).'
		};
	}

	const failTitles = failGates.map((x) => x.gate);
	const items = parseSuggestionsFromStructured(structured, failTitles);

	if (items.length === 0) {
		return {
			ok: false,
			error: 'Model returned no allowed HTTPS URLs after filtering (SEP / IEP / Gutenberg only).'
		};
	}

	const merged = new Map<string, CoverageGateAiSuggestionItem>();
	for (const it of items) {
		const prev = merged.get(it.gateTitle);
		if (!prev) {
			merged.set(it.gateTitle, { ...it, urls: [...it.urls] });
		} else {
			prev.urls = [...new Set([...prev.urls, ...it.urls])].slice(0, 18);
			if (!prev.wizardTip && it.wizardTip) prev.wizardTip = it.wizardTip;
		}
	}

	return {
		ok: true,
		items: [...merged.values()],
		model: { provider: route.provider, modelId: route.modelId }
	};
}
