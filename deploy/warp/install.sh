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

configure_local_proxy() {
  local default_route_before default_route_after
  default_route_before=$(ip route show default)

  warp-cli --accept-tos registration show >/dev/null 2>&1 \
    || warp-cli --accept-tos registration new

  warp-cli --accept-tos mode --help 2>&1 \
    | grep -Eq '(^|[[:space:]])proxy:' \
    || die 'installed WARP client does not support local proxy mode'

  warp-cli --accept-tos tunnel protocol set MASQUE
  warp-cli --accept-tos mode proxy
  warp-cli --accept-tos connect

  for _ in $(seq 1 30); do
    warp-cli --accept-tos status 2>&1 | grep -q 'Connected' && break
    sleep 1
  done
  warp-cli --accept-tos status 2>&1 | grep -q 'Connected' \
    || die 'WARP did not connect in local proxy mode'

  default_route_after=$(ip route show default)
  if [[ ${default_route_before} != "${default_route_after}" ]]; then
    warp-cli --accept-tos disconnect
    die 'WARP changed the default route; disconnected'
  fi
}

detect_warp_proxy_port() {
  local port
  port=$(ss -lntpH \
    | awk '$4 ~ /^127\.0\.0\.1:/ && $0 ~ /warp-svc/ {n=split($4,a,":"); print a[n]; exit}')
  [[ ${port} =~ ^[0-9]+$ ]] || die 'cannot discover WARP loopback proxy port'
  printf '%s\n' "${port}"
}

detect_docker_host_gateway() {
  local gateway
  gateway=$(docker run --rm --add-host=host.docker.internal:host-gateway busybox:1.36 \
    getent hosts host.docker.internal | awk 'NR == 1 {print $1}')
  [[ ${gateway} =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] \
    || die 'cannot discover Docker host-gateway address'
  printf '%s\n' "${gateway}"
}

install_bridge() (
  local warp_proxy_port docker_host_gateway env_tmp
  warp_proxy_port=$(detect_warp_proxy_port)
  docker_host_gateway=$(detect_docker_host_gateway)
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
  systemctl enable --now anynote-warp-bridge.service
)

status() {
  systemctl is-active warp-svc.service
  systemctl is-active anynote-warp-bridge.service
  warp-cli --accept-tos status
  ss -lntH | grep -E ":${BRIDGE_PORT}[[:space:]]"
}

disable_proxy() {
  systemctl disable --now anynote-warp-bridge.service
  warp-cli --accept-tos disconnect
}

main() {
  require_supported_host
  case "${1:-}" in
    check)
      curl -fsS --connect-timeout 8 --max-time 12 https://pkg.cloudflareclient.com/ >/dev/null
      ;;
    install)
      install_packages
      configure_local_proxy
      install_bridge
      status
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
