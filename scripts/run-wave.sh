#!/bin/bash
# SOPHIA — Wave Ingestion Runner
#
# Usage: ./scripts/run-wave.sh <wave-number> [--validate] [--dry-run]
#
# Runs one ingestion wave with pre-flight checks, confirmation, and
# post-run quality report + backup.

set -euo pipefail

# ─── Colours ────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

# ─── Args ────────────────────────────────────────────────────────────────────
WAVE="${1:-}"
shift || true          # remaining args forwarded to ingest-batch
EXTRA_FLAGS=("$@")

if [[ -z "$WAVE" || ! "$WAVE" =~ ^[1-3]$ ]]; then
    echo -e "${RED}Usage: $0 <wave-number> [--validate] [--dry-run]${NC}"
    echo "  wave-number: 1, 2, or 3"
    exit 1
fi

# ─── cd to project root (so npx/paths resolve correctly) ─────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# ─── Load .env for shell-level vars (health check URL, etc.) ─────────────────
if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    source .env 2>/dev/null || true
    set +a
fi

SURREAL_URL="${SURREAL_URL:-http://localhost:8000/rpc}"
SURREAL_HEALTH="${SURREAL_URL%/rpc}/health"   # swap /rpc for /health

# ─── Per-wave metadata ────────────────────────────────────────────────────────
case "$WAVE" in
    1) WAVE_SOURCES=8;  CLAUDE_EST="£0.15-0.25"; VOYAGE_EST="£0.01"; GEMINI_EST="£0.05" ;;
    2) WAVE_SOURCES=10; CLAUDE_EST="£0.20-0.30"; VOYAGE_EST="£0.01"; GEMINI_EST="£0.06" ;;
    3) WAVE_SOURCES=11; CLAUDE_EST="£0.22-0.33"; VOYAGE_EST="£0.01"; GEMINI_EST="£0.07" ;;
esac

# ─── Header ───────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
printf  "║           SOPHIA — WAVE %-36s║\n" "$WAVE INGESTION"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo -e "${BOLD}Sources in this wave:${NC} $WAVE_SOURCES"
echo ""
echo -e "${BOLD}Estimated cost:${NC}"
echo "  Claude:    $CLAUDE_EST"
echo "  Voyage:    $VOYAGE_EST"
echo "  Gemini:    $GEMINI_EST"
if [ ${#EXTRA_FLAGS[@]} -gt 0 ]; then
    echo ""
    echo -e "${BOLD}Extra flags:${NC} ${EXTRA_FLAGS[*]}"
fi
echo ""

# ─── 1. Health check ─────────────────────────────────────────────────────────
echo -e "${BLUE}[1/4] HEALTH CHECK${NC}"
echo "  Checking SurrealDB at $SURREAL_HEALTH ..."
if curl -sf --max-time 8 "$SURREAL_HEALTH" > /dev/null 2>&1; then
    echo -e "  ${GREEN}✓ SurrealDB is reachable${NC}"
else
    echo -e "  ${RED}✗ SurrealDB unreachable${NC}"
    echo ""
    echo "  Ensure SURREAL_URL in .env is correct and the DB is running."
    echo "  Production external IP: 35.246.25.125"
    exit 1
fi
echo ""

# ─── 2. Current ingestion status ─────────────────────────────────────────────
echo -e "${BLUE}[2/4] CURRENT STATUS — Wave $WAVE${NC}"
echo ""
npx tsx --env-file=.env scripts/ingest-batch.ts --wave "$WAVE" --status 2>/dev/null || {
    echo -e "  ${YELLOW}⚠ Could not fetch status (ingestion_log may be empty)${NC}"
}
echo ""

# ─── 3. Confirmation ─────────────────────────────────────────────────────────
read -r -p "$(echo -e "${BOLD}Proceed with Wave $WAVE ingestion? (y/n)${NC} ")" CONFIRM
echo ""
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

START_TS=$(date +%s)

# ─── 4. Run ingestion ─────────────────────────────────────────────────────────
echo -e "${BLUE}[3/4] INGESTION — Wave $WAVE${NC}"
echo ""
INGESTION_EXIT=0
npx tsx --env-file=.env scripts/ingest-batch.ts --wave "$WAVE" "${EXTRA_FLAGS[@]}" \
    || INGESTION_EXIT=$?

echo ""
END_TS=$(date +%s)
ELAPSED=$(( END_TS - START_TS ))
ELAPSED_MIN=$(( ELAPSED / 60 ))
ELAPSED_SEC=$(( ELAPSED % 60 ))

if [ "$INGESTION_EXIT" -eq 0 ]; then
    echo -e "  ${GREEN}✓ Ingestion complete (${ELAPSED_MIN}m ${ELAPSED_SEC}s)${NC}"
else
    echo -e "  ${YELLOW}⚠ Ingestion finished with warnings/failures (exit $INGESTION_EXIT, ${ELAPSED_MIN}m ${ELAPSED_SEC}s)${NC}"
    echo "    Check output above for failed sources."
fi
echo ""

# ─── 5. Quality report ───────────────────────────────────────────────────────
echo -e "${BLUE}[4/4] POST-RUN CHECKS${NC}"
echo ""
echo "  Generating quality report..."
npx tsx --env-file=.env scripts/quality-report.ts --all 2>&1 \
    || echo -e "  ${YELLOW}⚠ Quality report had issues${NC}"

LATEST_REPORT=$(ls -t data/reports/quality-report-*.md 2>/dev/null | head -1 || true)
echo ""

# ─── 6. Backup ────────────────────────────────────────────────────────────────
echo "  Running backup..."
npx tsx --env-file=.env scripts/db-backup.ts \
    && echo -e "  ${GREEN}✓ Backup complete${NC}" \
    || echo -e "  ${YELLOW}⚠ Backup had issues — check output above${NC}"
echo ""

# ─── Summary ──────────────────────────────────────────────────────────────────
echo "╔══════════════════════════════════════════════════════════════╗"
printf  "║           WAVE %-45s║\n" "$WAVE COMPLETE"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo -e "  Duration:    ${BOLD}${ELAPSED_MIN}m ${ELAPSED_SEC}s${NC}"
if [ -n "$LATEST_REPORT" ]; then
    echo -e "  Report:      ${BOLD}${LATEST_REPORT}${NC}"
fi
echo ""

NEXT_WAVE=$(( WAVE + 1 ))

echo -e "${BOLD}NEXT STEPS:${NC}"
echo ""
echo "  1. Review the quality report:"
if [ -n "$LATEST_REPORT" ]; then
    echo "       cat $LATEST_REPORT | less"
else
    echo "       ls data/reports/"
fi
echo ""
echo "  2. Spot-check extracted claims against source texts in data/sources/"
echo ""
echo "  3. Look for flags in the report:"
echo "       ⚠ Orphan claims, thin arguments, low-confidence claims,"
echo "         relation imbalance, near-duplicate pairs"
echo ""
if [ "$NEXT_WAVE" -le 3 ]; then
    echo "  4. When satisfied, run Wave $NEXT_WAVE:"
    echo ""
    echo "       ./scripts/run-wave.sh $NEXT_WAVE"
else
    echo "  4. All waves complete — run a full quality report if needed:"
    echo ""
    echo "       npx tsx --env-file=.env scripts/quality-report.ts --all"
fi
echo ""

exit "$INGESTION_EXIT"
