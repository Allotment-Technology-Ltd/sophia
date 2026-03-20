#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[smoke:restormel:mcp] Inspecting published Restormel MCP tool surface"

node --input-type=module <<'EOF'
import { ALL_TOOLS } from '@restormel/mcp';

const expected = [
  'models.list',
  'providers.validate',
  'cost.estimate',
  'routing.explain',
  'entitlements.check',
  'integration.generate',
  'docs.search'
];

const names = ALL_TOOLS.map((tool) => tool.name);
for (const name of expected) {
  if (!names.includes(name)) {
    throw new Error(`Missing MCP tool: ${name}`);
  }
}

console.log(JSON.stringify({ tools: names }, null, 2));
EOF

echo "[smoke:restormel:mcp] OK"
