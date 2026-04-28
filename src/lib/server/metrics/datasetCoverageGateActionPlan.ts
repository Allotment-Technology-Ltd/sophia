/**
 * Concrete follow-ups for failed / weak Inquiry corpus gates: where to act + optional Operator wizard bootstrap.
 * Heuristic defaults only (no LLM) to avoid provider rate limits; tune flags conservatively.
 */

import type { DatasetTopicPresetCoverageResult } from './datasetTopicPresetCoverage';
import type { GateFollowUpAction, OperatorGateBootstrapV1 } from '$lib/ingestion/operatorGateBootstrap';

function inferCatalogFromUrls(urls: string[]): 'sep' | 'gutenberg' | undefined {
	for (const x of urls) {
		try {
			const h = new URL(x.trim()).hostname.toLowerCase();
			if (h === 'gutenberg.org' || h.endsWith('.gutenberg.org')) return 'gutenberg';
			const isStanfordHost = h === 'stanford.edu' || h.endsWith('.stanford.edu');
			const hasPlatoLabel = h === 'plato.stanford.edu' || h.startsWith('plato.') || h.includes('.plato.');
			if (isStanfordHost && hasPlatoLabel) return 'sep';
			if (h === 'iep.utm.edu' || h.endsWith('.iep.utm.edu')) return 'sep';
		} catch {
			/* skip */
		}
	}
	return undefined;
}

function bootstrapFromNotReadySamples(
	coverage: DatasetTopicPresetCoverageResult
): OperatorGateBootstrapV1 | null {
	const p1 = coverage.phase1Readiness;
	if (!p1?.union || p1.allUnionUrlsPhase2Ready) return null;
	const u = p1.union;
	const urls = [...new Set((u.sampleNotReady ?? []).map((x) => x.trim()).filter(Boolean))].slice(0, 35);
	if (urls.length === 0) return null;

	const validateLlm = true;
	/** Conservative: never auto-enable tail-only (can skip work); operator can toggle after review. */
	const jobValidationTailOnly = false;
	let jobForceReingest = false;
	if (u.notValidatePath > 0) {
		jobForceReingest = true;
	}
	const notes = [
		`[Inquiry corpus] Suggested re-queue for ${urls.length} sample URL(s).`,
		`Cohort status: ${u.phase2ReadyCount}/${u.uniqueUrls} answer-ready; missing=${u.missingFromCorpus}; incomplete=${u.incompletePipeline}; validate-off=${u.notValidatePath}; store-skip=${u.skippedSurrealStore}.`,
		'Review Sources + Mode before starting. Enable “validation tail only” only if embeddings already exist for these URLs.'
	].join(' ');

	return {
		v: 1,
		urls,
		validateLlm,
		jobValidationTailOnly,
		mergeIntoRunningJob: false,
		jobForceReingest,
		notes,
		sourceCatalog: inferCatalogFromUrls(urls)
	};
}

export function buildGateFollowUpActions(coverage: DatasetTopicPresetCoverageResult): GateFollowUpAction[] {
	const actions: GateFollowUpAction[] = [];
	const boot = bootstrapFromNotReadySamples(coverage);
	if (boot) {
		actions.push({
			id: 'requeue-not-ready-samples',
			title: 'Prepare wizard: not-ready sample URLs',
			description: `Pre-fills ${boot.urls.length} URL(s) from the gate sample with validate LLM on, force re-ingest ${boot.jobForceReingest ? 'on' : 'off'}. Review Sources and Mode before starting.`,
			href: '/admin/ingest/operator/activity?panel=coverage',
			hrefLabel: 'Inquiry corpus',
			operatorBootstrap: boot
		});
	}

	const behind = coverage.presets.filter((p) => p.ingestedCount < p.goal);
	if (behind.length > 0) {
		actions.push({
			id: 'sep-topic-depth',
			title: 'Fill topic-bundle depth (SEP)',
			description: `Bundles below target: ${behind
				.slice(0, 4)
				.map((p) => p.label)
				.join(', ')}${behind.length > 4 ? '…' : ''}. Opens Operator with SEP catalog selected.`,
			href: '/admin/ingest/operator?step=sources&catalog=sep',
			hrefLabel: 'Operator (SEP)',
			operatorBootstrap: {
				v: 1,
				urls: [],
				validateLlm: true,
				jobValidationTailOnly: false,
				mergeIntoRunningJob: false,
				jobForceReingest: false,
				notes: `[Inquiry corpus] Topic depth gate: add ingests for thin bundles (${behind.length} below goal).`,
				sourceCatalog: 'sep'
			}
		});
	}

	const tot = coverage.totals;
	if (
		coverage.neonIngestPersistence &&
		tot.trainingNotAcceptableCount > tot.trainingAcceptableCount &&
		tot.trainingNotAcceptableCount >= 10
	) {
		actions.push({
			id: 'review-grounding-trusted',
			title: 'Review grounding-trusted slice',
			description:
				'Many sources sit outside the trusted slice. Triage governance and lineage before expanding what users see.',
			href: '/admin/ingest/operator/triage?panel=issues',
			hrefLabel: 'Triage → Issues'
		});
	}

	actions.push({
		id: 'thinker-backlog',
		title: 'Resolve Thinker link backlog',
		description: 'Unmapped philosopher names block clean graph linking for inquiries.',
		href: '/admin/ingest/operator/triage?panel=thinker',
		hrefLabel: 'Triage → Thinker'
	});

	actions.push({
		id: 'failed-runs-dlq',
		title: 'Inspect failed runs (DLQ)',
		description: 'Open the dead-letter queue for concrete error payloads and re-drive decisions.',
		href: '/admin/ingest/operator/triage?panel=dlq',
		hrefLabel: 'Triage → DLQ'
	});

	actions.push({
		id: 'durable-jobs',
		title: 'Durable jobs & embedding backlog',
		description: 'Check running or stuck jobs (including embedding-heavy stages) from the monitoring panel.',
		href: '/admin/ingest/operator/activity?panel=jobs',
		hrefLabel: 'Activity → Jobs'
	});

	return actions;
}