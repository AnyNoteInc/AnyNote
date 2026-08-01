#!/usr/bin/env bash
set -euo pipefail

readonly PROJECT_DIR="${ANYNOTE_PROJECT_DIR:-/opt/anynote}"

if (($# == 0)); then
  printf 'ERROR: usage: compose.sh <docker compose arguments...>\n' >&2
  exit 2
fi

if [[ ! -d ${PROJECT_DIR} ]]; then
  printf 'ERROR: managed Compose project directory is unavailable\n' >&2
  exit 1
fi

cd -- "${PROJECT_DIR}"
exec env -u TELEGRAM_PROXY_URL docker compose "$@"
