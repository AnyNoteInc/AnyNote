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
]

const stubBodies = {
  id: `
if [[ \${1:-} == -u ]]; then
  printf '%s\\n' "\${FAKE_ID_UID:-0}"
fi
`,
  dpkg: `
if [[ \${1:-} == --print-architecture ]]; then
  printf '%s\\n' "\${FAKE_ARCHITECTURE:-amd64}"
fi
`,
  docker: `
if [[ \${1:-} == run ]]; then
  printf '%s\\n' "\${FAKE_DOCKER_GATEWAY:-172.17.0.1} host.docker.internal"
fi
`,
  systemctl: `
if [[ \${1:-} == is-active ]]; then
  printf '%s\\n' active
fi
`,
  'apt-get': '',
  curl: `
case "\${*: -1}" in
  */pubkey.gpg) printf '%s\\n' fake-cloudflare-key ;;
esac
`,
  gpg: `
cat >/dev/null
output=''
while (( \$# )); do
  if [[ \$1 == --output ]]; then
    output=\$2
    break
  fi
  shift
done
[[ -z \${output} ]] || : > "\${output}"
`,
  'warp-cli': `
case "\t\${*}\t" in
  *$'\\t--accept-tos mode --help\\t'*)
    if [[ \${FAKE_WARP_PROXY_CAPABILITY:-present} == present ]]; then
      printf '%s\\n' 'Modes:' '  proxy: local proxy'
    else
      printf '%s\\n' 'Modes:' '  doh: DNS only'
    fi
    ;;
  *$'\\t--accept-tos status\\t'*) printf '%s\\n' 'Status update: Connected' ;;
esac
`,
  ip: `
if [[ \${1:-} == route && \${2:-} == show && \${3:-} == default ]]; then
  calls=0
  [[ ! -f \${FAKE_IP_CALLS_FILE} ]] || calls=\$(<"\${FAKE_IP_CALLS_FILE}")
  calls=\$((calls + 1))
  printf '%s\\n' "\${calls}" > "\${FAKE_IP_CALLS_FILE}"
  if [[ \${FAKE_ROUTE_CHANGE:-no} == yes && \${calls} -gt 1 ]]; then
    printf '%s\\n' 'default via 192.0.2.2 dev eth0'
  else
    printf '%s\\n' 'default via 192.0.2.1 dev eth0'
  fi
fi
`,
  ss: `
if [[ \${1:-} == -lntpH ]]; then
  printf '%s\\n' 'LISTEN 0 4096 127.0.0.1:40000 0.0.0.0:* users:(("warp-svc",pid=1,fd=2))'
else
  printf '%s\\n' 'LISTEN 0 4096 172.17.0.1:40001 0.0.0.0:*'
fi
`,
  sleep: '',
}

function commandTraceStub(name, body) {
  return `#!/usr/bin/env bash
set -euo pipefail
{
  printf '%s' '${name}'
  for argument in "\$@"; do
    printf '\\t%s' "\${argument}"
  done
  printf '\\n'
} >> "\${FAKE_HOST_TRACE}"
${body}`
}

async function pathExists(path) {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function parseTrace(rawTrace) {
  return rawTrace
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'))
}

function includesInvocation(trace, command, ...args) {
  return trace.some(
    (invocation) =>
      invocation[0] === command &&
      invocation.slice(1).length === args.length &&
      invocation.slice(1).every((argument, index) => argument === args[index]),
  )
}

async function withFakeHost(options, assertion) {
  const directory = await mkdtemp(join(tmpdir(), 'anynote-warp-host-'))
  const binDirectory = join(directory, 'bin')
  const tracePath = join(directory, 'trace')
  const osReleasePath = join(directory, 'os-release')
  const keyringPath = join(directory, 'cloudflare-keyring.gpg')
  const aptListPath = join(directory, 'cloudflare-client.list')
  const bridgeEnvPath = join(directory, 'anynote-warp-bridge.env')
  const bridgeUnitPath = join(directory, 'anynote-warp-bridge.service')
  const ipCallsPath = join(directory, 'ip-calls')

  try {
    await mkdir(binDirectory)
    await writeFile(tracePath, '')
    await writeFile(osReleasePath, 'ID=ubuntu\nVERSION_ID=22.04\n')

    for (const name of stubNames) {
      const path = join(binDirectory, name)
      await writeFile(path, commandTraceStub(name, stubBodies[name]))
      await chmod(path, 0o755)
    }

    if (options.existingBridgeFiles) {
      await writeFile(bridgeEnvPath, 'existing bridge environment\n')
      await writeFile(bridgeUnitPath, 'existing bridge unit\n')
    }

    const env = {
      ...process.env,
      PATH: `${binDirectory}:${process.env.PATH}`,
      ANYNOTE_WARP_OS_RELEASE_FILE: osReleasePath,
      ANYNOTE_WARP_KEYRING: keyringPath,
      ANYNOTE_WARP_APT_LIST: aptListPath,
      ANYNOTE_WARP_BRIDGE_ENV: bridgeEnvPath,
      ANYNOTE_WARP_BRIDGE_UNIT: bridgeUnitPath,
      FAKE_HOST_TRACE: tracePath,
      FAKE_IP_CALLS_FILE: ipCallsPath,
      FAKE_WARP_PROXY_CAPABILITY: options.proxyCapability ?? 'present',
      FAKE_ROUTE_CHANGE: options.routeChange ? 'yes' : 'no',
    }

    let result
    try {
      const output = await execFileAsync(installerPath, [options.command], { env })
      result = { ...output, code: 0 }
    } catch (error) {
      result = {
        code: error.code,
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? '',
      }
    }

    await assertion({
      ...result,
      bridgeEnvPath,
      bridgeUnitPath,
      keyringPath,
      aptListPath,
      trace: parseTrace(await readFile(tracePath, 'utf8')),
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('check accepts only the supported host and probes the official package endpoint', async () => {
  await withFakeHost({ command: 'check' }, async ({ code, trace }) => {
    assert.equal(code, 0)
    const curlInvocations = trace.filter(([command]) => command === 'curl')
    assert.deepEqual(curlInvocations, [
      [
        'curl',
        '-fsS',
        '--connect-timeout',
        '8',
        '--max-time',
        '12',
        'https://pkg.cloudflareclient.com/',
      ],
    ])
  })
})

test('install fails closed when local proxy capability is absent', async () => {
  await withFakeHost(
    { command: 'install', proxyCapability: 'missing' },
    async ({ code, stderr, trace, bridgeEnvPath, bridgeUnitPath }) => {
      assert.notEqual(code, 0)
      assert.match(stderr, /does not support local proxy mode/)
      assert.equal(includesInvocation(trace, 'warp-cli', '--accept-tos', 'mode', '--help'), true)
      assert.equal(includesInvocation(trace, 'warp-cli', '--accept-tos', 'mode', 'proxy'), false)
      assert.equal(
        includesInvocation(trace, 'systemctl', 'enable', '--now', 'anynote-warp-bridge.service'),
        false,
      )
      assert.equal(await pathExists(bridgeEnvPath), false)
      assert.equal(await pathExists(bridgeUnitPath), false)
    },
  )
})

test('install disconnects and leaves no bridge artifacts when the default route changes', async () => {
  await withFakeHost(
    { command: 'install', routeChange: true },
    async ({ code, stderr, trace, bridgeEnvPath, bridgeUnitPath }) => {
      assert.notEqual(code, 0)
      assert.match(stderr, /changed the default route; disconnected/)
      assert.equal(includesInvocation(trace, 'warp-cli', '--accept-tos', 'disconnect'), true)
      assert.equal(await pathExists(bridgeEnvPath), false)
      assert.equal(await pathExists(bridgeUnitPath), false)
    },
  )
})

test('install generates a private Docker bridge after proving proxy capability', async () => {
  await withFakeHost(
    { command: 'install' },
    async ({ code, stderr, trace, bridgeEnvPath, bridgeUnitPath }) => {
      assert.equal(code, 0, stderr)

      const environment = Object.fromEntries(
        (await readFile(bridgeEnvPath, 'utf8'))
          .trim()
          .split('\n')
          .map((line) => line.split('=')),
      )
      assert.deepEqual(environment, {
        BRIDGE_PORT: '40001',
        DOCKER_HOST_GATEWAY: '172.17.0.1',
        WARP_PROXY_PORT: '40000',
      })

      const installedUnit = await readFile(bridgeUnitPath, 'utf8')
      const unitLines = new Set(installedUnit.trim().split('\n'))
      assert.equal(unitLines.has('After=docker.service warp-svc.service'), true)
      assert.equal(unitLines.has('Requires=docker.service warp-svc.service'), true)
      assert.equal(unitLines.has('EnvironmentFile=/etc/default/anynote-warp-bridge'), true)
      assert.equal(
        unitLines.has(
          'ExecStart=/usr/bin/socat TCP-LISTEN:${BRIDGE_PORT},bind=${DOCKER_HOST_GATEWAY},reuseaddr,fork TCP:127.0.0.1:${WARP_PROXY_PORT}',
        ),
        true,
      )
      for (const hardeningDirective of [
        'User=nobody',
        'Group=nogroup',
        'NoNewPrivileges=true',
        'PrivateTmp=true',
        'ProtectHome=true',
        'ProtectSystem=strict',
        'RestrictAddressFamilies=AF_INET AF_INET6',
      ]) {
        assert.equal(unitLines.has(hardeningDirective), true)
      }

      const helpIndex = trace.findIndex((invocation) =>
        includesInvocation([invocation], 'warp-cli', '--accept-tos', 'mode', '--help'),
      )
      const proxyModeIndex = trace.findIndex((invocation) =>
        includesInvocation([invocation], 'warp-cli', '--accept-tos', 'mode', 'proxy'),
      )
      assert.ok(helpIndex >= 0)
      assert.ok(proxyModeIndex > helpIndex)

      const selectedModes = trace
        .filter(
          ([command, acceptTos, mode, selection]) =>
            command === 'warp-cli' &&
            acceptTos === '--accept-tos' &&
            mode === 'mode' &&
            selection !== '--help',
        )
        .map((invocation) => invocation[3])
      assert.deepEqual(selectedModes, ['proxy'])
      assert.equal(installedUnit.includes('bind=0.0.0.0'), false)
      assert.equal(
        includesInvocation(trace, 'systemctl', 'enable', '--now', 'warp-svc.service'),
        true,
      )
      assert.equal(
        includesInvocation(trace, 'systemctl', 'enable', '--now', 'anynote-warp-bridge.service'),
        true,
      )
    },
  )
})

test('disable stops the bridge and disconnects without removing configuration', async () => {
  await withFakeHost(
    { command: 'disable', existingBridgeFiles: true },
    async ({ code, trace, bridgeEnvPath, bridgeUnitPath }) => {
      assert.equal(code, 0)
      assert.equal(
        includesInvocation(trace, 'systemctl', 'disable', '--now', 'anynote-warp-bridge.service'),
        true,
      )
      assert.equal(includesInvocation(trace, 'warp-cli', '--accept-tos', 'disconnect'), true)
      assert.equal(
        trace.some(([command]) => command === 'apt-get'),
        false,
      )
      assert.equal(await readFile(bridgeEnvPath, 'utf8'), 'existing bridge environment\n')
      assert.equal(await readFile(bridgeUnitPath, 'utf8'), 'existing bridge unit\n')
    },
  )
})

test('the versioned installer is executable so archival sync preserves its mode', async () => {
  const installer = await stat(installerPath)
  assert.equal(installer.mode & 0o777, 0o755)
})
