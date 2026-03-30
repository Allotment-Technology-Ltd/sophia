#!/usr/bin/env bash
set -euo pipefail

# Guide-only script for Stoa ambient audio acquisition.
# This script does NOT download files; it prints recommended sources,
# licensing checks, target paths, and conversion commands.

print_asset() {
  local asset_id="$1"
  local source="$2"
  local license_note="$3"
  local target="$4"
  local ffmpeg_cmd="$5"

  echo "--------------------------------------------------------------------------------"
  echo "Asset: ${asset_id}"
  echo "Source suggestion: ${source}"
  echo "License note: ${license_note}"
  echo "Target path: ${target}"
  echo "ffmpeg conversion + trim command:"
  echo "  ${ffmpeg_cmd}"
  echo
}

echo "Stoa ambient audio acquisition guide"
echo "No network or filesystem writes are performed by this script."
echo
echo "Preparation:"
echo "  mkdir -p static/audio/ambient"
echo "  # Download candidate source files manually from freesound.org after license review."
echo

print_asset \
  "aegean-waves-loop" \
  "https://freesound.org/search/?q=aegean+waves+loop" \
  "Prefer CC0. CC BY is acceptable only with attribution recorded in docs/stoa/asset-guide.md." \
  "static/audio/ambient/aegean-waves-loop.mp3" \
  "ffmpeg -i <downloaded-waves-file> -ss 00:00:02 -to 00:01:02 -c:a libmp3lame -b:a 128k -ar 44100 static/audio/ambient/aegean-waves-loop.mp3"

print_asset \
  "swift-call-01" \
  "https://freesound.org/search/?q=swift+bird+call" \
  "Prefer CC0. CC BY acceptable with attribution." \
  "static/audio/ambient/swift-call-01.mp3" \
  "ffmpeg -i <downloaded-swift-call-1> -ss 00:00:00 -to 00:00:04 -c:a libmp3lame -b:a 128k -ar 44100 static/audio/ambient/swift-call-01.mp3"

print_asset \
  "swift-call-02" \
  "https://freesound.org/search/?q=swift+bird+call" \
  "Prefer CC0. CC BY acceptable with attribution." \
  "static/audio/ambient/swift-call-02.mp3" \
  "ffmpeg -i <downloaded-swift-call-2> -ss 00:00:01 -to 00:00:05 -c:a libmp3lame -b:a 128k -ar 44100 static/audio/ambient/swift-call-02.mp3"

print_asset \
  "swallow-loop" \
  "https://freesound.org/search/?q=swallow+loop" \
  "Prefer CC0. CC BY acceptable with attribution." \
  "static/audio/ambient/swallow-loop.mp3" \
  "ffmpeg -i <downloaded-swallow-ambience> -ss 00:00:03 -to 00:00:27 -c:a libmp3lame -b:a 128k -ar 44100 static/audio/ambient/swallow-loop.mp3"

print_asset \
  "column-wind-loop" \
  "https://freesound.org/search/?q=wind+columns+ambiance" \
  "Prefer CC0. CC BY acceptable with attribution." \
  "static/audio/ambient/column-wind-loop.mp3" \
  "ffmpeg -i <downloaded-column-wind-file> -ss 00:00:04 -to 00:00:44 -c:a libmp3lame -b:a 128k -ar 44100 static/audio/ambient/column-wind-loop.mp3"

print_asset \
  "torch-crackle-loop" \
  "https://freesound.org/search/?q=fire+crackle+loop" \
  "Prefer CC0. CC BY acceptable with attribution." \
  "static/audio/ambient/torch-crackle-loop.mp3" \
  "ffmpeg -i <downloaded-fire-crackle-file> -ss 00:00:01 -to 00:00:31 -c:a libmp3lame -b:a 128k -ar 44100 static/audio/ambient/torch-crackle-loop.mp3"

echo "Post-step:"
echo "  1) Confirm each file is below 2MB."
echo "  2) Update scripts/stoa-assets/asset-manifest.json -> acquired: true for completed assets."
echo "  3) Update docs/stoa/asset-guide.md status and attribution details."
