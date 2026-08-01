import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = fileURLToPath(new URL('../../', import.meta.url))
const activationHelperPath = join(root, 'deploy/activate-env.sh')

async function invokeActivation(
  directory,
  envTemp,
  appEnvTemp,
  expectedOwner = userInfo().username,
) {
  try {
    const output = await execFileAsync(activationHelperPath, [envTemp, appEnvTemp], {
      env: {
        ...process.env,
        ANYNOTE_PROJECT_DIR: directory,
        ANYNOTE_EXPECTED_OWNER: expectedOwner,
      },
    })
    return { ...output, code: 0 }
  } catch (error) {
    return {
      code: error.code,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    }
  }
}

async function mode(path) {
  return (await stat(path)).mode & 0o777
}

test('activation repairs upload modes and atomically replaces both live env files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'anynote-env-activation-'))
  const liveEnv = join(directory, '.env')
  const liveAppEnv = join(directory, '.app.env')
  const envTemp = join(directory, '.env.upload.success')
  const appEnvTemp = join(directory, '.app.env.upload.success')

  try {
    await writeFile(liveEnv, 'OLD_ENV=preserve-on-failure\n')
    await writeFile(liveAppEnv, 'OLD_APP_ENV=preserve-on-failure\n')
    await chmod(liveEnv, 0o600)
    await chmod(liveAppEnv, 0o600)
    const oldEnvInode = (await stat(liveEnv)).ino
    const oldAppEnvInode = (await stat(liveAppEnv)).ino

    await writeFile(envTemp, 'DATABASE_URL=postgresql://example\nTELEGRAM_PROXY_URL=\n')
    await writeFile(appEnvTemp, 'DATABASE_URL=postgresql://example\n')
    await chmod(envTemp, 0o644)
    await chmod(appEnvTemp, 0o666)

    const result = await invokeActivation(directory, envTemp, appEnvTemp)

    assert.equal(result.code, 0, result.stderr)
    assert.equal(
      await readFile(liveEnv, 'utf8'),
      'DATABASE_URL=postgresql://example\nTELEGRAM_PROXY_URL=\n',
    )
    assert.equal(await readFile(liveAppEnv, 'utf8'), 'DATABASE_URL=postgresql://example\n')
    assert.notEqual((await stat(liveEnv)).ino, oldEnvInode)
    assert.notEqual((await stat(liveAppEnv)).ino, oldAppEnvInode)
    assert.equal(await mode(liveEnv), 0o600)
    assert.equal(await mode(liveAppEnv), 0o600)
    await assert.rejects(stat(envTemp), { code: 'ENOENT' })
    await assert.rejects(stat(appEnvTemp), { code: 'ENOENT' })
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /postgresql:\/\/example/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('invalid upload pairs never alter the prior live env pair', async (t) => {
  const scenarios = [
    {
      name: 'empty env',
      env: '',
      appEnv: 'DATABASE_URL=postgresql://new\n',
    },
    {
      name: 'missing proxy line',
      env: 'DATABASE_URL=postgresql://new\n',
      appEnv: 'DATABASE_URL=postgresql://new\n',
    },
    {
      name: 'duplicate proxy lines',
      env: 'TELEGRAM_PROXY_URL=\nTELEGRAM_PROXY_URL=http://host.docker.internal:40001\n',
      appEnv: 'DATABASE_URL=postgresql://new\n',
    },
    {
      name: 'proxy leaking into app env',
      env: 'DATABASE_URL=postgresql://new\nTELEGRAM_PROXY_URL=\n',
      appEnv: 'DATABASE_URL=postgresql://new\nTELEGRAM_PROXY_URL=\n',
    },
    {
      name: 'empty app env',
      env: 'DATABASE_URL=postgresql://new\nTELEGRAM_PROXY_URL=\n',
      appEnv: '',
    },
    {
      name: 'missing app upload',
      env: 'DATABASE_URL=postgresql://new\nTELEGRAM_PROXY_URL=\n',
      appEnv: undefined,
    },
    {
      name: 'unexpected upload owner',
      env: 'DATABASE_URL=postgresql://new\nTELEGRAM_PROXY_URL=\n',
      appEnv: 'DATABASE_URL=postgresql://new\n',
      expectedOwner: 'owner-that-cannot-exist',
    },
  ]

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const directory = await mkdtemp(join(tmpdir(), 'anynote-env-reject-'))
      const liveEnv = join(directory, '.env')
      const liveAppEnv = join(directory, '.app.env')
      const envTemp = join(directory, '.env.upload.reject')
      const appEnvTemp = join(directory, '.app.env.upload.reject')

      try {
        await writeFile(liveEnv, 'LIVE_ENV=unchanged\n')
        await writeFile(liveAppEnv, 'LIVE_APP_ENV=unchanged\n')
        await chmod(liveEnv, 0o600)
        await chmod(liveAppEnv, 0o600)
        const oldEnvStat = await stat(liveEnv)
        const oldAppEnvStat = await stat(liveAppEnv)
        await writeFile(envTemp, scenario.env)
        if (scenario.appEnv !== undefined) await writeFile(appEnvTemp, scenario.appEnv)

        const result = await invokeActivation(
          directory,
          envTemp,
          appEnvTemp,
          scenario.expectedOwner,
        )

        assert.notEqual(result.code, 0)
        assert.notEqual(
          result.code,
          'ENOENT',
          'activation helper must execute before rejecting input',
        )
        assert.equal(await readFile(liveEnv, 'utf8'), 'LIVE_ENV=unchanged\n')
        assert.equal(await readFile(liveAppEnv, 'utf8'), 'LIVE_APP_ENV=unchanged\n')
        assert.equal((await stat(liveEnv)).ino, oldEnvStat.ino)
        assert.equal((await stat(liveAppEnv)).ino, oldAppEnvStat.ino)
        assert.equal(await mode(liveEnv), 0o600)
        assert.equal(await mode(liveAppEnv), 0o600)
        assert.doesNotMatch(`${result.stdout}${result.stderr}`, /postgresql:\/\/new/)
        await assert.rejects(stat(envTemp), { code: 'ENOENT' })
        await assert.rejects(stat(appEnvTemp), { code: 'ENOENT' })
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
  }
})

test('deployment helpers are executable versioned artifacts', async () => {
  assert.equal((await stat(activationHelperPath)).mode & 0o777, 0o755)
  assert.equal((await stat(join(root, 'deploy/compose.sh'))).mode & 0o777, 0o755)
})
