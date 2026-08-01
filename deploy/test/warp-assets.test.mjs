import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = fileURLToPath(new URL('../../', import.meta.url))
const installerPath = join(root, 'deploy/warp/install.sh')
const stubNames = [
  'id',
  'dpkg',
  'docker',
  'systemctl',
  'apt-get',
  'curl',
  'gpg',
  'warp-cli',
  'ip',
  'ss',
  'sleep',
  'install',
]

const stubDriver = `#!/usr/bin/env bash
set -euo pipefail
name=\${0##*/}
{
  printf '%s' "\${name}"
  for argument in "\$@"; do printf '\\t%s' "\${argument}"; done
  printf '\\n'
} >> "\${FAKE_HOST_TRACE}"

fails() {
  [[ ,\${FAKE_FAIL_POINTS:-}, == *,\$1,* ]]
}

read_state() {
  local path=\$1 fallback=\$2
  if [[ -f \${path} ]]; then
    IFS= read -r REPLY < "\${path}"
  else
    REPLY=\${fallback}
  fi
}

write_running_bridge() {
  local bridge_port='' gateway='' warp_port='' key value
  while IFS='=' read -r key value; do
    case \${key} in
      BRIDGE_PORT) bridge_port=\${value} ;;
      DOCKER_HOST_GATEWAY) gateway=\${value} ;;
      WARP_PROXY_PORT) warp_port=\${value} ;;
    esac
  done < "\${ANYNOTE_WARP_BRIDGE_ENV}"
  printf '%s\\n' active > "\${FAKE_BRIDGE_STATE}"
  printf '%s\\n' "\${gateway}:\${bridge_port}" > "\${FAKE_BRIDGE_LISTENER_STATE}"
  printf '%s\\n' "\${warp_port}" > "\${FAKE_BRIDGE_UPSTREAM_STATE}"
}

case \${name} in
  id)
    [[ \${1:-} != -u ]] || printf '%s\\n' "\${FAKE_ID_UID:-0}"
    ;;
  dpkg)
    [[ \${1:-} != --print-architecture ]] || printf '%s\\n' "\${FAKE_ARCHITECTURE:-amd64}"
    ;;
  docker)
    if [[ \${1:-} == run ]]; then
      fails docker-run && exit 71
      printf '%s\\n' "\${FAKE_DOCKER_GATEWAY:-172.17.0.1} host.docker.internal"
    fi
    ;;
  systemctl)
    action=\${1:-}
    service=\${*: -1}
    case \${action} in
      show)
        if [[ \${2:-} == --property=LoadState ]]; then
          if fails systemctl-show; then exit 85; fi
          load_state=\${FAKE_SYSTEMD_LOAD_STATE:-auto}
          if [[ \${load_state} == auto ]]; then
            read_state "\${FAKE_BRIDGE_STATE}" inactive
            if [[ \${REPLY} == active || -f \${ANYNOTE_WARP_BRIDGE_UNIT} ]]; then
              load_state=loaded
            else
              load_state=not-found
            fi
          fi
          [[ \${load_state} == empty ]] || printf '%s\\n' "\${load_state}"
        elif [[ \${2:-} == --property=ActiveState ]]; then
          if fails active-state-show; then exit 86; fi
          read_state "\${FAKE_BRIDGE_STATE}" inactive
          printf '%s\\n' "\${REPLY}"
        else
          exit 87
        fi
        ;;
      cat)
        [[ \${service} != anynote-warp-bridge.service || -f \${ANYNOTE_WARP_BRIDGE_UNIT} ]]
        ;;
      daemon-reload)
        if fails daemon-reload; then exit 72; fi
        ;;
      disable)
        if [[ \${service} == anynote-warp-bridge.service ]]; then
          fails bridge-disable && exit 73
          printf '%s\\n' inactive > "\${FAKE_BRIDGE_STATE}"
        fi
        ;;
      enable)
        if [[ \${service} == anynote-warp-bridge.service ]]; then
          printf '%s\\n' enabled > "\${FAKE_BRIDGE_ENABLED_STATE}"
          if [[ \${2:-} == --now ]]; then
            read_state "\${FAKE_BRIDGE_STATE}" inactive
            [[ \${REPLY} == active ]] || write_running_bridge
          fi
        fi
        ;;
      restart)
        fails bridge-restart && exit 74
        [[ \${service} != anynote-warp-bridge.service ]] || write_running_bridge
        ;;
      is-active)
        if [[ \${service} == warp-svc.service ]]; then
          printf '%s\\n' active
        else
          read_state "\${FAKE_BRIDGE_STATE}" inactive
          printf '%s\\n' "\${REPLY}"
          [[ \${REPLY} == active ]]
        fi
        ;;
    esac
    ;;
  apt-get)
    if fails apt-get; then exit 84; fi
    ;;
  curl)
    case "\${*: -1}" in */pubkey.gpg) printf '%s\\n' fake-cloudflare-key ;; esac
    ;;
  gpg)
    cat >/dev/null
    output=''
    while (( \$# )); do
      if [[ \$1 == --output ]]; then output=\$2; break; fi
      shift
    done
    [[ -z \${output} ]] || : > "\${output}"
    ;;
  warp-cli)
    case " \${*} " in
      *' registration show '*) ;;
      *' mode --help '*)
        if [[ \${FAKE_WARP_PROXY_CAPABILITY:-present} == present ]]; then
          printf '%s\\n' 'Modes:' '  proxy: local proxy'
        else
          printf '%s\\n' 'Modes:' '  doh: DNS only'
        fi
        ;;
      *' mode proxy '*) printf '%s\\n' proxy > "\${FAKE_WARP_MODE_STATE}" ;;
      *' connect '*)
        read_state "\${FAKE_CONNECT_COUNT}" 0
        count=\$((REPLY + 1))
        printf '%s\\n' "\${count}" > "\${FAKE_CONNECT_COUNT}"
        IFS=',' read -r -a ports <<< "\${FAKE_WARP_PORTS:-40000}"
        index=\$((count - 1))
        (( index < \${#ports[@]} )) || index=\$((\${#ports[@]} - 1))
        printf '%s\\n' "\${ports[index]}" > "\${FAKE_WARP_PORT_STATE}"
        printf '%s\\n' Connected > "\${FAKE_WARP_CONNECTION_STATE}"
        if fails warp-connect; then exit 75; fi
        ;;
      *' disconnect '*)
        printf '%s\\n' Disconnected > "\${FAKE_WARP_CONNECTION_STATE}"
        if fails warp-disconnect; then exit 76; fi
        ;;
      *' status '*)
        fails warp-status-command && exit 77
        if [[ -n \${FAKE_WARP_STATUS_OUTPUT:-} ]]; then
          printf '%s\\n' "\${FAKE_WARP_STATUS_OUTPUT}"
        else
          read_state "\${FAKE_WARP_CONNECTION_STATE}" Connected
          printf 'Status update: %s\\n' "\${REPLY}"
        fi
        ;;
      *' settings '*)
        fails warp-settings-command && exit 78
        read_state "\${FAKE_WARP_PORT_STATE}" 40000
        case \${FAKE_SETTINGS_MODE:-normal} in
          normal)
            printf '%s\\n' \\
              'Merged configuration:' \\
              '(policy)        Switch Locked: false' \\
              "(user set)      Mode: WarpProxy on port \${REPLY}" \\
              '(default)       Disable Auto Fallback: false'
            ;;
          nonproxy) printf '%s\\n' 'Mode: WarpWithDns' ;;
          wrong-port) printf '%s\\n' '(user set) Mode: WarpProxy on port 40099' ;;
          invalid-port) printf '%s\\n' '(user set) Mode: WarpProxy on port 70000' ;;
          multiple) printf '%s\\n' "(user set) Mode: WarpProxy on port \${REPLY}" '(policy) Mode: WarpProxy on port 40099' ;;
        esac
        ;;
    esac
    ;;
  ip)
    if [[ \${1:-} == route ]]; then
      read_state "\${FAKE_IP_CALLS_FILE}" 0
      calls=\$((REPLY + 1))
      printf '%s\\n' "\${calls}" > "\${FAKE_IP_CALLS_FILE}"
      if (( calls > 1 )) && fails route-after; then exit 79; fi
      if [[ \${FAKE_ROUTE_CHANGE:-no} == yes && \${calls} -gt 1 ]]; then
        printf '%s\\n' 'default via 192.0.2.2 dev eth0'
      else
        printf '%s\\n' 'default via 192.0.2.1 dev eth0'
      fi
    elif [[ \${1:-} == -o && \${2:-} == -4 && \${3:-} == addr && \${4:-} == show ]]; then
      IFS=',' read -r -a assignments <<< "\${FAKE_ASSIGNED_ASSIGNMENTS-172.17.0.1@docker0}"
      index=2
      for assignment in "\${assignments[@]}"; do
        gateway=\${assignment%%@*}
        interface=\${assignment#*@}
        [[ -z \${gateway} ]] || printf '%s: %s    inet %s/16 brd 172.17.255.255 scope global %s\\n' "\${index}" "\${interface}" "\${gateway}" "\${interface}"
        index=\$((index + 1))
      done
    fi
    ;;
  ss)
    if [[ \${1:-} == -lntpH ]]; then
      fails warp-ss-command && exit 80
      read_state "\${FAKE_WARP_PORT_STATE}" 40000
      case \${FAKE_WARP_LISTENER_MODE:-normal} in
        normal)
          printf '%s\\n' "LISTEN 0 4096 127.0.0.1:\${REPLY} 0.0.0.0:* users:((\\\"warp-svc\\\",pid=1,fd=2))"
          ;;
        missing)
          printf '%s\\n' 'LISTEN 0 4096 127.0.0.1:39999 0.0.0.0:* users:(("warp-svc",pid=1,fd=2))'
          ;;
        multiple)
          printf '%s\\n' \\
            "LISTEN 0 4096 127.0.0.1:\${REPLY} 0.0.0.0:* users:((\\\"warp-svc\\\",pid=1,fd=2))" \\
            "LISTEN 0 4096 127.0.0.1:\${REPLY} 0.0.0.0:* users:((\\\"warp-svc\\\",pid=2,fd=3))"
          ;;
        mixed-process-duplicate)
          printf '%s\\n' \\
            "LISTEN 0 4096 127.0.0.1:\${REPLY} 0.0.0.0:* users:((\\\"warp-svc\\\",pid=1,fd=2))" \\
            "LISTEN 0 4096 127.0.0.1:\${REPLY} 0.0.0.0:* users:((\\\"other-daemon\\\",pid=2,fd=3))"
          ;;
        wrong-process)
          printf '%s\\n' "LISTEN 0 4096 127.0.0.1:\${REPLY} 0.0.0.0:* users:((\\\"evil-warp-svc\\\",pid=2,fd=3))"
          ;;
      esac
    else
      fails bridge-ss-command && exit 81
      read_state "\${FAKE_BRIDGE_STATE}" inactive
      [[ \${REPLY} == active ]] || exit 0
      read_state "\${FAKE_BRIDGE_LISTENER_STATE}" '172.17.0.1:40001'
      listener=\${REPLY}
      case \${FAKE_BRIDGE_LISTENER_MODE:-normal} in
        normal) printf '%s\\n' "LISTEN 0 4096 \${listener} 0.0.0.0:*" ;;
        wrong) printf '%s\\n' 'LISTEN 0 4096 172.17.0.2:40001 0.0.0.0:*' ;;
        wildcard) printf '%s\\n' 'LISTEN 0 4096 0.0.0.0:40001 0.0.0.0:*' ;;
        ipv6) printf '%s\\n' 'LISTEN 0 4096 [::]:40001 [::]:*' ;;
        duplicate) printf '%s\\n' "LISTEN 0 4096 \${listener} 0.0.0.0:*" "LISTEN 0 4096 \${listener} 0.0.0.0:*" ;;
      esac
    fi
    ;;
  sleep)
    ;;
  install)
    source_path=\${*: -2:1}
    destination=\${*: -1}
    if [[ \${destination} == "\${ANYNOTE_WARP_BRIDGE_ENV}" ]] && fails install-env; then exit 82; fi
    if [[ \${destination} == "\${ANYNOTE_WARP_BRIDGE_UNIT}" ]] && fails install-unit; then exit 83; fi
    cp "\${source_path}" "\${destination}"
    chmod "\${2}" "\${destination}"
    ;;
esac
`

async function exists(path) {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function parseTrace(raw) {
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'))
}

function hasCall(trace, command, ...args) {
  return trace.some(
    ([actualCommand, ...actualArgs]) =>
      actualCommand === command &&
      actualArgs.length === args.length &&
      actualArgs.every((argument, index) => argument === args[index]),
  )
}

async function readIfPresent(path) {
  return (await exists(path)) ? readFile(path, 'utf8') : undefined
}

async function fakeHost(options, assertion) {
  const directory = await mkdtemp(join(tmpdir(), 'anynote-warp-host-'))
  const paths = Object.fromEntries(
    [
      'trace',
      'os-release',
      'keyring',
      'apt-list',
      'bridge-env',
      'bridge-unit',
      'ip-calls',
      'bridge-state',
      'bridge-enabled',
      'bridge-listener',
      'bridge-upstream',
      'warp-connection',
      'warp-mode',
      'warp-port',
      'connect-count',
    ].map((name) => [name, join(directory, name)]),
  )
  const bin = join(directory, 'bin')

  try {
    await mkdir(bin)
    await writeFile(paths.trace, '')
    await writeFile(paths['os-release'], 'ID=ubuntu\nVERSION_ID=22.04\n')
    await writeFile(paths['warp-port'], '40000\n')
    await writeFile(paths['warp-connection'], 'Connected\n')
    for (const name of stubNames) {
      const path = join(bin, name)
      await writeFile(path, stubDriver)
      await chmod(path, 0o755)
    }

    if (options.bridgeFiles || options.healthyStatus) {
      await writeFile(
        paths['bridge-env'],
        options.bridgeEnv ??
          'BRIDGE_PORT=40001\nDOCKER_HOST_GATEWAY=172.17.0.1\nWARP_PROXY_PORT=40000\n',
      )
      await writeFile(paths['bridge-unit'], options.bridgeUnit ?? 'existing bridge unit\n')
    }
    if (options.healthyStatus) {
      await writeFile(paths['bridge-state'], 'active\n')
      await writeFile(paths['bridge-listener'], '172.17.0.1:40001\n')
      await writeFile(paths['bridge-upstream'], '40000\n')
    }
    if (options.activeBridgeWithoutFragment) {
      await writeFile(paths['bridge-state'], 'active\n')
      await writeFile(paths['bridge-listener'], '172.17.0.1:40001\n')
    }

    const assignedAssignments =
      options.assignedAssignments ??
      (options.assignedGateways ?? '172.17.0.1')
        .split(',')
        .filter(Boolean)
        .map((gateway) => `${gateway}@${options.assignedInterface ?? 'docker0'}`)
        .join(',')

    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      ANYNOTE_WARP_OS_RELEASE_FILE: paths['os-release'],
      ANYNOTE_WARP_KEYRING: paths.keyring,
      ANYNOTE_WARP_APT_LIST: paths['apt-list'],
      ANYNOTE_WARP_BRIDGE_ENV: paths['bridge-env'],
      ANYNOTE_WARP_BRIDGE_UNIT: paths['bridge-unit'],
      FAKE_HOST_TRACE: paths.trace,
      FAKE_IP_CALLS_FILE: paths['ip-calls'],
      FAKE_BRIDGE_STATE: paths['bridge-state'],
      FAKE_BRIDGE_ENABLED_STATE: paths['bridge-enabled'],
      FAKE_BRIDGE_LISTENER_STATE: paths['bridge-listener'],
      FAKE_BRIDGE_UPSTREAM_STATE: paths['bridge-upstream'],
      FAKE_WARP_CONNECTION_STATE: paths['warp-connection'],
      FAKE_WARP_MODE_STATE: paths['warp-mode'],
      FAKE_WARP_PORT_STATE: paths['warp-port'],
      FAKE_CONNECT_COUNT: paths['connect-count'],
      FAKE_WARP_PROXY_CAPABILITY: options.proxyCapability ?? 'present',
      FAKE_ROUTE_CHANGE: options.routeChange ? 'yes' : 'no',
      FAKE_DOCKER_GATEWAY: options.gateway ?? '172.17.0.1',
      FAKE_ASSIGNED_ASSIGNMENTS: assignedAssignments,
      FAKE_SYSTEMD_LOAD_STATE: options.systemdLoadState ?? 'auto',
      FAKE_WARP_PORTS: options.warpPorts ?? '40000',
      FAKE_SETTINGS_MODE: options.settingsMode ?? 'normal',
      FAKE_WARP_LISTENER_MODE: options.warpListenerMode ?? 'normal',
      FAKE_BRIDGE_LISTENER_MODE: options.bridgeListenerMode ?? 'normal',
      FAKE_WARP_STATUS_OUTPUT: options.warpStatusOutput ?? '',
      FAKE_FAIL_POINTS: options.failPoints ?? '',
    }

    const commands = options.commands ?? [options.command]
    const results = []
    for (const command of commands) {
      try {
        const output = await execFileAsync(installerPath, [command], { env })
        results.push({ ...output, code: 0 })
      } catch (error) {
        results.push({
          code: error.code,
          stdout: error.stdout ?? '',
          stderr: error.stderr ?? '',
        })
      }
    }

    await assertion({
      ...results.at(-1),
      results,
      paths,
      trace: parseTrace(await readFile(paths.trace, 'utf8')),
      bridgeState: (await readIfPresent(paths['bridge-state']))?.trim(),
      bridgeUpstream: (await readIfPresent(paths['bridge-upstream']))?.trim(),
      warpState: (await readIfPresent(paths['warp-connection']))?.trim(),
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('check accepts Ubuntu 22.04 amd64 and probes only the official endpoint', async () => {
  await fakeHost({ command: 'check' }, async ({ code, trace }) => {
    assert.equal(code, 0)
    assert.deepEqual(
      trace.filter(([command]) => command === 'curl'),
      [
        [
          'curl',
          '-fsS',
          '--connect-timeout',
          '8',
          '--max-time',
          '12',
          'https://pkg.cloudflareclient.com/',
        ],
      ],
    )
  })
})

test('install fails before mode selection when proxy capability is absent', async () => {
  await fakeHost(
    { command: 'install', proxyCapability: 'missing' },
    async ({ code, trace, paths }) => {
      assert.notEqual(code, 0)
      assert.equal(hasCall(trace, 'warp-cli', '--accept-tos', 'mode', '--help'), true)
      assert.equal(hasCall(trace, 'warp-cli', '--accept-tos', 'mode', 'proxy'), false)
      assert.equal(await exists(paths['bridge-env']), false)
    },
  )
})

test('install rolls back and creates no bridge when the default route changes', async () => {
  await fakeHost(
    { command: 'install', routeChange: true },
    async ({ code, trace, paths, warpState }) => {
      assert.notEqual(code, 0)
      assert.equal(hasCall(trace, 'warp-cli', '--accept-tos', 'disconnect'), true)
      assert.equal(warpState, 'Disconnected')
      assert.equal(await exists(paths['bridge-env']), false)
      assert.equal(await exists(paths['bridge-unit']), false)
    },
  )
})

test('install writes and activates a hardened private bridge', async () => {
  await fakeHost({ command: 'install' }, async ({ code, stderr, trace, paths, bridgeState }) => {
    assert.equal(code, 0, `${stderr}\n${JSON.stringify(trace)}`)
    assert.deepEqual(
      Object.fromEntries(
        (await readFile(paths['bridge-env'], 'utf8'))
          .trim()
          .split('\n')
          .map((line) => line.split('=')),
      ),
      {
        BRIDGE_PORT: '40001',
        DOCKER_HOST_GATEWAY: '172.17.0.1',
        WARP_PROXY_PORT: '40000',
      },
    )
    const unitLines = new Set((await readFile(paths['bridge-unit'], 'utf8')).trim().split('\n'))
    for (const directive of [
      'After=docker.service warp-svc.service',
      'Requires=docker.service warp-svc.service',
      'EnvironmentFile=/etc/default/anynote-warp-bridge',
      'ExecStart=/usr/bin/socat TCP-LISTEN:${BRIDGE_PORT},bind=${DOCKER_HOST_GATEWAY},reuseaddr,fork TCP:127.0.0.1:${WARP_PROXY_PORT}',
      'User=nobody',
      'Group=nogroup',
      'NoNewPrivileges=true',
      'PrivateTmp=true',
      'ProtectHome=true',
      'ProtectSystem=strict',
      'RestrictAddressFamilies=AF_INET AF_INET6',
    ]) {
      assert.equal(unitLines.has(directive), true)
    }
    const helpIndex = trace.findIndex((entry) =>
      hasCall([entry], 'warp-cli', '--accept-tos', 'mode', '--help'),
    )
    const proxyIndex = trace.findIndex((entry) =>
      hasCall([entry], 'warp-cli', '--accept-tos', 'mode', 'proxy'),
    )
    assert.ok(proxyIndex > helpIndex && helpIndex >= 0)
    assert.equal(hasCall(trace, 'warp-cli', '--accept-tos', 'settings'), true)
    assert.equal(hasCall(trace, 'systemctl', 'enable', 'anynote-warp-bridge.service'), true)
    assert.equal(hasCall(trace, 'systemctl', 'restart', 'anynote-warp-bridge.service'), true)
    assert.equal(bridgeState, 'active')
  })
})

test('disable stops the bridge and disconnects without deleting configuration', async () => {
  await fakeHost(
    { command: 'disable', healthyStatus: true },
    async ({ code, stderr, trace, paths, warpState }) => {
      assert.equal(code, 0, `${stderr}\n${JSON.stringify(trace)}`)
      assert.equal(
        hasCall(trace, 'systemctl', 'disable', '--now', 'anynote-warp-bridge.service'),
        true,
      )
      assert.equal(hasCall(trace, 'warp-cli', '--accept-tos', 'disconnect'), true)
      assert.equal(warpState, 'Disconnected')
      assert.equal(await exists(paths['bridge-env']), true)
      assert.equal(await exists(paths['bridge-unit']), true)
      assert.equal(
        trace.some(([command]) => command === 'apt-get'),
        false,
      )
    },
  )
})

test('installer remains executable for rsync archive-mode preservation', async () => {
  assert.equal((await stat(installerPath)).mode & 0o777, 0o755)
})

test('gateway discovery rejects unsafe or unassigned addresses before writing artifacts', async () => {
  await Promise.all(
    [
      { name: 'wildcard', gateway: '0.0.0.0', assignedGateways: '0.0.0.0' },
      { name: 'public', gateway: '8.8.8.8', assignedGateways: '8.8.8.8' },
      { name: 'invalid', gateway: '999.999.999.999', assignedGateways: '999.999.999.999' },
      { name: 'loopback', gateway: '127.0.0.1', assignedGateways: '127.0.0.1' },
      { name: 'link-local', gateway: '169.254.1.1', assignedGateways: '169.254.1.1' },
      { name: 'multicast', gateway: '224.0.0.1', assignedGateways: '224.0.0.1' },
      { name: 'unassigned', gateway: '172.17.0.1', assignedGateways: '' },
    ].map((scenario) =>
      fakeHost({ command: 'install', ...scenario }, async ({ code, trace, paths, warpState }) => {
        assert.notEqual(code, 0, scenario.name)
        assert.equal(await exists(paths['bridge-env']), false, scenario.name)
        assert.equal(await exists(paths['bridge-unit']), false, scenario.name)
        assert.equal(hasCall(trace, 'warp-cli', '--accept-tos', 'disconnect'), true, scenario.name)
        assert.equal(warpState, 'Disconnected', scenario.name)
      }),
    ),
  )
})

test('WARP settings and exact loopback listener must identify one valid proxy port', async () => {
  await Promise.all(
    [
      { name: 'non-proxy settings', settingsMode: 'nonproxy' },
      { name: 'wrong settings port', settingsMode: 'wrong-port' },
      { name: 'invalid settings port', settingsMode: 'invalid-port' },
      { name: 'multiple settings ports', settingsMode: 'multiple' },
      { name: 'missing WARP listener', warpListenerMode: 'missing' },
      { name: 'multiple WARP listeners', warpListenerMode: 'multiple' },
    ].map((scenario) =>
      fakeHost({ command: 'install', ...scenario }, async ({ code, trace, warpState }) => {
        assert.notEqual(code, 0, scenario.name)
        assert.equal(hasCall(trace, 'warp-cli', '--accept-tos', 'disconnect'), true, scenario.name)
        assert.equal(warpState, 'Disconnected', scenario.name)
      }),
    ),
  )
})

test('status rejects every disconnected, non-proxy, or mismatched listener state', async () => {
  await Promise.all(
    [
      { name: 'disconnected', warpStatusOutput: 'Status update: Disconnected' },
      { name: 'non-proxy', settingsMode: 'nonproxy' },
      { name: 'wrong settings port', settingsMode: 'wrong-port' },
      { name: 'missing WARP listener', warpListenerMode: 'missing' },
      { name: 'multiple WARP listener', warpListenerMode: 'multiple' },
      { name: 'wrong bridge listener', bridgeListenerMode: 'wrong' },
      { name: 'wildcard bridge listener', bridgeListenerMode: 'wildcard' },
      { name: 'IPv6 bridge listener', bridgeListenerMode: 'ipv6' },
      { name: 'duplicate bridge listener', bridgeListenerMode: 'duplicate' },
      {
        name: 'unknown environment key',
        bridgeEnv:
          'BRIDGE_PORT=40001\nDOCKER_HOST_GATEWAY=172.17.0.1\nWARP_PROXY_PORT=40000\nEXTRA=unsafe\n',
      },
      { name: 'missing environment', healthyStatus: false },
    ].map((scenario) =>
      fakeHost(
        { command: 'status', healthyStatus: scenario.healthyStatus ?? true, ...scenario },
        async ({ code }) => assert.notEqual(code, 0, scenario.name),
      ),
    ),
  )
})

test('every post-connect failure rolls back bridge and WARP state', async () => {
  await Promise.all(
    [
      { name: 'unrecognized status', warpStatusOutput: 'Status update: Unknown' },
      { name: 'status command', failPoints: 'warp-status-command' },
      { name: 'route read', failPoints: 'route-after' },
      { name: 'port discovery', warpListenerMode: 'missing' },
      { name: 'gateway discovery', failPoints: 'docker-run' },
      { name: 'environment install', failPoints: 'install-env' },
      { name: 'unit install', failPoints: 'install-unit' },
      { name: 'daemon reload', failPoints: 'daemon-reload' },
      { name: 'bridge restart', failPoints: 'bridge-restart' },
      { name: 'final invariant status', bridgeListenerMode: 'wildcard' },
    ].map((scenario) =>
      fakeHost(
        { command: 'install', ...scenario },
        async ({ code, trace, bridgeState, warpState }) => {
          assert.notEqual(code, 0, scenario.name)
          assert.equal(
            hasCall(trace, 'systemctl', 'disable', '--now', 'anynote-warp-bridge.service'),
            true,
            scenario.name,
          )
          assert.equal(
            hasCall(trace, 'warp-cli', '--accept-tos', 'disconnect'),
            true,
            scenario.name,
          )
          assert.notEqual(bridgeState, 'active', scenario.name)
          assert.equal(warpState, 'Disconnected', scenario.name)
        },
      ),
    ),
  )
})

test('install stops an existing bridge before packages and aborts if stopping fails', async () => {
  await fakeHost(
    { command: 'install', healthyStatus: true, failPoints: 'apt-get' },
    async ({ code, trace, bridgeState }) => {
      assert.notEqual(code, 0)
      const stopIndex = trace.findIndex((entry) =>
        hasCall([entry], 'systemctl', 'disable', '--now', 'anynote-warp-bridge.service'),
      )
      const aptIndex = trace.findIndex(([command]) => command === 'apt-get')
      assert.ok(stopIndex >= 0 && aptIndex > stopIndex)
      assert.equal(bridgeState, 'inactive')
      assert.equal(hasCall(trace, 'warp-cli', '--accept-tos', 'connect'), false)
    },
  )

  await fakeHost(
    { command: 'install', healthyStatus: true, failPoints: 'bridge-disable' },
    async ({ code, trace, bridgeState }) => {
      assert.notEqual(code, 0)
      assert.equal(
        trace.some(([command]) => command === 'apt-get'),
        false,
      )
      assert.equal(hasCall(trace, 'warp-cli', '--accept-tos', 'connect'), false)
      assert.equal(bridgeState, 'active')
    },
  )
})

test('gateway must belong to a Docker bridge interface, not a private LAN interface', async () => {
  await fakeHost(
    {
      command: 'install',
      gateway: '192.168.1.10',
      assignedGateways: '192.168.1.10',
      assignedInterface: 'eth0',
    },
    async ({ code, paths }) => {
      assert.notEqual(code, 0)
      assert.equal(await exists(paths['bridge-env']), false)
    },
  )
})

test('gateway duplicated across Docker and LAN interfaces is rejected by install and status', async () => {
  const assignedAssignments = '172.17.0.1@docker0,172.17.0.1@eth0'
  await fakeHost({ command: 'install', assignedAssignments }, async ({ code, trace, paths }) => {
    assert.notEqual(code, 0)
    assert.equal(await exists(paths['bridge-env']), false)
    assert.equal(await exists(paths['bridge-unit']), false)
    assert.equal(hasCall(trace, 'systemctl', 'restart', 'anynote-warp-bridge.service'), false)
  })
  await fakeHost(
    { command: 'status', healthyStatus: true, assignedAssignments },
    async ({ code }) => assert.notEqual(code, 0),
  )
})

test('systemd LoadState inspection fails closed before packages or WARP changes', async () => {
  for (const scenario of [
    { name: 'query failure', failPoints: 'systemctl-show' },
    { name: 'empty state', systemdLoadState: 'empty' },
    { name: 'unexpected state', systemdLoadState: 'mystery' },
  ]) {
    await fakeHost({ command: 'install', ...scenario }, async ({ code, trace }) => {
      assert.notEqual(code, 0, scenario.name)
      assert.equal(
        hasCall(
          trace,
          'systemctl',
          'show',
          '--property=LoadState',
          '--value',
          'anynote-warp-bridge.service',
        ),
        true,
        scenario.name,
      )
      assert.equal(
        trace.some(([command]) => command === 'apt-get'),
        false,
        scenario.name,
      )
      assert.equal(
        hasCall(trace, 'warp-cli', '--accept-tos', 'mode', 'proxy'),
        false,
        scenario.name,
      )
      assert.equal(hasCall(trace, 'warp-cli', '--accept-tos', 'connect'), false, scenario.name)
    })
  }
})

test('a loaded active bridge without a readable fragment stops before packages', async () => {
  await fakeHost(
    { command: 'install', activeBridgeWithoutFragment: true, failPoints: 'apt-get' },
    async ({ code, trace, bridgeState }) => {
      assert.notEqual(code, 0)
      const inspectionIndex = trace.findIndex((entry) =>
        hasCall(
          [entry],
          'systemctl',
          'show',
          '--property=LoadState',
          '--value',
          'anynote-warp-bridge.service',
        ),
      )
      const stopIndex = trace.findIndex((entry) =>
        hasCall([entry], 'systemctl', 'disable', '--now', 'anynote-warp-bridge.service'),
      )
      const activeStateIndex = trace.findIndex((entry) =>
        hasCall(
          [entry],
          'systemctl',
          'show',
          '--property=ActiveState',
          '--value',
          'anynote-warp-bridge.service',
        ),
      )
      const aptIndex = trace.findIndex(([command]) => command === 'apt-get')
      assert.ok(
        inspectionIndex >= 0 &&
          stopIndex > inspectionIndex &&
          activeStateIndex > stopIndex &&
          aptIndex > activeStateIndex,
      )
      assert.equal(bridgeState, 'inactive')
      assert.equal(hasCall(trace, 'warp-cli', '--accept-tos', 'connect'), false)
    },
  )
})

test('status cross-checks the environment against the current Docker host gateway', async () => {
  await fakeHost(
    {
      command: 'status',
      healthyStatus: true,
      gateway: '172.18.0.1',
      assignedGateways: '172.17.0.1,172.18.0.1',
    },
    async ({ code }) => assert.notEqual(code, 0),
  )
})

test('an exact WARP socket duplicated by another process is rejected', async () => {
  await fakeHost(
    { command: 'status', healthyStatus: true, warpListenerMode: 'mixed-process-duplicate' },
    async ({ code }) => assert.notEqual(code, 0),
  )
})

test('an exact WARP socket owned by a similarly named process is rejected', async () => {
  await fakeHost(
    { command: 'status', healthyStatus: true, warpListenerMode: 'wrong-process' },
    async ({ code }) => assert.notEqual(code, 0),
  )
})

test('disable still disconnects and fails when stopping the bridge fails', async () => {
  await fakeHost(
    { command: 'disable', healthyStatus: true, failPoints: 'bridge-disable' },
    async ({ code, trace, warpState }) => {
      assert.notEqual(code, 0)
      assert.equal(
        hasCall(trace, 'systemctl', 'disable', '--now', 'anynote-warp-bridge.service'),
        true,
      )
      assert.equal(hasCall(trace, 'warp-cli', '--accept-tos', 'disconnect'), true)
      assert.equal(warpState, 'Disconnected')
    },
  )
})

test('a successful rerun restarts the bridge onto a changed WARP port', async () => {
  await fakeHost(
    { commands: ['install', 'install'], warpPorts: '40000,40002' },
    async ({ results, trace, bridgeUpstream, paths }) => {
      assert.deepEqual(
        results.map(({ code }) => code),
        [0, 0],
      )
      assert.equal(bridgeUpstream, '40002')
      assert.match(await readFile(paths['bridge-env'], 'utf8'), /^WARP_PROXY_PORT=40002$/m)
      assert.equal(
        trace.filter((entry) =>
          hasCall([entry], 'systemctl', 'restart', 'anynote-warp-bridge.service'),
        ).length,
        2,
      )
    },
  )
})
