import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { describe, expect, it } from '@jest/globals'

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(dir, entry.name)
      return entry.isDirectory() ? collectSourceFiles(entryPath) : entryPath
    }),
  )

  return files.flat()
}

describe('runtime module imports', () => {
  it('does not use @src aliases in application source files', async () => {
    const sourceFiles = await collectSourceFiles(join(process.cwd(), 'src'))
    const runtimeFiles = sourceFiles.filter(
      (filePath) =>
        filePath.endsWith('.ts') &&
        !filePath.endsWith('.d.ts') &&
        !filePath.endsWith('.spec.ts') &&
        !filePath.endsWith('.test.ts'),
    )

    const offenders: string[] = []

    for (const filePath of runtimeFiles) {
      const content = await readFile(filePath, 'utf8')
      if (content.includes('"@src/') || content.includes("'@src/")) {
        offenders.push(relative(process.cwd(), filePath))
      }
    }

    expect(offenders).toEqual([])
  })
})
