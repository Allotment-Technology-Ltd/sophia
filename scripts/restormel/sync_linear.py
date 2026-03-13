#!/usr/bin/env python3
"""One-way sync from Restormel docs to Linear issues.

Scope for first iteration:
- Parse milestones, epics, and design surfaces from delivery docs.
- Create/update Linear issues in a deterministic way.
- Persist created IDs in docs/restormel/meta/linear-map.yml to prevent duplicates.

TODO:
- Add explicit Linear project/milestone entity sync when API interactions are validated.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]


def resolve_docs_root() -> Path:
    for candidate in (REPO_ROOT / "docs" / "restormel", REPO_ROOT / "docs" / "Restormel"):
        if candidate.exists():
            return candidate
    return REPO_ROOT / "docs" / "restormel"


DOCS_ROOT = resolve_docs_root()
META_ROOT = DOCS_ROOT / "meta"
LINEAR_MAP_PATH = META_ROOT / "linear-map.yml"
OWNERS_PATH = META_ROOT / "owners.yml"
MILESTONES_PATH = META_ROOT / "milestones.yml"
LINEAR_CONFIG_PATH = META_ROOT / "linear-config.yml"

DELIVERY_DOCS = {
    "milestone": DOCS_ROOT / "04-delivery/19-milestone-plan-with-exit-criteria.md",
    "epic": DOCS_ROOT / "04-delivery/20-engineering-backlog-by-epic.md",
    "surface": DOCS_ROOT / "05-design/21-design-backlog-by-surface.md",
    "stage": DOCS_ROOT / "04-delivery/18-concrete-launch-sequence-restormel-dev.md",
}

HEADING_PATTERNS = {
    "milestone": re.compile(r"^##\s+Milestone:\s*(.+?)\s*$"),
    "epic": re.compile(r"^##\s+Epic:\s*(.+?)\s*$"),
    "surface": re.compile(r"^##\s+Surface:\s*(.+?)\s*$"),
    "stage": re.compile(r"^##\s+Stage\s+(\d+):\s*(.+?)\s*$"),
}
UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


class SyncError(Exception):
    """Raised for actionable sync failures."""


@dataclass
class BacklogItem:
    key: str
    kind: str
    title: str
    source_doc: str
    source_heading: str
    owner_key: str
    doc_type: str
    parent_key: str | None = None
    stage_number: int | None = None


@dataclass
class ProjectDefinition:
    key: str
    name: str
    description: str
    priority: int
    doc_paths: list[str]
    kinds: list[str]
    keywords: list[str]


@dataclass
class LinearConfig:
    default_project: str
    priority_default: int
    task_limit: int
    doc_type_project_map: dict[str, str]
    stage_project_map: dict[int, str]
    milestone_project_map: dict[str, str]
    projects: list[ProjectDefinition]


class SimpleYaml:
    """Very small YAML subset parser for repo-controlled config files."""

    @staticmethod
    def parse(text: str) -> Any:
        lines = text.splitlines()
        return SimpleYaml._parse_block(lines, 0, 0)[0]

    @staticmethod
    def _parse_block(lines: list[str], start_idx: int, indent: int) -> tuple[Any, int]:
        idx = start_idx
        container: Any = None

        while idx < len(lines):
            raw = lines[idx]
            clean = raw.rstrip("\n")
            stripped = clean.strip()

            if not stripped or stripped.startswith("#"):
                idx += 1
                continue

            current_indent = len(clean) - len(clean.lstrip(" "))
            if current_indent < indent:
                break
            if current_indent > indent and container is None:
                raise SyncError(f"Invalid indentation near line: {raw}")
            if current_indent > indent:
                break

            token = clean[indent:]

            if token.startswith("- "):
                if container is None:
                    container = []
                if not isinstance(container, list):
                    raise SyncError(f"Mixed list/dict YAML structure near line: {raw}")
                value_text = token[2:].strip()
                if value_text:
                    container.append(SimpleYaml._parse_scalar(value_text))
                    idx += 1
                    continue

                nested, next_idx = SimpleYaml._parse_block(lines, idx + 1, indent + 2)
                container.append(nested)
                idx = next_idx
                continue

            if ":" not in token:
                raise SyncError(f"Unsupported YAML line: {raw}")

            if container is None:
                container = {}
            if not isinstance(container, dict):
                raise SyncError(f"Mixed list/dict YAML structure near line: {raw}")

            key, rest = token.split(":", 1)
            key = key.strip()
            rest = rest.strip()

            if not rest:
                nested, next_idx = SimpleYaml._parse_block(lines, idx + 1, indent + 2)
                container[key] = nested
                idx = next_idx
                continue

            container[key] = SimpleYaml._parse_scalar(rest)
            idx += 1

        if container is None:
            container = {}
        return container, idx

    @staticmethod
    def _parse_scalar(value: str) -> Any:
        v = value.strip()
        if v in ("{}", "{ }"):
            return {}
        if v in ("[]", "[ ]"):
            return []
        if v.startswith(('"', "'")) and v.endswith(('"', "'")):
            return v[1:-1]
        low = v.lower()
        if low == "true":
            return True
        if low == "false":
            return False
        if re.fullmatch(r"-?\d+", v):
            return int(v)
        return v


def parse_front_matter(path: Path) -> tuple[dict[str, str], str]:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, text

    metadata: dict[str, str] = {}
    end_idx = None
    for idx in range(1, len(lines)):
        line = lines[idx].strip()
        if line == "---":
            end_idx = idx
            break
        if not line or line.startswith("#") or ":" not in line:
            continue
        key, value = line.split(":", 1)
        metadata[key.strip()] = value.strip().strip('"\'')

    if end_idx is None:
        raise SyncError(f"{path}: front matter block is not closed")

    body = "\n".join(lines[end_idx + 1 :])
    return metadata, body


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return slug or "item"


def extract_items(kind: str, path: Path, task_limit: int) -> list[BacklogItem]:
    metadata, body = parse_front_matter(path)
    sync_to_linear = str(metadata.get("sync_to_linear", "false")).lower() == "true"
    if not sync_to_linear:
        return []

    owner_key = metadata.get("owner", "")
    doc_type = metadata.get("doc_type", "")
    heading_re = HEADING_PATTERNS[kind]
    rel_doc = str(path.relative_to(DOCS_ROOT))

    items: list[BacklogItem] = []
    current_item: BacklogItem | None = None
    child_counts: dict[str, int] = {}
    last_subheading = ""

    for raw_line in body.splitlines():
        stripped = raw_line.strip()
        match = heading_re.match(stripped)
        if match:
            if kind == "stage":
                stage_num = int(match.group(1))
                title = match.group(2).strip()
            else:
                stage_num = None
                title = match.group(1).strip()

            identity = f"{kind}:{rel_doc}#{slugify(title)}"
            current_item = BacklogItem(
                key=identity,
                kind=kind,
                title=title,
                source_doc=rel_doc,
                source_heading=stripped,
                owner_key=owner_key,
                doc_type=doc_type,
                stage_number=stage_num,
            )
            items.append(current_item)
            child_counts[current_item.key] = 0
            last_subheading = stripped
            continue

        if stripped.startswith("###"):
            last_subheading = stripped
            continue

        if not current_item:
            continue

        bullet_match = re.match(r"^[-+*]\s+(.*)", stripped)
        if not bullet_match:
            continue

        if child_counts.get(current_item.key, 0) >= task_limit:
            continue

        task_text = bullet_match.group(1).strip()
        if not task_text:
            continue

        task_key = f"task:{rel_doc}#{slugify(task_text)}"
        heading_context = last_subheading or current_item.source_heading
        task_item = BacklogItem(
            key=task_key,
            kind="task",
            title=task_text,
            source_doc=current_item.source_doc,
            source_heading=heading_context,
            owner_key=owner_key,
            doc_type=doc_type,
            parent_key=current_item.key,
            stage_number=current_item.stage_number,
        )
        items.append(task_item)
        child_counts[current_item.key] = child_counts.get(current_item.key, 0) + 1

    return items


def read_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    parsed = SimpleYaml.parse(path.read_text(encoding="utf-8"))
    if not isinstance(parsed, dict):
        raise SyncError(f"{path}: expected top-level YAML mapping")
    return parsed

def _coerce_str_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def load_linear_config() -> LinearConfig:
    if not LINEAR_CONFIG_PATH.exists():
        raise SyncError(f"Missing linear config at {LINEAR_CONFIG_PATH}")

    raw = read_yaml(LINEAR_CONFIG_PATH)
    if not raw:
        raise SyncError(f"{LINEAR_CONFIG_PATH} is empty or invalid")

    default_project = str(raw.get("default_project", "")).strip()
    if not default_project:
        raise SyncError("linear-config.yml must declare a default_project")

    priority_default = int(raw.get("priority_default", 3))
    task_limits = raw.get("task_limits", {})
    task_limit = int(task_limits.get("max_children_per_item", 3)) if isinstance(task_limits, dict) else 3
    if task_limit < 1:
        task_limit = 3

    doc_type_project_map = {}
    for doc_type, project_key in (raw.get("doc_type_project_map") or {}).items():
        if not doc_type:
            continue
        doc_type_project_map[str(doc_type).strip()] = str(project_key).strip()

    stage_project_map_raw = raw.get("stage_project_map", {})
    stage_project_map: dict[int, str] = {}
    if isinstance(stage_project_map_raw, dict):
        for stage_key, project_key in stage_project_map_raw.items():
            try:
                stage_number = int(stage_key)
            except (TypeError, ValueError):
                continue
            if not project_key:
                continue
            stage_project_map[stage_number] = str(project_key).strip()

    milestone_project_map = {}
    for milestone, project_key in (raw.get("milestone_project_map") or {}).items():
        if not milestone or not project_key:
            continue
        milestone_project_map[str(milestone).strip()] = str(project_key).strip()

    project_defs: list[ProjectDefinition] = []
    for entry in raw.get("projects", []):
        if not isinstance(entry, dict):
            continue
        key = str(entry.get("key", "")).strip()
        name = str(entry.get("name", "")).strip()
        description = str(entry.get("description", "")).strip()
        priority = int(entry.get("priority", priority_default))
        doc_paths = _coerce_str_list(entry.get("doc_paths"))
        kinds = [k.strip().lower() for k in _coerce_str_list(entry.get("kinds"))]
        keywords = [k.strip().lower() for k in _coerce_str_list(entry.get("keywords"))]
        if not key or not name:
            continue
        project_defs.append(
            ProjectDefinition(
                key=key,
                name=name,
                description=description,
                priority=priority,
                doc_paths=doc_paths,
                kinds=kinds,
                keywords=keywords,
            )
        )

    if not any(defn.key == default_project for defn in project_defs):
        raise SyncError(f"default_project '{default_project}' is not declared in linear-config.yml projects")

    return LinearConfig(
        default_project=default_project,
        priority_default=priority_default,
        task_limit=task_limit,
        doc_type_project_map=doc_type_project_map,
        stage_project_map=stage_project_map,
        milestone_project_map=milestone_project_map,
        projects=project_defs,
    )


def dump_linear_map(data: dict[str, Any]) -> str:
    now = dt.date.today().isoformat()
    items = data.get("items", {})
    if not isinstance(items, dict):
        raise SyncError("linear-map.yml items must be a mapping")

    out: list[str] = [
        "# Linear mapping state for one-way sync from docs/restormel -> Linear.",
        "# This file is updated by scripts/restormel/sync_linear.py.",
        "",
        f"version: {data.get('version', 1)}",
        f"updated_at: {now}",
    ]

    if not items:
        out.append("items: {}")
        return "\n".join(out) + "\n"

    out.append("items:")
    for key in sorted(items.keys()):
        entry = items[key]
        if not isinstance(entry, dict):
            continue
        out.append(f"  {key}:")
        for field in (
            "issue_id",
            "issue_identifier",
            "issue_url",
            "kind",
            "title",
            "source_doc",
            "source_heading",
            "updated_at",
        ):
            value = str(entry.get(field, "")).replace('"', "'")
            out.append(f"    {field}: \"{value}\"")

    return "\n".join(out) + "\n"


def determine_project_for_item(item: BacklogItem, config: LinearConfig) -> str:
    lower_doc = item.source_doc.lower()
    lower_title = item.title.lower()

    if item.kind == "stage" and item.stage_number is not None:
        stage_project = config.stage_project_map.get(item.stage_number)
        if stage_project:
            return stage_project

    by_doc_type = config.doc_type_project_map.get(item.doc_type)
    if by_doc_type:
        return by_doc_type

    for project in config.projects:
        if project.kinds and item.kind not in project.kinds:
            continue

        for doc_path in project.doc_paths:
            normalized = doc_path.strip().lower()
            if not normalized:
                continue
            if lower_doc == normalized or lower_doc.startswith(normalized):
                return project.key

        for keyword in project.keywords:
            if not keyword:
                continue
            if keyword in lower_title or keyword in lower_doc:
                return project.key

    return config.default_project


def assign_projects_to_items(items: list[BacklogItem], config: LinearConfig) -> dict[str, str]:
    assignment: dict[str, str] = {}
    for item in items:
        if item.kind == "task" and item.parent_key:
            parent_project = assignment.get(item.parent_key)
            if parent_project:
                assignment[item.key] = parent_project
                continue
        assignment[item.key] = determine_project_for_item(item, config)
    return assignment


class LinearClient:
    def __init__(self, api_key: str):
        self.api_key = api_key

    def query(self, query: str, variables: dict[str, Any]) -> dict[str, Any]:
        payload = json.dumps({"query": query, "variables": variables}).encode("utf-8")
        request = urllib.request.Request(
            "https://api.linear.app/graphql",
            data=payload,
            headers={
                "Authorization": self.api_key,
                "Content-Type": "application/json",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                body = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise SyncError(f"Linear API request failed: HTTP {exc.code} {detail}") from exc
        except urllib.error.URLError as exc:
            raise SyncError(f"Linear API request failed: {exc}") from exc

        if body.get("errors"):
            raise SyncError(f"Linear API returned errors: {body['errors']}")
        return body.get("data", {})

    def resolve_label_ids(self, team_id: str, label_names: list[str]) -> list[str]:
        if not label_names:
            return []

        query = """
        query TeamLabels($teamId: String!) {
          team(id: $teamId) {
            labels(first: 250) {
              nodes {
                id
                name
              }
            }
          }
        }
        """
        data = self.query(query, {"teamId": team_id})
        nodes = (
            data.get("team", {})
            .get("labels", {})
            .get("nodes", [])
        )
        by_name = {str(node.get("name", "")).lower(): node.get("id") for node in nodes}

        resolved: list[str] = []
        for name in label_names:
            label_id = by_name.get(name.lower())
            if label_id:
                resolved.append(label_id)
        return resolved

    def resolve_team_id(self, team_id_or_key: str) -> str:
        if UUID_RE.fullmatch(team_id_or_key):
            return team_id_or_key

        query = """
        query ViewerTeams {
          viewer {
            teams(first: 200) {
              nodes {
                id
                key
                name
              }
            }
          }
        }
        """
        data = self.query(query, {})
        nodes = (
            data.get("viewer", {})
            .get("teams", {})
            .get("nodes", [])
        )
        for node in nodes:
            key = str(node.get("key", "")).strip().lower()
            name = str(node.get("name", "")).strip().lower()
            if team_id_or_key.lower() in (key, name):
                team_id = str(node.get("id", "")).strip()
                if team_id:
                    return team_id

        raise SyncError(
            f"Could not resolve LINEAR_TEAM_ID='{team_id_or_key}' to a UUID. "
            "Provide a UUID team ID or a valid team key/name visible to the API token."
        )

    def list_projects(self, team_id: str) -> list[dict[str, str]]:
        query = """
        query TeamProjects($teamId: String!) {
          team(id: $teamId) {
            projects(first: 250) {
              nodes {
                id
                name
                description
                url
              }
            }
          }
        }
        """
        data = self.query(query, {"teamId": team_id})
        nodes = (
            data.get("team", {})
            .get("projects", {})
            .get("nodes", [])
        )
        return [
            {
                "id": str(node.get("id", "")),
                "name": str(node.get("name", "")),
                "description": str(node.get("description", "")),
                "url": str(node.get("url", "")),
            }
            for node in nodes
            if isinstance(node, dict) and node.get("id")
        ]

    def create_project(self, *, team_id: str, name: str, description: str | None = None) -> dict[str, str]:
        mutation = """
        mutation CreateProject($input: ProjectCreateInput!) {
          projectCreate(input: $input) {
            success
            project {
              id
              name
              url
            }
          }
        }
        """
        payload: dict[str, Any] = {"teamId": team_id, "name": name}
        if description:
            payload["description"] = description

        data = self.query(mutation, {"input": payload})
        created = data.get("projectCreate", {}).get("project", {})
        project_id = str(created.get("id", ""))
        if not project_id:
            raise SyncError(f"Linear projectCreate returned no project for '{name}'")
        return {
            "project_id": project_id,
            "name": str(created.get("name", "")),
            "url": str(created.get("url", "")),
        }

    def list_project_milestones(self, project_id: str) -> list[dict[str, str]]:
        query = """
        query ProjectMilestones($projectId: String!, $first: Int!) {
          project(id: $projectId) {
            projectMilestones(first: $first) {
              nodes {
                id
                name
              }
            }
          }
        }
        """
        data = self.query(query, {"projectId": project_id, "first": 100})
        nodes = (
            data.get("project", {})
            .get("projectMilestones", {})
            .get("nodes", [])
        )
        return [
            {
                "id": str(node.get("id", "")),
                "name": str(node.get("name", "")),
            }
            for node in nodes
            if isinstance(node, dict) and node.get("id")
        ]

    def create_project_milestone(
        self,
        *,
        project_id: str,
        name: str,
        description: str | None = None,
    ) -> dict[str, str]:
        mutation = """
        mutation CreateProjectMilestone($input: ProjectMilestoneCreateInput!) {
          projectMilestoneCreate(input: $input) {
            success
            projectMilestone {
              id
              name
            }
          }
        }
        """
        payload: dict[str, Any] = {"projectId": project_id, "name": name}
        if description:
            payload["description"] = description

        data = self.query(mutation, {"input": payload})
        created = data.get("projectMilestoneCreate", {}).get("projectMilestone", {})
        milestone_id = str(created.get("id", ""))
        if not milestone_id:
            raise SyncError(f"Linear projectMilestoneCreate returned no milestone for '{name}'")
        return {
            "project_milestone_id": milestone_id,
            "name": str(created.get("name", "")),
        }

    def create_issue(
        self,
        *,
        team_id: str,
        title: str,
        description: str,
        assignee_id: str | None,
        label_ids: list[str],
        project_id: str | None,
        priority: int | None = None,
    ) -> dict[str, str]:
        mutation = """
        mutation CreateIssue($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            success
            issue {
              id
              identifier
              url
            }
          }
        }
        """

        issue_input: dict[str, Any] = {
            "teamId": team_id,
            "title": title,
            "description": description,
        }
        if assignee_id:
            issue_input["assigneeId"] = assignee_id
        if label_ids:
            issue_input["labelIds"] = label_ids
        if project_id:
            issue_input["projectId"] = project_id
        if priority is not None:
            issue_input["priority"] = priority

        data = self.query(mutation, {"input": issue_input})
        created = data.get("issueCreate", {}).get("issue", {})
        if not created.get("id"):
            raise SyncError(f"Linear issueCreate returned no issue for '{title}'")
        return {
            "issue_id": str(created.get("id", "")),
            "issue_identifier": str(created.get("identifier", "")),
            "issue_url": str(created.get("url", "")),
        }

    def update_issue(
        self,
        *,
        issue_id: str,
        title: str,
        description: str,
        assignee_id: str | None,
        project_id: str | None,
        priority: int | None = None,
    ) -> None:
        mutation = """
        mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
          issueUpdate(id: $id, input: $input) {
            success
          }
        }
        """

        issue_input: dict[str, Any] = {
            "title": title,
            "description": description,
        }
        if assignee_id:
            issue_input["assigneeId"] = assignee_id
        if project_id:
            issue_input["projectId"] = project_id
        if priority is not None:
            issue_input["priority"] = priority

        self.query(mutation, {"id": issue_id, "input": issue_input})


def build_description(item: BacklogItem, parent_entry: dict[str, Any] | None = None) -> str:
    lines = [
        f"Synced from Restormel docs (`{item.kind}`).",
        "",
        f"- Source doc: `docs/restormel/{item.source_doc}`",
        f"- Source heading: `{item.source_heading}`",
        "- Direction: GitHub docs -> Linear (one-way)",
    ]
    if parent_entry:
        _append_parent_context(lines, parent_entry)
    return "\n".join(lines)


def _append_parent_context(lines: list[str], parent_entry: dict[str, Any]) -> None:
    parent_title = parent_entry.get("title")
    parent_url = parent_entry.get("issue_url")
    if parent_title and parent_url:
        lines.append(f"- Parent issue: `{parent_title}`")
        lines.append(f"- Parent link: {parent_url}")


def build_issue_title(item: BacklogItem, project_prefix: str) -> str:
    kind_label = {
        "milestone": "Milestone",
        "epic": "Epic",
        "surface": "Design Surface",
        "stage": "Launch Stage",
        "task": "Task",
    }.get(item.kind, item.kind.capitalize())
    title = f"[{kind_label}] {item.title}"
    if project_prefix:
        return f"{project_prefix} | {title}"
    return title


def write_summary(report: list[str]) -> None:
    summary_path = os.getenv("GITHUB_STEP_SUMMARY")
    if not summary_path:
        return
    Path(summary_path).write_text("\n".join(report) + "\n", encoding="utf-8")


def required_env(name: str, fallback: str | None = None) -> str:
    value = os.getenv(name, "").strip()
    if value:
        return value
    if fallback and fallback.strip() and not fallback.startswith("TODO_"):
        return fallback.strip()
    raise SyncError(
        f"Missing required setting '{name}'. Set it in environment variables or metadata config."
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync Restormel docs backlog into Linear")
    parser.add_argument(
        "--mode",
        choices=("dry-run", "create", "update", "create-update"),
        default="dry-run",
        help="dry-run prints planned actions; other modes call Linear API",
    )
    parser.add_argument(
        "--github-summary",
        action="store_true",
        help="Write markdown summary to GITHUB_STEP_SUMMARY when available.",
    )
    args = parser.parse_args()

    owners_cfg = read_yaml(OWNERS_PATH)
    milestones_cfg = read_yaml(MILESTONES_PATH)
    linear_map = read_yaml(LINEAR_MAP_PATH)

    linear_defaults = owners_cfg.get("linear_defaults", {})
    if not isinstance(linear_defaults, dict):
        linear_defaults = {}

    owners_map = owners_cfg.get("owners", {})
    if not isinstance(owners_map, dict):
        owners_map = {}

    linear_map.setdefault("version", 1)
    linear_map.setdefault("items", {})
    if not isinstance(linear_map["items"], dict):
        raise SyncError(f"{LINEAR_MAP_PATH}: items must be a mapping")

    team_id = required_env("LINEAR_TEAM_ID", str(linear_defaults.get("team_id", "")))
    project_prefix = os.getenv("LINEAR_PROJECT_PREFIX", "").strip() or str(
        linear_defaults.get("project_prefix", "")
    ).strip()
    project_id = os.getenv("LINEAR_PROJECT_ID", "").strip() or None
    default_assignee = os.getenv("LINEAR_DEFAULT_ASSIGNEE", "").strip() or None

    labels_raw = os.getenv("LINEAR_LABELS", "").strip()
    if labels_raw:
        label_names = [name.strip() for name in labels_raw.split(",") if name.strip()]
    else:
        default_labels = linear_defaults.get("labels", [])
        label_names = [str(x).strip() for x in default_labels if str(x).strip()] if isinstance(default_labels, list) else []

    items: list[BacklogItem] = []
    for kind, path in DELIVERY_DOCS.items():
        if not path.exists():
            raise SyncError(f"Expected delivery doc not found: {path}")
        items.extend(extract_items(kind, path))

    canonical_milestones = milestones_cfg.get("milestones", [])
    if isinstance(canonical_milestones, list):
        expected = {str(m) for m in canonical_milestones}
        seen = {item.title for item in items if item.kind == "milestone"}
        missing = sorted(expected - seen)
        if missing:
            print("Warning: canonical milestones missing in parsed headings:")
            for name in missing:
                print(f"  - {name}")

    if not items:
        print("No syncable items found. Check sync_to_linear front matter and heading format.")
        return 0

    apply_mode = args.mode != "dry-run"
    client: LinearClient | None = None
    label_ids: list[str] = []

    if apply_mode:
        api_key = os.getenv("LINEAR_API_KEY", "").strip()
        if not api_key:
            raise SyncError(
                "Missing required env var LINEAR_API_KEY for apply mode. Use --mode dry-run to preview."
            )
        client = LinearClient(api_key)
        team_id = client.resolve_team_id(team_id)
        try:
            label_ids = client.resolve_label_ids(team_id, label_names)
        except SyncError as err:
            print(f"Warning: label resolution skipped ({err})")
            label_ids = []

    created_count = 0
    updated_count = 0
    unchanged_count = 0

    summary_lines = [
        "## Linear Sync",
        "",
        f"Mode: `{args.mode}`",
        f"Items parsed: `{len(items)}`",
        "",
    ]

    for item in items:
        assignee_id = None
        owner_assignee = str(owners_map.get(item.owner_key, "")).strip()
        if owner_assignee and not owner_assignee.startswith("TODO_"):
            assignee_id = owner_assignee
        elif default_assignee:
            assignee_id = default_assignee

        title = build_issue_title(item, project_prefix)
        description = build_description(item)

        mapped = linear_map["items"].get(item.key, {})
        mapped_issue_id = str(mapped.get("issue_id", "")).strip() if isinstance(mapped, dict) else ""

        if mapped_issue_id:
            if args.mode in ("update", "create-update"):
                assert client is not None
                client.update_issue(
                    issue_id=mapped_issue_id,
                    title=title,
                    description=description,
                    assignee_id=assignee_id,
                    project_id=project_id,
                )
                updated_count += 1
                print(f"UPDATED {item.key} -> {mapped_issue_id}")
                summary_lines.append(f"- Updated `{item.key}`")
            else:
                unchanged_count += 1
                print(f"SKIP(existing) {item.key} -> {mapped_issue_id}")
                summary_lines.append(f"- Kept existing `{item.key}`")
            continue

        if args.mode not in ("create", "create-update"):
            print(f"PLAN(create) {item.key} title='{title}'")
            summary_lines.append(f"- Plan create `{item.key}`")
            continue

        assert client is not None
        created = client.create_issue(
            team_id=team_id,
            title=title,
            description=description,
            assignee_id=assignee_id,
            label_ids=label_ids,
            project_id=project_id,
        )

        linear_map["items"][item.key] = {
            "issue_id": created["issue_id"],
            "issue_identifier": created["issue_identifier"],
            "issue_url": created["issue_url"],
            "kind": item.kind,
            "title": item.title,
            "source_doc": item.source_doc,
            "source_heading": item.source_heading,
            "updated_at": dt.date.today().isoformat(),
        }
        created_count += 1
        print(f"CREATED {item.key} -> {created['issue_identifier']} ({created['issue_url']})")
        summary_lines.append(f"- Created `{item.key}` as `{created['issue_identifier']}`")

    if apply_mode and created_count > 0:
        LINEAR_MAP_PATH.write_text(dump_linear_map(linear_map), encoding="utf-8")
        print(f"Updated mapping file: {LINEAR_MAP_PATH}")

    summary_lines.extend(
        [
            "",
            f"Created: `{created_count}`",
            f"Updated: `{updated_count}`",
            f"Unchanged: `{unchanged_count}`",
        ]
    )

    if args.github_summary:
        write_summary(summary_lines)

    print("\nSync summary")
    print(f"  created:   {created_count}")
    print(f"  updated:   {updated_count}")
    print(f"  unchanged: {unchanged_count}")

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SyncError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
