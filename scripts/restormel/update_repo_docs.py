#!/usr/bin/env python3
"""Update targeted generated documentation blocks for repo landing pages."""

from __future__ import annotations

import argparse
import os
import re
import sys
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

BLOCK_START = "<!-- GENERATED:{name}:start -->"
BLOCK_END = "<!-- GENERATED:{name}:end -->"


@dataclass(frozen=True)
class DocRecord:
    path: Path
    title: str
    last_reviewed: str | None
    status: str | None
    source_of_truth: str | None


RESTORMEL_GROUPS = OrderedDict(
    [
        ("00-overview", "Overview"),
        ("01-strategy", "Strategy"),
        ("02-architecture", "Architecture"),
        ("03-product", "Product"),
        ("04-delivery", "Delivery"),
        ("05-design", "Design"),
        ("06-marketplace", "Marketplace"),
        ("07-monetisation", "Monetisation"),
        ("08-sophia", "SOPHIA Context"),
    ]
)

ROOT_STRUCTURE = OrderedDict(
    [
        ("src", "SvelteKit application, server logic, and UI surfaces."),
        ("docs", "Public, reference, and archived documentation surfaces."),
        ("scripts", "Operational tooling, ingestion utilities, and docs automation."),
        ("tests", "Playwright end-to-end coverage."),
        ("data", "Source data and ingestion inputs."),
    ]
)

TARGETS = OrderedDict(
    [
        (
            Path("README.md"),
            OrderedDict(
                [
                    ("key-links", "render_root_key_links"),
                    ("repo-doc-map", "render_root_repo_doc_map"),
                    ("repo-structure", "render_root_repo_structure"),
                    ("current-priorities", "render_root_current_priorities"),
                ]
            ),
        ),
        (
            Path("docs/README.md"),
            OrderedDict(
                [
                    ("docs-map", "render_docs_map"),
                    ("key-doc-entry-points", "render_docs_entry_points"),
                    ("active-vs-archive", "render_active_vs_archive"),
                ]
            ),
        ),
        (
            Path("docs/restormel/README.md"),
            OrderedDict(
                [
                    ("active-restormel-docs", "render_active_restormel_docs"),
                    ("restormel-delivery-docs", "render_restormel_delivery_docs"),
                    ("restormel-reference-docs", "render_restormel_reference_docs"),
                ]
            ),
        ),
        (
            Path("docs/sophia/README.md"),
            OrderedDict(
                [
                    ("sophia-key-links", "render_sophia_key_links"),
                    ("active-sophia-docs", "render_active_sophia_docs"),
                    ("sophia-current-focus", "render_sophia_current_focus"),
                ]
            ),
        ),
    ]
)


def parse_front_matter(text: str) -> dict[str, str]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}

    metadata: dict[str, str] = {}
    for index in range(1, len(lines)):
        line = lines[index].strip()
        if line == "---":
            return metadata
        if not line or line.startswith("#") or ":" not in line:
            continue
        key, value = line.split(":", 1)
        metadata[key.strip()] = value.strip().strip("\"'")
    return {}


def extract_title(text: str, fallback: str) -> str:
    metadata = parse_front_matter(text)
    if metadata.get("title"):
        return metadata["title"]

    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            return stripped[2:].strip()
    return fallback


def load_doc(path: Path) -> DocRecord:
    text = path.read_text(encoding="utf-8")
    metadata = parse_front_matter(text)
    fallback = path.stem.replace("-", " ").replace("_", " ").title()
    return DocRecord(
        path=path,
        title=extract_title(text, fallback),
        last_reviewed=metadata.get("last_reviewed"),
        status=metadata.get("status"),
        source_of_truth=metadata.get("source_of_truth"),
    )


def relative_link(from_file: Path, target: Path) -> str:
    relative = os.path.relpath(target, start=from_file.parent)
    return relative.replace(os.sep, "/")


def markdown_link(from_file: Path, doc: DocRecord) -> str:
    return f"[{doc.title}]({relative_link(from_file, doc.path)})"


def render_table(headers: list[str], rows: list[list[str]]) -> str:
    lines = [
        f"| {' | '.join(headers)} |",
        f"| {' | '.join(['---'] * len(headers))} |",
    ]
    for row in rows:
        lines.append(f"| {' | '.join(row)} |")
    return "\n".join(lines)


def collect_docs(paths: list[Path]) -> list[DocRecord]:
    return [load_doc(path) for path in paths]


def sorted_markdown_files(directory: Path) -> list[Path]:
    return sorted(path for path in directory.glob("*.md") if path.name != "README.md")


def restormel_group_docs() -> OrderedDict[str, list[DocRecord]]:
    groups: OrderedDict[str, list[DocRecord]] = OrderedDict()
    for folder, label in RESTORMEL_GROUPS.items():
        directory = REPO_ROOT / "docs" / "restormel" / folder
        groups[label] = collect_docs(sorted_markdown_files(directory))
    return groups


def sophia_active_docs() -> list[DocRecord]:
    records: list[DocRecord] = []
    for path in sorted((REPO_ROOT / "docs" / "sophia").glob("*.md")):
        if path.name in {"rationalisation-inventory.md", "rationalisation-summary.md"}:
            continue
        record = load_doc(path)
        if record.status == "active":
            records.append(record)
    return records


def restormel_reference_docs() -> list[DocRecord]:
    records: list[DocRecord] = []
    for path in sorted((REPO_ROOT / "docs" / "restormel" / "10-reference").glob("*.md")):
        if path.name == "README.md":
            continue
        records.append(load_doc(path))
    return records


def parse_ordered_list_under_heading(path: Path, heading: str) -> list[str]:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    in_section = False
    items: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped == heading:
            in_section = True
            continue
        if in_section and stripped.startswith("## "):
            break
        if in_section:
            match = re.match(r"\d+\.\s+(.*)", stripped)
            if match:
                items.append(match.group(1).strip())
    return items


def parse_theme_headings(path: Path, heading: str) -> list[str]:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    in_section = False
    items: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped == heading:
            in_section = True
            continue
        if in_section and stripped.startswith("## "):
            break
        if in_section and stripped.startswith("### "):
            items.append(stripped[4:].strip())
    return items


def parse_active_domains(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    in_table = False
    domains: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped == "## Domain status":
            in_table = True
            continue
        if in_table and stripped.startswith("## "):
            break
        if not in_table or not stripped.startswith("|"):
            continue
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        if len(cells) < 3 or cells[0] == "Domain" or set(cells[0]) == {"-"}:
            continue
        if cells[1] == "active":
            domains.append(cells[0])
    return domains


def root_entry_rows(from_file: Path) -> list[list[str]]:
    rows = [
        [
            "SOPHIA docs",
            "Current showcase app docs, architecture, roadmap, and domain status.",
            markdown_link(from_file, load_doc(REPO_ROOT / "docs" / "sophia" / "README.md")),
        ],
        [
            "Restormel docs",
            "Platform strategy, architecture, delivery planning, and reference automation.",
            markdown_link(from_file, load_doc(REPO_ROOT / "docs" / "restormel" / "README.md")),
        ],
        [
            "Documentation hub",
            "Cross-repo docs navigation, active/reference/archive split, and entry points.",
            markdown_link(from_file, load_doc(REPO_ROOT / "docs" / "README.md")),
        ],
        [
            "Archive",
            "Historical plans and superseded materials kept for traceability.",
            markdown_link(from_file, load_doc(REPO_ROOT / "docs" / "archive" / "README.md")),
        ],
    ]
    return rows


def render_root_key_links(from_file: Path) -> str:
    return render_table(["Area", "Why it matters", "Start here"], root_entry_rows(from_file))


def render_root_repo_doc_map(from_file: Path) -> str:
    rows = [
        [
            "Active",
            "SOPHIA",
            str(len(sophia_active_docs())),
            "Showcase app identity, architecture, roadmap, domains, and changelog.",
            markdown_link(from_file, load_doc(REPO_ROOT / "docs" / "sophia" / "README.md")),
        ],
        [
            "Active",
            "Restormel",
            str(sum(len(records) for records in restormel_group_docs().values())),
            "Platform strategy, modularisation, delivery controls, and product planning.",
            markdown_link(from_file, load_doc(REPO_ROOT / "docs" / "restormel" / "README.md")),
        ],
        [
            "Reference",
            "Reference docs",
            str(len(list((REPO_ROOT / "docs" / "reference").rglob("*.md")))),
            "Supporting API, architecture, operations, product, and learning references.",
            markdown_link(from_file, load_doc(REPO_ROOT / "docs" / "reference" / "README.md")),
        ],
        [
            "Archived",
            "Archive",
            str(len(list((REPO_ROOT / "docs" / "archive").rglob("*.md")))),
            "Historical strategy, architecture, delivery, product, and experiment material.",
            markdown_link(from_file, load_doc(REPO_ROOT / "docs" / "archive" / "README.md")),
        ],
    ]
    return render_table(["Status", "Surface", "Docs", "Scope", "Entry point"], rows)


def render_root_repo_structure(from_file: Path) -> str:
    lines: list[str] = []
    for directory, description in ROOT_STRUCTURE.items():
        path = REPO_ROOT / directory
        if path.exists():
            link = relative_link(from_file, path)
            lines.append(f"- [`{directory}/`]({link}) {description}")
    gcp_doc = REPO_ROOT / "docs" / "operations" / "gcp-infrastructure.md"
    deploy_yml = REPO_ROOT / ".github" / "workflows" / "deploy.yml"
    if gcp_doc.is_file() and deploy_yml.is_file():
        lines.append(
            f"- [`docs/operations/gcp-infrastructure.md`]({relative_link(from_file, gcp_doc)}) "
            "— production GCP layout; app deploys via "
            f"[`deploy.yml`]({relative_link(from_file, deploy_yml)}) (`gcloud run deploy`)."
        )
    return "\n".join(lines)


def render_root_current_priorities(_: Path) -> str:
    sophia_priorities = parse_ordered_list_under_heading(
        REPO_ROOT / "docs" / "sophia" / "current-state.md", "## Active priorities"
    )
    restormel_priorities = parse_ordered_list_under_heading(
        REPO_ROOT / "docs" / "restormel" / "04-delivery" / "19-milestone-plan-with-exit-criteria.md",
        "## Priority Order",
    )
    lines = ["### SOPHIA", *[f"{index}. {item}" for index, item in enumerate(sophia_priorities, start=1)], ""]
    lines.extend(["### Restormel", *[f"{index}. {item}" for index, item in enumerate(restormel_priorities, start=1)]])
    return "\n".join(lines)


def render_docs_map(from_file: Path) -> str:
    rows = [
        [
            "SOPHIA",
            "Active",
            str(len(sophia_active_docs())),
            "Showcase/reference app documentation.",
            markdown_link(from_file, load_doc(REPO_ROOT / "docs" / "sophia" / "README.md")),
        ],
        [
            "Restormel",
            "Active",
            str(sum(len(records) for records in restormel_group_docs().values())),
            "Platform planning, architecture, and delivery docs.",
            markdown_link(from_file, load_doc(REPO_ROOT / "docs" / "restormel" / "README.md")),
        ],
        [
            "Reference",
            "Reference",
            str(len(list((REPO_ROOT / "docs" / "reference").rglob("*.md")))),
            "Supporting implementation and operational references.",
            markdown_link(from_file, load_doc(REPO_ROOT / "docs" / "reference" / "README.md")),
        ],
        [
            "Archive",
            "Archived",
            str(len(list((REPO_ROOT / "docs" / "archive").rglob("*.md")))),
            "Historical material preserved for traceability.",
            markdown_link(from_file, load_doc(REPO_ROOT / "docs" / "archive" / "README.md")),
        ],
    ]
    return render_table(["Surface", "Status", "Docs", "Use it for", "Entry point"], rows)


def render_docs_entry_points(from_file: Path) -> str:
    docs = [
        load_doc(REPO_ROOT / "docs" / "sophia" / "README.md"),
        load_doc(REPO_ROOT / "docs" / "sophia" / "current-state.md"),
        load_doc(REPO_ROOT / "docs" / "sophia" / "architecture.md"),
        load_doc(REPO_ROOT / "docs" / "sophia" / "roadmap.md"),
        load_doc(REPO_ROOT / "docs" / "restormel" / "README.md"),
        load_doc(REPO_ROOT / "docs" / "restormel" / "04-delivery" / "19-milestone-plan-with-exit-criteria.md"),
        load_doc(REPO_ROOT / "docs" / "reference" / "README.md"),
        load_doc(REPO_ROOT / "docs" / "archive" / "README.md"),
    ]
    rows = [[doc.title, markdown_link(from_file, doc)] for doc in docs]
    return render_table(["Document", "Link"], rows)


def render_active_vs_archive(from_file: Path) -> str:
    rows = [
        [
            "Active source of truth",
            f"{len(sophia_active_docs())} SOPHIA docs and {sum(len(records) for records in restormel_group_docs().values())} Restormel docs",
            "Update when product, architecture, or delivery meaning changes.",
        ],
        [
            "Supporting reference",
            f"{len(list((REPO_ROOT / 'docs' / 'reference').rglob('*.md')))} docs under docs/reference and {len(restormel_reference_docs())} Restormel reference docs",
            "Use for runbooks, API details, and automation context.",
        ],
        [
            "Archived",
            f"{len(list((REPO_ROOT / 'docs' / 'archive').rglob('*.md')))} docs under docs/archive",
            f"Do not treat as current guidance; start at {markdown_link(from_file, load_doc(REPO_ROOT / 'docs' / 'archive' / 'README.md'))}.",
        ],
    ]
    return render_table(["Class", "Current snapshot", "Operating rule"], rows)


def render_active_restormel_docs(from_file: Path) -> str:
    lines: list[str] = []
    for group, records in restormel_group_docs().items():
        lines.append(f"### {group}")
        for record in records:
            lines.append(f"- {markdown_link(from_file, record)}")
        lines.append("")
    return "\n".join(lines).rstrip()


def render_restormel_delivery_docs(from_file: Path) -> str:
    docs = [
        load_doc(REPO_ROOT / "docs" / "restormel" / "04-delivery" / "07-overarching-implementation-plan.md"),
        load_doc(REPO_ROOT / "docs" / "restormel" / "04-delivery" / "08-phased-programmes-of-work.md"),
        load_doc(REPO_ROOT / "docs" / "restormel" / "04-delivery" / "18-concrete-launch-sequence-restormel-dev.md"),
        load_doc(REPO_ROOT / "docs" / "restormel" / "04-delivery" / "19-milestone-plan-with-exit-criteria.md"),
        load_doc(REPO_ROOT / "docs" / "restormel" / "04-delivery" / "20-engineering-backlog-by-epic.md"),
        load_doc(REPO_ROOT / "docs" / "restormel" / "05-design" / "21-design-backlog-by-surface.md"),
        load_doc(REPO_ROOT / "docs" / "restormel" / "07-monetisation" / "22-monetisation-strategies-by-product.md"),
    ]
    rows = [
        [
            doc.title,
            doc.last_reviewed or "-",
            markdown_link(from_file, doc),
        ]
        for doc in docs
    ]
    return render_table(["Document", "Last reviewed", "Link"], rows)


def render_restormel_reference_docs(from_file: Path) -> str:
    rows = []
    for doc in restormel_reference_docs():
        rows.append([doc.title, doc.last_reviewed or "-", markdown_link(from_file, doc)])
    return render_table(["Document", "Last reviewed", "Link"], rows)


def render_sophia_key_links(from_file: Path) -> str:
    docs = [
        load_doc(REPO_ROOT / "docs" / "sophia" / "current-state.md"),
        load_doc(REPO_ROOT / "docs" / "sophia" / "architecture.md"),
        load_doc(REPO_ROOT / "docs" / "sophia" / "product-role.md"),
        load_doc(REPO_ROOT / "docs" / "sophia" / "roadmap.md"),
        load_doc(REPO_ROOT / "docs" / "sophia" / "domain-expansion.md"),
        load_doc(REPO_ROOT / "docs" / "sophia" / "changelog.md"),
        load_doc(REPO_ROOT / "docs" / "restormel" / "README.md"),
    ]
    rows = [[doc.title, markdown_link(from_file, doc)] for doc in docs]
    return render_table(["Document", "Link"], rows)


def render_active_sophia_docs(from_file: Path) -> str:
    rows = []
    for doc in sophia_active_docs():
        rows.append([doc.title, doc.last_reviewed or "-", markdown_link(from_file, doc)])
    return render_table(["Document", "Last reviewed", "Link"], rows)


def render_sophia_current_focus(_: Path) -> str:
    priorities = parse_ordered_list_under_heading(
        REPO_ROOT / "docs" / "sophia" / "current-state.md", "## Active priorities"
    )
    roadmap_themes = parse_theme_headings(REPO_ROOT / "docs" / "sophia" / "roadmap.md", "## Current roadmap themes")
    active_domains = parse_active_domains(REPO_ROOT / "docs" / "sophia" / "domain-expansion.md")
    lines = ["### Active priorities", *[f"{index}. {item}" for index, item in enumerate(priorities, start=1)], ""]
    lines.append("### Roadmap themes")
    lines.extend(f"- {theme}" for theme in roadmap_themes)
    lines.append("")
    lines.append("### Live showcase domains")
    lines.extend(f"- {domain}" for domain in active_domains)
    return "\n".join(lines)


def replace_block(text: str, block_name: str, rendered: str, path: Path) -> tuple[str, bool]:
    start_marker = BLOCK_START.format(name=block_name)
    end_marker = BLOCK_END.format(name=block_name)
    if start_marker not in text or end_marker not in text:
        raise ValueError(f"{path}: missing required markers for block '{block_name}'")

    pattern = re.compile(
        rf"(?P<start>{re.escape(start_marker)}\n)(?P<body>.*?)(?P<end>\n{re.escape(end_marker)})",
        flags=re.DOTALL,
    )
    match = pattern.search(text)
    if not match:
        raise ValueError(f"{path}: could not parse block '{block_name}'")

    replacement = f"{match.group('start')}{rendered.rstrip()}{match.group('end')}"
    updated = text[: match.start()] + replacement + text[match.end() :]
    return updated, updated != text


def process_file(path: Path, block_map: OrderedDict[str, str], write: bool) -> bool:
    text = path.read_text(encoding="utf-8")
    changed = False
    updated = text
    for block_name, renderer_name in block_map.items():
        renderer = globals()[renderer_name]
        rendered = renderer(path)
        updated, block_changed = replace_block(updated, block_name, rendered, path)
        changed = changed or block_changed

    if write and changed:
        path.write_text(updated, encoding="utf-8")
    return changed


def main() -> int:
    parser = argparse.ArgumentParser(description="Update targeted generated repo documentation blocks")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="Fail if generated blocks are stale")
    mode.add_argument("--write", action="store_true", help="Rewrite generated blocks in place")
    args = parser.parse_args()

    stale_files: list[str] = []
    for relative_path, block_map in TARGETS.items():
        path = REPO_ROOT / relative_path
        changed = process_file(path, block_map, write=args.write)
        if changed:
            stale_files.append(str(relative_path))

    if args.check and stale_files:
        print("Generated documentation blocks are stale:")
        for stale_file in stale_files:
            print(f"  - {stale_file}")
        print("\nRun `python3 scripts/restormel/update_repo_docs.py --write` to refresh them.")
        return 1

    if args.write:
        if stale_files:
            print("Updated generated documentation blocks:")
            for stale_file in stale_files:
                print(f"  - {stale_file}")
        else:
            print("Generated documentation blocks already up to date.")
        return 0

    print("Generated documentation blocks are up to date.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
