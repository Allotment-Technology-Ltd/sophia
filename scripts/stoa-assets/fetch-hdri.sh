#!/usr/bin/env bash
set -euo pipefail

# Guide-first script for Stoa HDRI acquisition from Poly Haven.
# By default this prints the recommended workflow and commands.
# Pass --execute to run the download commands.

ASSET_SLUG="${ASSET_SLUG:-kloofendal_48d_partly_cloudy}"
TARGET_PATH="static/hdri/mediterranean-sky.hdr"
TMP_JSON="tmp/polyhaven-${ASSET_SLUG}.json"

print_guide() {
  echo "Stoa HDRI acquisition guide (Poly Haven API, CC0)"
  echo
  echo "License:"
  echo "  Poly Haven assets are CC0: https://polyhaven.com/license"
  echo
  echo "Recommended API workflow:"
  echo "  1) Inspect HDRI catalog:"
  echo "     curl -fsSL \"https://api.polyhaven.com/assets?t=hdris\" | jq 'keys[]'"
  echo
  echo "  2) Choose a warm Mediterranean-style sky slug (default: ${ASSET_SLUG})."
  echo
  echo "  3) Fetch file metadata for the slug:"
  echo "     curl -fsSL \"https://api.polyhaven.com/files/${ASSET_SLUG}\" -o \"${TMP_JSON}\""
  echo
  echo "  4) Inspect JSON and extract a 2K .hdr URL."
  echo "     Example jq pattern (verify against live JSON):"
  echo "     jq -r '.. | objects | .url? // empty | select(test(\"\\\\.hdr($|\\\\?)\")) | select(test(\"2k|2K\"))' \"${TMP_JSON}\""
  echo
  echo "  5) Download and place into:"
  echo "     ${TARGET_PATH}"
  echo
  echo "  6) If only .exr is available, convert:"
  echo "     magick input.exr \"${TARGET_PATH}\""
  echo
  echo "Safety note: no files are downloaded unless you run with --execute."
}

execute_download() {
  if ! command -v curl >/dev/null 2>&1; then
    echo "error: curl is required" >&2
    exit 1
  fi
  if ! command -v jq >/dev/null 2>&1; then
    echo "error: jq is required for JSON parsing" >&2
    exit 1
  fi

  mkdir -p tmp static/hdri

  echo "Fetching Poly Haven metadata for ${ASSET_SLUG}..."
  curl -fsSL "https://api.polyhaven.com/files/${ASSET_SLUG}" -o "${TMP_JSON}"

  local url
  url="$(jq -r '.. | objects | .url? // empty | select(test("\\.hdr($|\\?)")) | select(test("2k|2K"))' "${TMP_JSON}" | head -n 1)"

  if [[ -z "${url}" ]]; then
    echo "error: could not determine a 2K HDR URL automatically." >&2
    echo "Inspect ${TMP_JSON} and set HDR_URL manually." >&2
    exit 1
  fi

  echo "Downloading 2K HDRI to ${TARGET_PATH}..."
  curl -fL "${url}" -o "${TARGET_PATH}"
  echo "Done. Verify lighting in scene and keep Poly Haven CC0 attribution note in docs."
}

if [[ "${1:-}" == "--execute" ]]; then
  execute_download
else
  print_guide
fi
