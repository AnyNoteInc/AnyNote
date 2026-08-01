#!/usr/bin/env bash
set -euo pipefail

readonly REQUESTED_PROJECT_DIR="${ANYNOTE_PROJECT_DIR:-/opt/anynote}"
readonly EXPECTED_OWNER="${ANYNOTE_EXPECTED_OWNER:-$(id -un)}"
readonly TEST_FAIL_STEP="${ANYNOTE_ACTIVATION_FAIL_STEP:-}"
readonly TEST_FAIL_ROLLBACK="${ANYNOTE_ACTIVATION_FAIL_ROLLBACK:-}"

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

preflight_live_destination() {
  local path=$1
  [[ ! -L ${path} ]] || die 'live environment destination must not be a symlink'
  [[ ! -e ${path} || -f ${path} ]] || die 'live environment destination must be a regular file'
}

live_matches_snapshot() {
  local snapshot=$1 live=$2
  [[ -f ${snapshot} && ! -L ${snapshot} && -f ${live} && ! -L ${live} && ${snapshot} -ef ${live} ]]
}

inject_test_failure() {
  local step=$1
  [[ ${TEST_FAIL_STEP} != "${step}" ]] || return 42
}

if (($# != 2)); then
  die 'usage: activate-env.sh <temporary .env> <temporary .app.env>'
fi

[[ -d ${REQUESTED_PROJECT_DIR} ]] || die 'managed project directory is unavailable'
readonly PROJECT_DIR="$(cd -- "${REQUESTED_PROJECT_DIR}" && pwd -P)"
readonly PROJECT_DEVICE="$(stat_device "${PROJECT_DIR}")"
readonly LIVE_ENV="${PROJECT_DIR}/.env"
readonly LIVE_APP_ENV="${PROJECT_DIR}/.app.env"
if [[ -n ${TEST_FAIL_STEP} || -n ${TEST_FAIL_ROLLBACK} ]]; then
  [[ ${PROJECT_DIR} != /opt/anynote ]] || die 'activation failure injection is disabled in production'
  case ${TEST_FAIL_STEP} in
    '' | second-move | between-snapshots-and-replace | post-verify | cleanup-snapshot) ;;
    *) die 'unknown activation failure injection step' ;;
  esac
  case ${TEST_FAIL_ROLLBACK} in
    '' | restore-env) ;;
    *) die 'unknown rollback failure injection step' ;;
  esac
fi
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

preflight_live_destination "${LIVE_ENV}"
preflight_live_destination "${LIVE_APP_ENV}"
chmod 0600 "${ENV_UPLOAD}" "${APP_ENV_UPLOAD}"
[[ $(stat_mode "${ENV_UPLOAD}") == 600 && $(stat_mode "${APP_ENV_UPLOAD}") == 600 ]] \
  || die 'cannot enforce mode 0600 on environment uploads'

BACKUP_DIR=$(mktemp -d "${PROJECT_DIR}/.env.backup.XXXXXX")
readonly BACKUP_DIR
chmod 0700 "${BACKUP_DIR}"
HAD_LIVE_ENV=0
HAD_LIVE_APP_ENV=0
NEW_ENV_INSTALLED=0
NEW_APP_ENV_INSTALLED=0

rollback_activation() {
  local original_result=$? rollback_failed=0
  trap - EXIT
  set +e

  if ((NEW_ENV_INSTALLED == 1)); then
    if ((HAD_LIVE_ENV == 1)); then
      if live_matches_snapshot "${BACKUP_DIR}/.env" "${LIVE_ENV}"; then
        :
      elif [[ ${TEST_FAIL_ROLLBACK} == restore-env ]]; then
        rollback_failed=1
      else
        mv -f -- "${BACKUP_DIR}/.env" "${LIVE_ENV}" || rollback_failed=1
      fi
    else
      rm -f -- "${LIVE_ENV}" || rollback_failed=1
    fi
  fi
  if ((NEW_APP_ENV_INSTALLED == 1)); then
    if ((HAD_LIVE_APP_ENV == 1)); then
      if live_matches_snapshot "${BACKUP_DIR}/.app.env" "${LIVE_APP_ENV}"; then
        :
      else
        mv -f -- "${BACKUP_DIR}/.app.env" "${LIVE_APP_ENV}" || rollback_failed=1
      fi
    else
      rm -f -- "${LIVE_APP_ENV}" || rollback_failed=1
    fi
  fi

  rm -f -- "${ENV_UPLOAD}" "${APP_ENV_UPLOAD}" || rollback_failed=1
  if ((rollback_failed == 0)); then
    rm -f -- "${BACKUP_DIR}/.env" "${BACKUP_DIR}/.app.env" || rollback_failed=1
    rmdir -- "${BACKUP_DIR}" || rollback_failed=1
  fi
  if ((rollback_failed != 0)); then
    printf 'ERROR: environment rollback failed; recovery snapshot retained\n' >&2
  fi
  ((original_result != 0)) || original_result=1
  exit "${original_result}"
}
trap rollback_activation EXIT

if [[ -e ${LIVE_ENV} ]]; then
  ln -- "${LIVE_ENV}" "${BACKUP_DIR}/.env"
  HAD_LIVE_ENV=1
fi
if [[ -e ${LIVE_APP_ENV} ]]; then
  ln -- "${LIVE_APP_ENV}" "${BACKUP_DIR}/.app.env"
  HAD_LIVE_APP_ENV=1
fi
inject_test_failure between-snapshots-and-replace
NEW_ENV_INSTALLED=1
mv -f -- "${ENV_UPLOAD}" "${LIVE_ENV}"
NEW_APP_ENV_INSTALLED=1
inject_test_failure second-move
mv -f -- "${APP_ENV_UPLOAD}" "${LIVE_APP_ENV}"

require_live_invariants "${LIVE_ENV}"
require_live_invariants "${LIVE_APP_ENV}"
[[ $(LC_ALL=C grep -c '^TELEGRAM_PROXY_URL=' "${LIVE_ENV}" || true) == 1 ]] \
  || die 'activated .env proxy contract failed'
if LC_ALL=C grep -q '^TELEGRAM_PROXY_URL=' "${LIVE_APP_ENV}"; then
  die 'activated .app.env proxy contract failed'
fi
inject_test_failure post-verify

# Both live files and their invariants are now verified. From this point onward,
# cleanup failure must not roll the committed pair back.
trap - EXIT
if [[ ${TEST_FAIL_STEP} == cleanup-snapshot ]] || \
  ! rm -f -- "${BACKUP_DIR}/.env" "${BACKUP_DIR}/.app.env" || \
  ! rmdir -- "${BACKUP_DIR}"; then
  printf 'ERROR: environment transaction committed but recovery snapshot cleanup failed\n' >&2
  exit 1
fi
printf 'Environment file transaction committed with owner and mode invariants verified\n'
