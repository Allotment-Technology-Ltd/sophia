#!/usr/bin/env bash
# Rewind a partial checkpoint to post-relations (drop grouping output), then run ingest once per experiment.
#
# Env (defaults = Descartes’ Epistemology):
#   BML_SLUG=david-hume
#   BML_SOURCE=data/sources/david-hume.txt
#   BML_LOG_PREFIX=bml-grouping-hume
#
# Requires: data/ingested/${BML_SLUG}-partial.json.bak (copy golden partial before first run)
#
# Example — Hume:
#   cp data/ingested/david-hume-partial.json data/ingested/david-hume-partial.json.bak
#   BML_SLUG=david-hume BML_SOURCE=data/sources/david-hume.txt BML_LOG_PREFIX=bml-grouping-hume pnpm ops:bml-grouping-knob-sweep
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BML_SLUG="${BML_SLUG:-descartes-epistemology}"
BML_SOURCE="${BML_SOURCE:-data/sources/descartes-epistemology.txt}"
BML_LOG_PREFIX="${BML_LOG_PREFIX:-bml-grouping}"

PARTIAL_BAK="data/ingested/${BML_SLUG}-partial.json.bak"
PARTIAL_OUT="data/ingested/${BML_SLUG}-partial.json"

rewind() {
	PARTIAL_BAK="$PARTIAL_BAK" PARTIAL_OUT="$PARTIAL_OUT" node -e "
	const fs = require('fs');
	const bak = process.env.PARTIAL_BAK;
	const out = process.env.PARTIAL_OUT;
	const j = JSON.parse(fs.readFileSync(bak, 'utf8'));
	j.stage_completed = 'relating';
	delete j.arguments;
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
		pnpm exec tsx --env-file=.env.local scripts/ingest.ts \
			"$BML_SOURCE" --stop-after-embedding 2>&1 | tee "$log" || true
	else
		env "$@" pnpm exec tsx --env-file=.env.local scripts/ingest.ts \
			"$BML_SOURCE" --stop-after-embedding 2>&1 | tee "$log" || true
	fi
	grep '\[INGEST_TIMING\]' "$log" | tail -1 || true
	echo "" >&2
}

if [ ! -f "$PARTIAL_BAK" ]; then
	echo "ERROR: Missing $PARTIAL_BAK — save a checkpoint after relations+grouping (or post-relations) first." >&2
	exit 1
fi

run_case "01-default"
run_case "02-adaptive-off" INGEST_GROUPING_ADAPTIVE=0
run_case "03-batch-24k" GROUPING_ANTHROPIC_BATCH_TARGET_TOKENS=24000
run_case "04-preempt-off" INGEST_GROUPING_PREEMPT_OUTPUT_SPLITS=0
run_case "05-output-factor-14" INGEST_GROUPING_OUTPUT_VS_INPUT_FACTOR=1.4
run_case "06-split-trunc-off" INGEST_GROUPING_SPLIT_ON_TRUNCATION=0

echo "Done ${BML_SLUG}. Logs: docs/local/operations/${BML_LOG_PREFIX}-*.log" >&2
