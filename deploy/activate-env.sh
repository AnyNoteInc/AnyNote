#!/usr/bin/env bash
set -euo pipefail

readonly REQUESTED_PROJECT_DIR="${ANYNOTE_PROJECT_DIR:-/opt/anynote}"
readonly EXPECTED_OWNER="${ANYNOTE_EXPECTED_OWNER:-$(id -un)}"

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

stat_owner() {
  stat -c '%U' "$1" 2>/dev/null || stat -f '%Su' "$1"
}

stat_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"
}

stat_device() {
  stat -c '%d' "$1" 2>/dev/null || stat -f '%d' "$1"
}

normalize_upload_path() {
  local path=$1 expected_prefix=$2 parent base
  parent=$(cd -- "$(dirname -- "${path}")" 2>/dev/null && pwd -P) \
    || die 'upload parent directory is unavailable'
  base=$(basename -- "${path}")
  [[ ${parent} == "${PROJECT_DIR}" && ${base} == "${expected_prefix}".* ]] \
    || die 'upload path is outside the managed project directory'
  [[ ${base} =~ ^\.(env|app\.env)\.upload\.[[:alnum:]_.-]+$ ]] \
    || die 'upload path has an invalid name'
  printf '%s/%s\n' "${parent}" "${base}"
}

require_regular_owned_upload() {
  local path=$1
  [[ -f ${path} && ! -L ${path} ]] || die 'required environment upload is missing'
  [[ $(stat_owner "${path}") == "${EXPECTED_OWNER}" ]] \
    || die 'environment upload has an unexpected owner'
  [[ $(stat_device "${path}") == "${PROJECT_DEVICE}" ]] \
    || die 'environment upload is not on the managed project filesystem'
}

require_live_invariants() {
  local path=$1
  [[ -s ${path} && -f ${path} && ! -L ${path} ]] || die 'activated environment file is invalid'
  [[ $(stat_owner "${path}") == "${EXPECTED_OWNER}" ]] \
    || die 'activated environment file has an unexpected owner'
  [[ $(stat_mode "${path}") == 600 ]] || die 'activated environment file mode is not 0600'
}

if (($# != 2)); then
  die 'usage: activate-env.sh <temporary .env> <temporary .app.env>'
fi

[[ -d ${REQUESTED_PROJECT_DIR} ]] || die 'managed project directory is unavailable'
readonly PROJECT_DIR="$(cd -- "${REQUESTED_PROJECT_DIR}" && pwd -P)"
readonly PROJECT_DEVICE="$(stat_device "${PROJECT_DIR}")"
readonly LIVE_ENV="${PROJECT_DIR}/.env"
readonly LIVE_APP_ENV="${PROJECT_DIR}/.app.env"
ENV_UPLOAD=$(normalize_upload_path "$1" '.env.upload')
APP_ENV_UPLOAD=$(normalize_upload_path "$2" '.app.env.upload')
readonly ENV_UPLOAD APP_ENV_UPLOAD

cleanup_uploads() {
  rm -f -- "${ENV_UPLOAD}" "${APP_ENV_UPLOAD}"
}
trap cleanup_uploads EXIT

require_regular_owned_upload "${ENV_UPLOAD}"
require_regular_owned_upload "${APP_ENV_UPLOAD}"
[[ -s ${ENV_UPLOAD} ]] || die '.env upload is empty'
[[ -s ${APP_ENV_UPLOAD} ]] || die '.app.env upload is empty'

proxy_line_count=$(LC_ALL=C grep -c '^TELEGRAM_PROXY_URL=' "${ENV_UPLOAD}" || true)
[[ ${proxy_line_count} == 1 ]] || die '.env must contain exactly one TELEGRAM_PROXY_URL line'
if LC_ALL=C grep -q '^TELEGRAM_PROXY_URL=' "${APP_ENV_UPLOAD}"; then
  die '.app.env must not contain TELEGRAM_PROXY_URL'
fi

chmod 0600 "${ENV_UPLOAD}" "${APP_ENV_UPLOAD}"
[[ $(stat_mode "${ENV_UPLOAD}") == 600 && $(stat_mode "${APP_ENV_UPLOAD}") == 600 ]] \
  || die 'cannot enforce mode 0600 on environment uploads'

mv -f -- "${ENV_UPLOAD}" "${LIVE_ENV}"
mv -f -- "${APP_ENV_UPLOAD}" "${LIVE_APP_ENV}"

require_live_invariants "${LIVE_ENV}"
require_live_invariants "${LIVE_APP_ENV}"
[[ $(LC_ALL=C grep -c '^TELEGRAM_PROXY_URL=' "${LIVE_ENV}" || true) == 1 ]] \
  || die 'activated .env proxy contract failed'
if LC_ALL=C grep -q '^TELEGRAM_PROXY_URL=' "${LIVE_APP_ENV}"; then
  die 'activated .app.env proxy contract failed'
fi

trap - EXIT
printf 'Environment files activated with owner and mode invariants verified\n'
