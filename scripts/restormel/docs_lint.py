#!/usr/bin/env python3
"""Lint Restormel docs metadata and basic structure."""

from __future__ import annotations

import argparse
import re
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

KEY_DELIVERY_DOCS = {
    "04-delivery/19-milestone-plan-with-exit-criteria.md": "milestone_plan",
    "04-delivery/20-engineering-backlog-by-epic.md": "engineering_backlog",
    "05-design/21-design-backlog-by-surface.md": "design_backlog",
    "04-delivery/18-concrete-launch-sequence-restormel-dev.md": "launch_sequence",
}

REQUIRED_KEYS = (
    "title",
    "owner",
    "product",
    "doc_type",
    "last_reviewed",
    "sync_to_linear",
)


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


def collect_links(text: str) -> list[str]:
    return re.findall(r"\[[^\]]+\]\(([^)]+)\)", text)


def main() -> int:
    parser = argparse.ArgumentParser(description="Lint docs/restormel metadata")
    parser.add_argument(
        "--check-links",
        action="store_true",
        help="Warn about missing internal markdown link targets in key delivery docs.",
    )
    args = parser.parse_args()

    markdown_files = sorted(DOCS_ROOT.rglob("*.md"))
    failures: list[str] = []
    warnings: list[str] = []

    for relative_path, expected_doc_type in KEY_DELIVERY_DOCS.items():
        path = DOCS_ROOT / relative_path
        if not path.exists():
            failures.append(f"Missing required delivery doc: {path}")
            continue

        text = path.read_text(encoding="utf-8")
        front_matter, has_front_matter = parse_front_matter(text)

        if not has_front_matter:
            failures.append(f"{path}: missing YAML front matter block at top of file")
            continue

        for key in REQUIRED_KEYS:
            value = front_matter.get(key, "").strip()
            if not value:
                failures.append(f"{path}: missing required front matter key '{key}'")

        actual_doc_type = front_matter.get("doc_type", "").strip()
        if actual_doc_type and actual_doc_type != expected_doc_type:
            failures.append(
                f"{path}: doc_type '{actual_doc_type}' does not match expected '{expected_doc_type}'"
            )

        if args.check_links:
            for link in collect_links(text):
                if link.startswith(("http://", "https://", "mailto:", "#")):
                    continue
                normalized = link.split("#", 1)[0]
                if not normalized.endswith(".md"):
                    continue
                target = (path.parent / normalized).resolve()
                if not target.exists():
                    warnings.append(f"{path}: broken internal markdown link -> {link}")

    print(f"Scanned {len(markdown_files)} markdown files under {DOCS_ROOT}")

    if warnings:
        print("\nWarnings:")
        for warning in warnings:
            print(f"  - {warning}")

    if failures:
        print("\nMetadata failures:")
        for failure in failures:
            print(f"  - {failure}")
        print("\nFix the listed metadata issues, then re-run docs_lint.py.")
        return 1

    print("\nRequired metadata checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
