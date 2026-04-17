#!/usr/bin/env bash
# Rewind a partial checkpoint to post-embedding (clear validation / remediation), then run
# Stage 5 + 5b once per experiment with --validate --stop-before-store.
#
# Env (defaults = Descartes’ Epistemology):
#   BML_SLUG=david-hume
#   BML_SOURCE=data/sources/david-hume.txt
#   BML_LOG_PREFIX=bml-valrem-hume
#
# Requires: data/ingested/${BML_SLUG}-partial.json.bak
#
# Reliability (read this):
#   • Each case runs with DATABASE_URL cleared for the child so Neon does not override the rewound disk partial
#     (--env-file may still load other keys from .env.local).
#   • INGEST_ORCHESTRATION_RUN_ID + --stop-before-store (Surreal skipped for stages 1–5 when DB is unset).
#   • If .bak has no `embeddings` (e.g. saved after grouping only), the rewind seeds zero vectors so
#     resume stays at embedding — see BML_STUB_EMBEDDING_DIM (default 1024, match your embed model).
#   • BML_VALREM_SKIP_REPAIR=1 → INGEST_REMEDIATION_POLICY_JSON skip_repair (validation + edge drops only;
#     no per-claim repair / re-embed — use when testing validation knobs without Voyage, or to avoid
#     remediation LLM + embed cost in a first pass).
#
# Golden .bak with real embeddings (preferred):
#   pnpm exec tsx --env-file=.env.local scripts/ingest.ts "$BML_SOURCE" --stop-after-embedding
#   cp "data/ingested/${BML_SLUG}-partial.json" "data/ingested/${BML_SLUG}-partial.json.bak"
#
# Example — Hume:
#   BML_SLUG=david-hume BML_SOURCE=data/sources/david-hume.txt BML_LOG_PREFIX=bml-valrem-hume \
#     pnpm ops:bml-validation-remediation-knob-sweep
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BML_SLUG="${BML_SLUG:-descartes-epistemology}"
BML_SOURCE="${BML_SOURCE:-data/sources/descartes-epistemology.txt}"
BML_LOG_PREFIX="${BML_LOG_PREFIX:-bml-valrem}"

# Skip Surreal for stages 1–5 when DATABASE_URL is set (via --env-file); avoids log checkpoint undoing rewind.
export INGEST_ORCHESTRATION_RUN_ID="${INGEST_ORCHESTRATION_RUN_ID:-bml-valrem-sweep}"

if [ "${BML_VALREM_SKIP_REPAIR:-0}" = "1" ]; then
	export INGEST_REMEDIATION_POLICY_JSON='{"skip_repair":true}'
fi

PARTIAL_BAK="data/ingested/${BML_SLUG}-partial.json.bak"
PARTIAL_OUT="data/ingested/${BML_SLUG}-partial.json"

rewind() {
	PARTIAL_BAK="$PARTIAL_BAK" PARTIAL_OUT="$PARTIAL_OUT" BML_STUB_EMBEDDING_DIM="${BML_STUB_EMBEDDING_DIM:-1024}" node -e "
	const fs = require('fs');
	const bak = process.env.PARTIAL_BAK;
	const out = process.env.PARTIAL_OUT;
	const dim = parseInt(process.env.BML_STUB_EMBEDDING_DIM || '1024', 10);
	const j = JSON.parse(fs.readFileSync(bak, 'utf8'));
	j.stage_completed = 'embedding';
	delete j.validation;
	delete j.validation_progress;
	delete j.remediation_progress;
	const claims = j.claims;
	if (Array.isArray(claims) && claims.length > 0) {
		const emb = j.embeddings;
		const ok =
			Array.isArray(emb) &&
			emb.length === claims.length &&
			emb.every((v) => Array.isArray(v) && v.length === dim);
		if (!ok) {
			const z = () => Array.from({ length: dim }, () => 0);
			j.embeddings = claims.map(() => z());
			console.error(
				'[bml-valrem] Seeded stub ' + dim + '-dim zero embeddings for ' + claims.length + ' claim(s) (checkpoint had no/fake embeddings). Prefer a real --stop-after-embedding .bak for production-faithful numbers.'
			);
		}
	}
	fs.writeFileSync(out, JSON.stringify(j, null, 2));
	"
}

run_case() {
	local name="$1"
	shift
	local log="docs/local/operations/${BML_LOG_PREFIX}-${name}.log"
	echo "=== ${BML_SLUG} ${name} ===" >&2
	rewind
	if [ "$#" -eq 0 ]; then
		DATABASE_URL= pnpm exec tsx --env-file=.env.local scripts/ingest.ts \
			"$BML_SOURCE" --validate --stop-before-store 2>&1 | tee "$log" || true
	else
		DATABASE_URL= env "$@" pnpm exec tsx --env-file=.env.local scripts/ingest.ts \
			"$BML_SOURCE" --validate --stop-before-store 2>&1 | tee "$log" || true
	fi
	grep '\[INGEST_TIMING\]' "$log" | tail -1 || true
	echo "" >&2
}

if [ ! -f "$PARTIAL_BAK" ]; then
	echo "ERROR: Missing $PARTIAL_BAK — save a checkpoint after Stage 4 (embedding) first." >&2
	exit 1
fi

run_case "01-default"
run_case "02-val-batch-50k" VALIDATION_BATCH_TARGET_TOKENS=50000
# Legacy pre-2026-04 default (2.2) vs current code default (3) in 01-default
run_case "03-val-tok-mult-22" VALIDATION_TOKEN_ESTIMATE_MULTIPLIER=2.2
run_case "04-snippet-12k" VALIDATION_BATCH_SOURCE_MAX_CHARS=12000
# Deeper repair cap vs code default (8)
run_case "05-rem-max-16" INGEST_REMEDIATION_MAX_CLAIMS=16
run_case "06-revalidate-on" INGEST_REMEDIATION_REVALIDATE=1

echo "Done ${BML_SLUG}. Logs: docs/local/operations/${BML_LOG_PREFIX}-*.log" >&2
