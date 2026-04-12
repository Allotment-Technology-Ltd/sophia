# Restormel MCP + AAIF Quickstart (2 minutes, agent preflight)

This is an automation checklist for Cursor agents, not a manual operator runbook.

## Automation contract (copy/paste exactly)

Run this from repo root at the start of any task that touches Restormel routing, MCP, or AAIF:

```bash
pnpm restormel:setup:status && pnpm smoke:restormel:mcp
```

If the task changes routing behavior, policy/evaluation wiring, or AAIF runtime behavior, run:

```bash
pnpm smoke:restormel
```

## Agent gating rule (copy/paste into agent prompt when needed)

```text
Before editing code, run `pnpm restormel:setup:status && pnpm smoke:restormel:mcp`.
If this fails, stop and fix configuration before making code changes.
If my change affects AAIF/runtime routing/policies, run `pnpm smoke:restormel` before finalizing.
```

## Fast interpretation

- `restormel:setup:status` confirms MCP entry, AAIF runtime wiring, and env readiness.
- `smoke:restormel:mcp` confirms Restormel MCP runtime starts cleanly.
- `smoke:restormel` validates resolve + policy path against live keys config.
