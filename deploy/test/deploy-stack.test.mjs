import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const deployHelperPath = join(root, 'deploy/deploy-stack.sh')

async function runDeploy({ failPoint = '' } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'anynote-deploy-stack-'))
  const bin = join(directory, 'bin')
  const trace = join(directory, 'trace')
  const compose = join(directory, 'compose')

  try {
    await mkdir(bin)
    await writeFile(trace, '')
    await writeFile(
      join(bin, 'docker'),
      `#!/usr/bin/env bash
set -euo pipefail
printf 'docker' >> "$DEPLOY_TRACE"
for argument in "$@"; do printf '\\t%s' "$argument" >> "$DEPLOY_TRACE"; done
printf '\\n' >> "$DEPLOY_TRACE"
case "\${1:-}" in
  login) cat >/dev/null; [[ "$DEPLOY_FAIL_POINT" != login ]] ;;
  logout) [[ "$DEPLOY_FAIL_POINT" != logout ]] ;;
  image) [[ "\${2:-}" == prune && "$DEPLOY_FAIL_POINT" != prune ]] ;;
esac
`,
    )
    await writeFile(
      compose,
      `#!/usr/bin/env bash
set -euo pipefail
printf 'compose' >> "$DEPLOY_TRACE"
for argument in "$@"; do printf '\\t%s' "$argument" >> "$DEPLOY_TRACE"; done
printf '\\n' >> "$DEPLOY_TRACE"
[[ "$DEPLOY_FAIL_POINT" != "\${1:-}" ]]
`,
    )
    await chmod(join(bin, 'docker'), 0o755)
    await chmod(compose, 0o755)

    const result = await new Promise((resolve) => {
      const child = spawn(deployHelperPath, ['release-actor'], {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          ANYNOTE_COMPOSE_HELPER: compose,
          DEPLOY_TRACE: trace,
          DEPLOY_FAIL_POINT: failPoint,
        },
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => (stdout += chunk))
      child.stderr.on('data', (chunk) => (stderr += chunk))
      child.on('error', (error) => resolve({ code: error.code, stdout, stderr }))
      child.on('close', (code) => resolve({ code, stdout, stderr }))
      child.stdin.end('registry-token-without-newline')
    })

    return {
      ...result,
      trace: (await readFile(trace, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split('\t')),
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function hasCall(trace, command, ...args) {
  return trace.some(
    ([actualCommand, ...actualArgs]) =>
      actualCommand === command &&
      actualArgs.length === args.length &&
      actualArgs.every((argument, index) => argument === args[index]),
  )
}

test('successful deployment runs pull and up, treats only prune as best effort, and logs out', async () => {
  const result = await runDeploy({ failPoint: 'prune' })

  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(result.trace, [
    ['docker', 'login', 'ghcr.io', '-u', 'release-actor', '--password-stdin'],
    ['compose', 'pull'],
    ['compose', 'up', '-d', '--remove-orphans'],
    ['docker', 'image', 'prune', '-af'],
    ['docker', 'logout', 'ghcr.io'],
  ])
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /registry-token/)
})

test('login, pull, and up failures propagate while logout remains cleanup', async (t) => {
  for (const scenario of [
    { failPoint: 'login', expected: [['docker', 'login']] },
    {
      failPoint: 'pull',
      expected: [
        ['docker', 'login'],
        ['compose', 'pull'],
        ['docker', 'logout'],
      ],
    },
    {
      failPoint: 'up',
      expected: [
        ['docker', 'login'],
        ['compose', 'pull'],
        ['compose', 'up'],
        ['docker', 'logout'],
      ],
    },
  ]) {
    await t.test(scenario.failPoint, async () => {
      const result = await runDeploy(scenario)

      assert.notEqual(result.code, 0)
      assert.notEqual(result.code, 'ENOENT', 'versioned deploy helper must execute')
      assert.deepEqual(
        result.trace.map(([command, action]) => [command, action]),
        scenario.expected,
      )
      assert.equal(hasCall(result.trace, 'docker', 'image', 'prune', '-af'), false)
    })
  }
})

test('logout failure makes an otherwise successful deployment fail', async () => {
  const result = await runDeploy({ failPoint: 'logout' })

  assert.notEqual(result.code, 0)
  assert.equal(hasCall(result.trace, 'compose', 'up', '-d', '--remove-orphans'), true)
  assert.equal(hasCall(result.trace, 'docker', 'logout', 'ghcr.io'), true)
})
