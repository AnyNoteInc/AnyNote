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

describe('deploy .env template substitution', () => {
  // Guards the recurring "var in .env.template but not in the deploy.yml render
  // step's env: block" bug. envsubst with an unset var writes an empty string,
  // so the container boots with KEY= and fails at runtime (e.g. PlantUML render
  // 500s, yjs crash-loops). Every ${VAR} the template substitutes must be
  // supplied by the render step. A handful of vars are intentionally derived
  // from another var rather than provided directly.
  const DERIVED_FROM_OTHER_VAR = new Set([
    'YOOKASSA_RETURN_URL_BASE', // = ${NEXT_PUBLIC_BASE_URL}
  ])

  // Optional vars whose consumer supplies a code default when the env value is
  // empty, so a blank substitution is harmless and they need not be wired.
  // PLANTUML_TIMEOUT_MS: render.ts getEnv(..., String(DEFAULT_TIMEOUT_MS)).
  const DEFAULTED_IN_CODE = new Set(['PLANTUML_TIMEOUT_MS'])

  it('provides every substituted template var in the render step env block', () => {
    const template = readRepoFile('deploy/.env.template')
    const deployWorkflow = readRepoFile('.github/workflows/deploy.yml')

    // Collect every ${VAR} referenced on the right-hand side of an assignment.
    const referenced = new Set<string>()
    for (const match of template.matchAll(/\$\{([A-Z0-9_]+)\}/g)) {
      if (match[1]) referenced.add(match[1])
    }

    const missing = [...referenced]
      .filter((key) => !DERIVED_FROM_OTHER_VAR.has(key))
      .filter((key) => !DEFAULTED_IN_CODE.has(key))
      .filter((key) => !deployWorkflow.includes(`${key}:`))

    expect(missing, `template vars missing from deploy.yml render env block: ${missing.join(', ')}`).toEqual([])
  })
})
