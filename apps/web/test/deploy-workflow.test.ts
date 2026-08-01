import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const deployWorkflowPath = fileURLToPath(
  new URL('../../../.github/workflows/deploy.yml', import.meta.url),
)

describe('deploy workflow', () => {
  it('normalizes every synced artifact owner to root', async () => {
    const workflow = await readFile(deployWorkflowPath, 'utf8')
    const start = workflow.indexOf('- name: Sync deploy artifacts to server')
    const end = workflow.indexOf('- name: Pull images and bring stack up')

    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)

    const commands = workflow
      .slice(start, end)
      .replaceAll(/\\\r?\n\s*/g, ' ')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('rsync '))

    expect(commands).toHaveLength(4)
    for (const command of commands) {
      expect(command).toMatch(/(?:^|\s)--chown=root:root(?:\s|$)/)
    }
  })
})
