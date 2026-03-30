#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[smoke:restormel:mcp] Inspecting published Restormel MCP tool surface"

tmp_log="$(mktemp -t restormel-mcp-smoke.XXXXXX.log)"
set +e
pnpm dlx @restormel/mcp >"$tmp_log" 2>&1 &
pid=$!
sleep 8
if kill -0 "$pid" >/dev/null 2>&1; then
  kill "$pid" >/dev/null 2>&1 || true
  wait "$pid" >/dev/null 2>&1 || true
  run_code=124
else
  wait "$pid"
  run_code=$?
fi
set -e

# 124 means the runtime stayed up until we stopped it.
if [[ $run_code -ne 0 && $run_code -ne 124 ]]; then
  echo "[smoke:restormel:mcp] Failed to start runtime (exit $run_code)" >&2
  sed -n '1,120p' "$tmp_log" >&2
  exit 1
fi

log_content="$(<"$tmp_log")"
if [[ "$log_content" != *"restormel-mcp"* && "$log_content" != *"Restormel MCP"* && "$log_content" != *"stdio transport connected"* ]]; then
  echo "[smoke:restormel:mcp] Runtime started but expected startup marker not found" >&2
  sed -n '1,120p' "$tmp_log" >&2
  exit 1
fi

echo "[smoke:restormel:mcp] Runtime startup marker detected"
sed -n '1,40p' "$tmp_log"

echo "[smoke:restormel:mcp] OK"
