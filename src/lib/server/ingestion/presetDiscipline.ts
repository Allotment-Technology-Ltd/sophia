/**
 * SEP / benchmark preset discipline: log a comparable fingerprint and optionally require a named profile.
 */
import { createHash } from 'node:crypto';

export type PresetDisciplineMode = 'off' | 'warn' | 'strict';

export function parsePresetDisciplineMode(raw: string | undefined): PresetDisciplineMode {
	const v = (raw ?? 'off').trim().toLowerCase();
	if (v === 'warn' || v === 'strict') return v;
	return 'off';
}

/** Env knobs that affect extraction boundaries, validation windows, and comparability across runs. */
export function buildSepPresetFingerprint(env: NodeJS.ProcessEnv): Record<string, unknown> {
	return {
		ingest_extraction_max_tokens_per_section: env.INGEST_EXTRACTION_MAX_TOKENS_PER_SECTION ?? null,
		book_max_tokens_per_section: env.BOOK_MAX_TOKENS_PER_SECTION ?? null,
		ingest_prefilter_enabled: env.INGEST_PREFILTER_ENABLED !== 'false',
		validation_batch_target_tokens: env.VALIDATION_BATCH_TARGET_TOKENS ?? null,
		validation_batch_source_max_chars: env.VALIDATION_BATCH_SOURCE_MAX_CHARS ?? null,
		validation_batch_source_context_chars: env.VALIDATION_BATCH_SOURCE_CONTEXT_CHARS ?? null,
		relations_batch_target_tokens: env.RELATIONS_BATCH_TARGET_TOKENS ?? null,
		relations_batch_overlap_claims: env.RELATIONS_BATCH_OVERLAP_CLAIMS ?? null,
		ingest_relations_auto_tune: env.INGEST_RELATIONS_AUTO_TUNE ?? null,
		ingest_grouping_auto_tune: env.INGEST_GROUPING_AUTO_TUNE ?? null,
		ingest_validation_sample_rate: env.INGEST_VALIDATION_SAMPLE_RATE ?? null,
		ingest_validation_mode: env.INGEST_VALIDATION_MODE ?? null,
		ingest_no_model_fallback: env.INGEST_NO_MODEL_FALLBACK === '1',
		pin_provider_extraction: env.INGEST_PIN_PROVIDER_EXTRACTION ?? null,
		pin_model_extraction: env.INGEST_PIN_MODEL_EXTRACTION ?? null,
		pin_provider_validation: env.INGEST_PIN_PROVIDER_VALIDATION ?? null,
		pin_model_validation: env.INGEST_PIN_MODEL_VALIDATION ?? null,
		finetune_labeler_strict: (env.INGEST_FINETUNE_LABELER_STRICT ?? '1').trim() || null,
		finetune_labeler_allowed_providers: env.INGEST_FINETUNE_LABELER_ALLOWED_PROVIDERS ?? null
	};
}

export function presetFingerprintDigest16(fingerprint: Record<string, unknown>): string {
	const json = JSON.stringify(fingerprint);
	return createHash('sha256').update(json).digest('hex').slice(0, 16);
}

/**
 * Log fingerprint; in strict mode require INGEST_PRESET_PROFILE. Throws Error on strict violation.
 */
export function assertSepPresetDiscipline(opts: {
	sourceType: string;
	mode: PresetDisciplineMode;
	profile: string | undefined;
	fingerprint: Record<string, unknown>;
	logLine: (line: string) => void;
}): void {
	if (opts.sourceType !== 'sep_entry') return;
	if (opts.mode === 'off') return;

	const digest = presetFingerprintDigest16(opts.fingerprint);
	const profile = (opts.profile ?? '').trim();
	const payload = {
		source_type: 'sep_entry',
		preset_profile: profile || null,
		fingerprint_sha256_16: digest,
		...opts.fingerprint
	};
	opts.logLine(`[INGEST_PRESET_FINGERPRINT] ${JSON.stringify(payload)}`);

	if (opts.mode === 'strict' && !profile) {
		throw new Error(
			'INGEST_PRESET_DISCIPLINE=strict requires INGEST_PRESET_PROFILE (e.g. sep-benchmark-2026-04). See docs/local/operations/ingestion-sep-preset-discipline.md'
		);
	}
}
