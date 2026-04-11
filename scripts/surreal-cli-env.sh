#!/usr/bin/env bash
# Export only SURREAL_* keys from dotenv files — safe for `surreal export` / `surreal sql`.
#
# Do NOT `source .env` for the Surreal CLI: dotenv files often contain URLs with `&`
# (e.g. DATABASE_URL=...?a=1&b=2) which the shell parses as background jobs.
#
# Reads `.env` then `.env.local` (same idea as the app: local overrides). Duplicate
# `SURREAL_*` keys in `.env.local` replace earlier values. `SURREAL_NAMESPACE` /
# `SURREAL_DATABASE` may live only in `.env.local` — that is fine.
#
# Usage (repo root):
#   . ./scripts/surreal-cli-env.sh
#   surreal export --endpoint "$SURREAL_URL" ...

set +H 2>/dev/null || true

_sophia_surreal_dotenv_line() {
	local line="$1" key val
	line="${line%$'\r'}"
	[[ "$line" =~ ^[[:space:]]*# ]] && return 0
	[[ "$line" =~ ^[[:space:]]*$ ]] && return 0
	case "$line" in
	SURREAL_URL=*|SURREAL_USER=*|SURREAL_PASS=*|SURREAL_NAMESPACE=*|SURREAL_DATABASE=*|SURREAL_INSTANCE=*|SURREAL_HOSTNAME=*|SURREAL_ACCESS=*|SURREAL_RECORD_ACCESS=*|SURREAL_AUTH_LEVEL=*|SURREAL_TOKEN=*)
		key="${line%%=*}"
		val="${line#*=}"
		# Optional dotenv double-quotes (bash 3.2–safe)
		case "$val" in
		\"*\" )
			val="${val#\"}"
			val="${val%\"}"
			;;
		esac
		export "${key}=${val}"
		;;
	esac
}

for _sophia_f in .env .env.local; do
	[[ -f "$_sophia_f" ]] || continue
	while IFS= read -r line || [[ -n "$line" ]]; do
		_sophia_surreal_dotenv_line "$line"
	done <"$_sophia_f"
done
unset -f _sophia_surreal_dotenv_line 2>/dev/null || true
unset _sophia_f 2>/dev/null || true
