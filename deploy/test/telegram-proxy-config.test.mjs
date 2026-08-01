import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = fileURLToPath(new URL('../../', import.meta.url))
const proxyUrl = 'http://host.docker.internal:40001'

async function resolvedCompose(telegramProxyUrl) {
  const directory = await mkdtemp(join(tmpdir(), 'anynote-compose-'))
  const composePath = join(directory, 'compose.yml')
  const envPath = join(directory, '.env')
  const appEnvPath = join(directory, '.app.env')

  try {
    await writeFile(composePath, await readFile(join(root, 'deploy/compose.yml')))
    await writeFile(
      envPath,
      [
        'FORM_TOKEN_SECRET=01234567890123456789012345678901',
        'ACME_EMAIL=ops@anynote.ru',
        'POSTGRES_PASSWORD=test',
        'S3_ACCESS_KEY=test',
        'S3_SECRET_KEY=test',
        'S3_BUCKET=test',
        'QDRANT__AUTH__BEARER_TOKEN=test',
        `TELEGRAM_PROXY_URL=${telegramProxyUrl}`,
      ].join('\n'),
    )
    await writeFile(
      appEnvPath,
      [
        'FORM_TOKEN_SECRET=01234567890123456789012345678901',
        'ACME_EMAIL=ops@anynote.ru',
        'POSTGRES_PASSWORD=test',
        'S3_ACCESS_KEY=test',
        'S3_SECRET_KEY=test',
        'S3_BUCKET=test',
        'QDRANT__AUTH__BEARER_TOKEN=test',
      ].join('\n'),
    )
    const { stdout } = await execFileAsync(
      'docker',
      ['compose', '--env-file', envPath, '-f', composePath, 'config', '--format', 'json'],
      { env: process.env },
    )
    return JSON.parse(stdout)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('resolved Compose routes only Telegram-capable services to the host bridge', async () => {
  const compose = await resolvedCompose(proxyUrl)
  const proxyServiceNames = new Set(['web', 'engines'])

  for (const [serviceName, service] of Object.entries(compose.services)) {
    if (proxyServiceNames.has(serviceName)) {
      assert.equal(service.environment.TELEGRAM_PROXY_URL, proxyUrl)
      assert.deepEqual(service.extra_hosts, ['host.docker.internal=host-gateway'])
      continue
    }

    assert.equal(Object.hasOwn(service.environment ?? {}, 'TELEGRAM_PROXY_URL'), false)
    assert.equal(service.extra_hosts, undefined)
  }
})

test('resolved Compose preserves an explicitly disabled Telegram proxy', async () => {
  const compose = await resolvedCompose('')
  assert.equal(compose.services.web.environment.TELEGRAM_PROXY_URL, '')
  assert.equal(compose.services.engines.environment.TELEGRAM_PROXY_URL, '')

  for (const [serviceName, service] of Object.entries(compose.services)) {
    if (serviceName === 'web' || serviceName === 'engines') continue

    assert.equal(Object.hasOwn(service.environment ?? {}, 'TELEGRAM_PROXY_URL'), false)
  }
})
