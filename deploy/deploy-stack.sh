#!/usr/bin/env bash
set -euo pipefail

readonly COMPOSE_HELPER="${ANYNOTE_COMPOSE_HELPER:-/opt/anynote/compose.sh}"
logged_in=0

finish() {
  local original_result=$? logout_result=0
  trap - EXIT
  if ((logged_in == 1)); then
    docker logout ghcr.io >/dev/null 2>&1 || logout_result=$?
  fi
  if ((original_result != 0)); then
    exit "${original_result}"
  fi
  exit "${logout_result}"
}
trap finish EXIT

if (($# != 1)) || {
  [[ ! $1 =~ ^[[:alnum:]][[:alnum:]_.-]{0,63}$ ]] && [[ $1 != 'github-actions[bot]' ]]
}; then
  printf 'ERROR: usage: deploy-stack.sh <registry-user>\n' >&2
  exit 2
fi
[[ -x ${COMPOSE_HELPER} ]] || {
  printf 'ERROR: Compose helper is unavailable\n' >&2
  exit 1
}

docker login ghcr.io -u "$1" --password-stdin
logged_in=1
"${COMPOSE_HELPER}" pull
"${COMPOSE_HELPER}" up -d --remove-orphans
docker image prune -af || true
