#!/usr/bin/env bash
# Create a Sophia issue with label restormel-feedback (triggers relay to restormel-keys).
# Requires: gh CLI, gh auth login, label restormel-feedback on the target repo.
set -euo pipefail

REPO="${SOPHIA_GH_REPO:-Allotment-Technology-Ltd/sophia}"
LABEL="restormel-feedback"

usage() {
  echo "Usage: $0 --title <string> (--body-file <path> | pipe body to stdin)" >&2
  echo "  Override repo: SOPHIA_GH_REPO=owner/name $0 ..." >&2
  exit 1
}

title=""
body_file=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --title)
      title="${2:-}"
      shift 2
      ;;
    --body-file)
      body_file="${2:-}"
      shift 2
      ;;
    -h | --help)
      usage
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage
      ;;
  esac
done

if [[ -z "$title" ]]; then
  echo "error: --title is required" >&2
  usage
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI not found. Install https://cli.github.com/ and run gh auth login" >&2
  exit 1
fi

if [[ -n "$body_file" ]]; then
  if [[ ! -f "$body_file" ]]; then
    echo "error: body file not found: $body_file" >&2
    exit 1
  fi
  gh issue create --repo "$REPO" --title "$title" --body-file "$body_file" --label "$LABEL"
else
  if [[ -t 0 ]]; then
    echo "error: provide --body-file or pipe issue body on stdin" >&2
    usage
  fi
  gh issue create --repo "$REPO" --title "$title" --body-file - --label "$LABEL"
fi
