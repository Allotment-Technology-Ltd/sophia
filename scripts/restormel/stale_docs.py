#!/usr/bin/env python3
"""Report stale Restormel docs based on front matter last_reviewed dates."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path
from typing import Dict, Tuple

REPO_ROOT = Path(__file__).resolve().parents[2]


def resolve_docs_root() -> Path:
    for candidate in (REPO_ROOT / "docs" / "restormel", REPO_ROOT / "docs" / "Restormel"):
        if candidate.exists():
            return candidate
    return REPO_ROOT / "docs" / "restormel"


DOCS_ROOT = resolve_docs_root()


def parse_front_matter(text: str) -> Tuple[Dict[str, str], bool]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, False

    metadata: Dict[str, str] = {}
    for idx in range(1, len(lines)):
        line = lines[idx].strip()
        if line == "---":
            return metadata, True
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        metadata[key.strip()] = value.strip().strip("\"'")

    return {}, False


def parse_date(raw: str) -> dt.date | None:
    try:
        return dt.date.fromisoformat(raw)
    except ValueError:
        return None


def write_github_summary(stale: list[dict], threshold_days: int) -> None:
    summary_path = os.getenv("GITHUB_STEP_SUMMARY")
    if not summary_path:
        return

    lines = [
        "## Restormel Docs Freshness",
        "",
        f"Threshold: `{threshold_days}` days",
        "",
    ]
    if not stale:
        lines.append("No stale docs detected.")
    else:
        lines.append("Stale docs:")
        lines.append("")
        for item in stale:
            lines.append(f"- `{item['path']}` ({item['age_days']} days old, last reviewed `{item['last_reviewed']}`)")

    Path(summary_path).write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Report stale docs/restormel markdown files")
    parser.add_argument("--days", type=int, default=60, help="Max age in days before a doc is stale")
    parser.add_argument(
        "--format",
        choices=("text", "json"),
        default="text",
        help="Output format for CI integration",
    )
    parser.add_argument(
        "--fail-on-stale",
        action="store_true",
        help="Return non-zero when stale docs are detected",
    )
    parser.add_argument(
        "--github-summary",
        action="store_true",
        help="Emit a markdown summary to GITHUB_STEP_SUMMARY when available.",
    )
    args = parser.parse_args()

    today = dt.date.today()
    stale: list[dict] = []
    warnings: list[str] = []

    for path in sorted(DOCS_ROOT.rglob("*.md")):
        text = path.read_text(encoding="utf-8")
        front_matter, has_front_matter = parse_front_matter(text)
        if not has_front_matter:
            continue

        raw_last_reviewed = front_matter.get("last_reviewed", "").strip()
        if not raw_last_reviewed:
            continue

        reviewed_date = parse_date(raw_last_reviewed)
        if reviewed_date is None:
            warnings.append(f"{path}: invalid last_reviewed date '{raw_last_reviewed}'")
            continue

        age_days = (today - reviewed_date).days
        if age_days > args.days:
            stale.append(
                {
                    "path": str(path.relative_to(REPO_ROOT)),
                    "last_reviewed": raw_last_reviewed,
                    "age_days": age_days,
                }
            )

    result = {
        "threshold_days": args.days,
        "stale_count": len(stale),
        "stale": stale,
        "warnings": warnings,
    }

    if args.format == "json":
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print(f"Checked docs under {DOCS_ROOT}")
        print(f"Threshold: {args.days} days")
        if warnings:
            print("\nWarnings:")
            for warning in warnings:
                print(f"  - {warning}")

        if stale:
            print("\nStale docs:")
            for item in stale:
                print(
                    f"  - {item['path']} (age={item['age_days']} days, last_reviewed={item['last_reviewed']})"
                )
        else:
            print("\nNo stale docs detected.")

    if args.github_summary:
        write_github_summary(stale, args.days)

    if args.fail_on_stale and stale:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
