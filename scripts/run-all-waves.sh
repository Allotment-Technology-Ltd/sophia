#!/bin/bash
# SOPHIA — Full Ingestion Pipeline Starter
#
# Usage: ./scripts/run-all-waves.sh [--validate] [--dry-run]
#
# Runs Wave 1 then STOPS — you must review the quality report and
# manually trigger Waves 2 and 3 when satisfied.

set -euo pipefail

# ─── Colours ────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

# ─── cd to project root ───────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# ─── Header ───────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║           SOPHIA — FULL INGESTION PIPELINE                  ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Wave 1:  8 sources   (ethics — core texts)                 ║"
echo "║  Wave 2:  10 sources  (ethics — applied & continental)      ║"
echo "║  Wave 3:  11 sources  (ethics — metaethics & contemporary)  ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Total estimated cost:  £0.60-0.95                          ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "This script will run Wave 1, then pause for your review."
echo "You decide when to continue with Waves 2 and 3."
echo ""

read -r -p "$(echo -e "${BOLD}Start Wave 1? (y/n)${NC} ")" CONFIRM
echo ""
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

# ─── Run Wave 1 ───────────────────────────────────────────────────────────────
WAVE1_EXIT=0
./scripts/run-wave.sh 1 "$@" || WAVE1_EXIT=$?

# ─── Find latest report ────────────────────────────────────────────────────────
LATEST_REPORT=$(ls -t data/reports/quality-report-*.md 2>/dev/null | head -1 || true)

# ─── Post-Wave 1 instructions ─────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ "$WAVE1_EXIT" -ne 0 ]; then
    echo -e "${YELLOW}⚠ Wave 1 finished with some failures.${NC}"
    echo "  Review failed sources before continuing:"
    echo ""
    echo "    npx tsx --env-file=.env scripts/ingest-batch.ts --wave 1 --status"
    echo "    npx tsx --env-file=.env scripts/ingest-batch.ts --wave 1 --retry"
    echo ""
fi

echo -e "${GREEN}Wave 1 complete.${NC} Before continuing to Wave 2:"
echo ""
echo -e "${BOLD}Review the quality report:${NC}"
if [ -n "$LATEST_REPORT" ]; then
    echo "  cat $LATEST_REPORT | less"
else
    echo "  ls data/reports/"
fi
echo ""
echo -e "${BOLD}Things to check:${NC}"
echo "  ⚠  Orphan claims (not connected to any relation or argument)"
echo "  ⚠  Thin arguments (≤ 2 claims — may need re-grouping)"
echo "  ⚠  Low-confidence claims (< 0.7 — verify against source text)"
echo "  ⚠  Relation imbalance (> 80% supports — missing objections?)"
echo "  ⚠  Near-duplicate claim pairs"
echo ""
echo -e "${BOLD}Spot-check a few claims:${NC}"
echo "  ls data/sources/   # fetched source texts for comparison"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${BOLD}Run Wave 2 when ready:${NC}"
echo ""
echo "  ./scripts/run-wave.sh 2"
echo ""
echo -e "${BOLD}Then Wave 3:${NC}"
echo ""
echo "  ./scripts/run-wave.sh 3"
echo ""
echo -e "${BOLD}Or retry any failed Wave 1 sources first:${NC}"
echo ""
echo "  ./scripts/run-wave.sh 1 --retry"
echo ""

exit "$WAVE1_EXIT"
