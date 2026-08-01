#!/usr/bin/env bash
set -euo pipefail

readonly BRIDGE_PORT=40001
readonly BRIDGE_ENV="${ANYNOTE_WARP_BRIDGE_ENV:-/etc/default/anynote-warp-bridge}"
readonly BRIDGE_UNIT="${ANYNOTE_WARP_BRIDGE_UNIT:-/etc/systemd/system/anynote-warp-bridge.service}"
readonly OS_RELEASE_FILE="${ANYNOTE_WARP_OS_RELEASE_FILE:-/etc/os-release}"
readonly WARP_KEYRING="${ANYNOTE_WARP_KEYRING:-/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg}"
readonly WARP_APT_LIST="${ANYNOTE_WARP_APT_LIST:-/etc/apt/sources.list.d/cloudflare-client.list}"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

is_valid_port() {
  local port=$1
  [[ ${port} =~ ^([1-9][0-9]{0,4})$ ]] || return 1
  ((10#${port} >= 1 && 10#${port} <= 65535))
}

is_private_ipv4() {
  local address=$1 first second third fourth
  [[ ${address} =~ ^([0-9]|[1-9][0-9]{1,2})\.([0-9]|[1-9][0-9]{1,2})\.([0-9]|[1-9][0-9]{1,2})\.([0-9]|[1-9][0-9]{1,2})$ ]] \
    || return 1

  first=$((10#${BASH_REMATCH[1]}))
  second=$((10#${BASH_REMATCH[2]}))
  third=$((10#${BASH_REMATCH[3]}))
  fourth=$((10#${BASH_REMATCH[4]}))
  ((first >= 1 && first <= 255)) || return 1
  ((second >= 0 && second <= 255)) || return 1
  ((third >= 0 && third <= 255)) || return 1
  ((fourth >= 0 && fourth <= 255)) || return 1

  ((first == 10 || (first == 172 && second >= 16 && second <= 31) || (first == 192 && second == 168)))
}

is_assigned_host_ipv4() {
  local address=$1 output index interface family cidr remainder
  local total_matches=0 docker_matches=0
  output=$(ip -o -4 addr show) || return 1

  while read -r index interface family cidr remainder; do
    [[ ${family} == inet && ${cidr%%/*} == "${address}" ]] || continue
    total_matches=$((total_matches + 1))
    if [[ ${interface} =~ ^docker[0-9]+$ || ${interface} =~ ^br-[[:alnum:]_.-]+$ ]]; then
      docker_matches=$((docker_matches + 1))
    fi
  done <<< "${output}"

  ((total_matches == 1 && docker_matches == 1))
}

require_supported_host() {
  [[ $(id -u) -eq 0 ]] || die 'run as root'
  [[ -r ${OS_RELEASE_FILE} ]] || die 'cannot read OS release metadata'
  # shellcheck disable=SC1091
  . "${OS_RELEASE_FILE}"
  [[ ${ID} == ubuntu && ${VERSION_ID} == 22.04 ]] || die 'expected Ubuntu 22.04'
  [[ $(dpkg --print-architecture) == amd64 ]] || die 'expected amd64'
  command -v docker >/dev/null || die 'docker is required'
  command -v systemctl >/dev/null || die 'systemd is required'
}

install_packages() {
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl gnupg lsb-release socat
  curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg \
    | gpg --batch --yes --dearmor --output "${WARP_KEYRING}"
  printf 'deb [signed-by=%s] https://pkg.cloudflareclient.com/ jammy main\n' "${WARP_KEYRING}" \
    > "${WARP_APT_LIST}"
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y cloudflare-warp
  systemctl enable --now warp-svc.service
}

stop_existing_bridge() {
  local load_state active_state
  load_state=$(systemctl show --property=LoadState --value anynote-warp-bridge.service) \
    || die 'cannot inspect existing bridge LoadState'
  case ${load_state} in
    not-found) return 0 ;;
    loaded | error | masked | bad-setting | stub | merged) ;;
    '') die 'existing bridge LoadState is empty' ;;
    *) die 'existing bridge LoadState is unexpected' ;;
  esac

  systemctl disable --now anynote-warp-bridge.service \
    || die 'cannot stop existing bridge service'
  active_state=$(systemctl show --property=ActiveState --value anynote-warp-bridge.service) \
    || die 'cannot verify existing bridge ActiveState'
  [[ ${active_state} == inactive || ${active_state} == failed ]] \
    || die 'existing bridge service is still active'
}

prepare_local_proxy() {
  warp-cli --accept-tos registration show >/dev/null 2>&1 \
    || warp-cli --accept-tos registration new

  warp-cli --accept-tos mode --help 2>&1 \
    | grep -Eq '(^|[[:space:]])proxy:' \
    || die 'installed WARP client does not support local proxy mode'

  warp-cli --accept-tos tunnel protocol set MASQUE
  warp-cli --accept-tos mode proxy
}

is_connected_status() {
  local output=$1
  [[ ${output} == 'Status update: Connected' || ${output} == Connected ]]
}

wait_for_connection() {
  local output
  for _ in $(seq 1 30); do
    if output=$(warp-cli --accept-tos status 2>&1) && is_connected_status "${output}"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

warp_proxy_port_from_settings() {
  local settings line port='' matches=0
  settings=$(warp-cli --accept-tos settings) || return 1

  while IFS= read -r line; do
    if [[ ${line} =~ ^\([[:alnum:]_-]+([[:space:]][[:alnum:]_-]+)*\)[[:space:]]+Mode:[[:space:]]+WarpProxy[[:space:]]+on[[:space:]]+port[[:space:]]+([0-9]+)$ ]]; then
      port=${BASH_REMATCH[2]}
      matches=$((matches + 1))
    fi
  done <<< "${settings}"

  ((matches == 1)) || return 1
  is_valid_port "${port}" || return 1
  printf '%s\n' "${port}"
}

require_warp_listener() {
  local port=$1 output line state recv_queue send_queue local_address remainder
  local exact_matches=0 warp_matches=0
  output=$(ss -lntpH) || return 1

  while read -r state recv_queue send_queue local_address remainder; do
    [[ ${local_address} == "127.0.0.1:${port}" ]] || continue
    exact_matches=$((exact_matches + 1))
    [[ ${remainder} != *'users:(("warp-svc",'* ]] || warp_matches=$((warp_matches + 1))
  done <<< "${output}"

  ((exact_matches == 1 && warp_matches == 1))
}

detect_warp_proxy_port() {
  local port
  port=$(warp_proxy_port_from_settings) \
    || die 'cannot discover a single valid WARP proxy port from settings'
  require_warp_listener "${port}" \
    || die 'WARP proxy does not have one exact loopback listener'
  printf '%s\n' "${port}"
}

detect_docker_host_gateway() {
  local gateway
  gateway=$(docker run --rm --add-host=host.docker.internal:host-gateway busybox:1.36 \
    getent hosts host.docker.internal | awk 'NR == 1 && NF == 2 && $2 == "host.docker.internal" {print $1}') \
    || die 'cannot query Docker host-gateway address'
  is_private_ipv4 "${gateway}" || die 'Docker host-gateway is not a private IPv4 address'
  is_assigned_host_ipv4 "${gateway}" \
    || die 'Docker host-gateway is not assigned to one local host interface'
  printf '%s\n' "${gateway}"
}

install_bridge() (
  local warp_proxy_port=$1 docker_host_gateway=$2 env_tmp
  env_tmp=$(mktemp)
  trap 'rm -f "${env_tmp}"' EXIT

  {
    printf 'BRIDGE_PORT=%s\n' "${BRIDGE_PORT}"
    printf 'DOCKER_HOST_GATEWAY=%s\n' "${docker_host_gateway}"
    printf 'WARP_PROXY_PORT=%s\n' "${warp_proxy_port}"
  } > "${env_tmp}"

  install -m 0644 "${env_tmp}" "${BRIDGE_ENV}"
  install -m 0644 "${SCRIPT_DIR}/anynote-warp-bridge.service" "${BRIDGE_UNIT}"
  systemctl daemon-reload
  systemctl enable anynote-warp-bridge.service
  systemctl restart anynote-warp-bridge.service
)

read_bridge_environment() {
  local line key value
  local seen_bridge_port=0 seen_gateway=0 seen_warp_port=0
  [[ -r ${BRIDGE_ENV} ]] || return 1

  STATUS_BRIDGE_PORT=''
  STATUS_DOCKER_GATEWAY=''
  STATUS_WARP_PROXY_PORT=''
  while IFS= read -r line || [[ -n ${line} ]]; do
    [[ ${line} == *=* ]] || return 1
    key=${line%%=*}
    value=${line#*=}
    case ${key} in
      BRIDGE_PORT)
        ((seen_bridge_port == 0)) || return 1
        STATUS_BRIDGE_PORT=${value}
        seen_bridge_port=1
        ;;
      DOCKER_HOST_GATEWAY)
        ((seen_gateway == 0)) || return 1
        STATUS_DOCKER_GATEWAY=${value}
        seen_gateway=1
        ;;
      WARP_PROXY_PORT)
        ((seen_warp_port == 0)) || return 1
        STATUS_WARP_PROXY_PORT=${value}
        seen_warp_port=1
        ;;
      *) return 1 ;;
    esac
  done < "${BRIDGE_ENV}"

  ((seen_bridge_port == 1 && seen_gateway == 1 && seen_warp_port == 1)) || return 1
  [[ ${STATUS_BRIDGE_PORT} == "${BRIDGE_PORT}" ]] || return 1
  is_private_ipv4 "${STATUS_DOCKER_GATEWAY}" || return 1
  is_assigned_host_ipv4 "${STATUS_DOCKER_GATEWAY}" || return 1
  is_valid_port "${STATUS_WARP_PROXY_PORT}"
}

require_bridge_listener() {
  local gateway=$1 port=$2 output line state recv_queue send_queue local_address remainder
  local port_matches=0 exact_matches=0
  output=$(ss -lntH) || return 1

  while read -r state recv_queue send_queue local_address remainder; do
    [[ ${local_address} == *":${port}" ]] || continue
    port_matches=$((port_matches + 1))
    [[ ${local_address} != "${gateway}:${port}" ]] || exact_matches=$((exact_matches + 1))
  done <<< "${output}"

  ((port_matches == 1 && exact_matches == 1))
}

status() {
  local warp_status settings_port current_gateway
  systemctl is-active warp-svc.service >/dev/null
  systemctl is-active anynote-warp-bridge.service >/dev/null
  read_bridge_environment || die 'bridge environment is invalid'
  current_gateway=$(detect_docker_host_gateway)
  [[ ${current_gateway} == "${STATUS_DOCKER_GATEWAY}" ]] \
    || die 'current Docker host-gateway does not match the bridge environment'

  warp_status=$(warp-cli --accept-tos status) || die 'cannot read WARP status'
  is_connected_status "${warp_status}" || die 'WARP is not Connected'
  settings_port=$(warp_proxy_port_from_settings) || die 'WARP is not in valid proxy mode'
  [[ ${settings_port} == "${STATUS_WARP_PROXY_PORT}" ]] \
    || die 'WARP settings do not match the bridge environment'
  require_warp_listener "${settings_port}" || die 'WARP loopback listener invariant failed'
  require_bridge_listener "${STATUS_DOCKER_GATEWAY}" "${STATUS_BRIDGE_PORT}" \
    || die 'Docker bridge listener invariant failed'

  printf 'WARP Connected in proxy mode; bridge invariant verified on port %s\n' "${BRIDGE_PORT}"
}

rollback_runtime() {
  local result=0
  systemctl disable --now anynote-warp-bridge.service >/dev/null 2>&1 || result=1
  warp-cli --accept-tos disconnect >/dev/null 2>&1 || result=1
  return "${result}"
}

install_transaction() (
  local cleanup_armed=0 default_route_before default_route_after
  local warp_proxy_port docker_host_gateway

  cleanup_transaction() {
    local original_result=$?
    trap - EXIT
    if ((cleanup_armed == 1)); then
      set +e
      rollback_runtime
      set -e
    fi
    exit "${original_result}"
  }
  trap cleanup_transaction EXIT

  stop_existing_bridge
  install_packages
  prepare_local_proxy
  default_route_before=$(ip route show default) || die 'cannot read the default route before connection'

  cleanup_armed=1
  warp-cli --accept-tos connect
  wait_for_connection || die 'WARP did not connect in local proxy mode'

  default_route_after=$(ip route show default) \
    || die 'cannot read the default route after connection'
  [[ ${default_route_before} == "${default_route_after}" ]] \
    || die 'WARP changed the default route'

  warp_proxy_port=$(detect_warp_proxy_port)
  docker_host_gateway=$(detect_docker_host_gateway)
  install_bridge "${warp_proxy_port}" "${docker_host_gateway}"
  status
  cleanup_armed=0
)

disable_proxy() {
  local result=0
  systemctl disable --now anynote-warp-bridge.service || result=1
  warp-cli --accept-tos disconnect || result=1
  return "${result}"
}

main() {
  require_supported_host
  case "${1:-}" in
    check)
      curl -fsS --connect-timeout 8 --max-time 12 https://pkg.cloudflareclient.com/ >/dev/null
      ;;
    install)
      install_transaction
      ;;
    status)
      status
      ;;
    disable)
      disable_proxy
      ;;
    *)
      die 'usage: install.sh check|install|status|disable'
      ;;
  esac
}

main "$@"
