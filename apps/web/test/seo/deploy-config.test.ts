import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const repoRoot = resolve(process.cwd(), '../..')

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

describe('SEO deploy configuration', () => {
  it('passes public SEO values into the web Docker build', () => {
    const dockerfile = readRepoFile('apps/web/Dockerfile')
    const deployWorkflow = readRepoFile('.github/workflows/deploy.yml')

    for (const key of [
      'NEXT_PUBLIC_BASE_URL',
      'YANDEX_VERIFICATION',
      'GOOGLE_SITE_VERIFICATION',
      'SEO_NOINDEX_ALL',
    ]) {
      expect(dockerfile).toContain(`ARG ${key}`)
      expect(dockerfile).toContain(`ENV ${key}=$${key}`)
      expect(deployWorkflow).toContain(`${key}=\${{`)
    }
  })
})
