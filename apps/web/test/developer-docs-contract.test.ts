import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { TELEGRAM_LIMITS } from '@repo/telegram'
import {
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  CHALLENGE_ECHO_SCAN_CHARS,
  COMING_EVENT_TYPES,
  DEFAULT_AUTO_DISABLE_THRESHOLD,
  DEFAULT_MAX_ATTEMPTS,
  MAX_WEBHOOK_SUBSCRIPTIONS_PER_WORKSPACE,
  WEBHOOK_DELIVERY_HEADERS,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_SECRET_PREFIX,
} from '@repo/webhooks'
import { describe, expect, it } from 'vitest'

// Drift guards: the public developer docs must keep quoting the values the
// runtime actually uses. Constants are imported from @repo/webhooks and
// @repo/telegram; values that are not exported as runtime constants (TTL zod
// enum, guard 401 messages, controller routes) are extracted from the source
// files with fs + regex so changing them breaks this suite until the docs
// follow.

const REPO_ROOT = path.join(__dirname, '../../..')
const DOCS_DIR = path.join(REPO_ROOT, 'docs/developers')

const webhooksDoc = readFileSync(path.join(DOCS_DIR, 'webhooks.md'), 'utf8')
const telegramDoc = readFileSync(path.join(DOCS_DIR, 'telegram.md'), 'utf8')
const apiDoc = readFileSync(path.join(DOCS_DIR, 'api.md'), 'utf8')

describe('webhooks.md — event catalog', () => {
  it.each([...WEBHOOK_EVENT_TYPES])('documents emitted event %s', (event) => {
    expect(webhooksDoc).toContain(event)
  })

  it.each([...COMING_EVENT_TYPES])('documents upcoming event %s', (event) => {
    expect(webhooksDoc).toContain(event)
  })
})

describe('webhooks.md — delivery contract', () => {
  it.each(Object.values(WEBHOOK_DELIVERY_HEADERS))('documents header %s', (header) => {
    expect(webhooksDoc).toContain(header)
  })

  it('documents the signature shape and secret prefix', () => {
    expect(webhooksDoc).toContain('sha256=')
    expect(webhooksDoc).toContain(WEBHOOK_SECRET_PREFIX)
    expect(webhooksDoc).toContain('{timestamp}.{body}')
  })

  it('documents the challenge echo window', () => {
    expect(webhooksDoc).toContain(`первых ${CHALLENGE_ECHO_SCAN_CHARS} символах`)
  })

  it('documents retry backoff derived from the runtime constants', () => {
    expect(webhooksDoc).toContain(`${BACKOFF_BASE_MS / 1000} с`)
    expect(webhooksDoc).toContain(`${(2 * BACKOFF_BASE_MS) / 1000} с`)
    expect(webhooksDoc).toContain(`не более ${BACKOFF_CAP_MS / 60_000} мин`)
  })

  it('documents the default max delivery attempts', () => {
    expect(webhooksDoc).toContain(`до ${DEFAULT_MAX_ATTEMPTS} попыток`)
  })

  it('documents the auto-disable threshold', () => {
    expect(webhooksDoc).toContain(
      `После ${DEFAULT_AUTO_DISABLE_THRESHOLD} неуспешных доставок подряд`,
    )
  })

  it('documents the per-workspace subscription cap', () => {
    expect(webhooksDoc).toContain(`не более ${MAX_WEBHOOK_SUBSCRIPTIONS_PER_WORKSPACE} подписок`)
  })
})

describe('telegram.md — limits and setup', () => {
  it('documents the per-connection subscription cap', () => {
    expect(telegramDoc).toContain(
      `не более ${TELEGRAM_LIMITS.maxSubscriptionsPerConnection} подписок`,
    )
  })

  it('documents the link-code TTL in minutes', () => {
    expect(telegramDoc).toContain(`${TELEGRAM_LIMITS.linkCodeTtlMs / 60_000} минут`)
  })

  it('documents the link-code length', () => {
    expect(telegramDoc).toContain(`Код — ${TELEGRAM_LIMITS.linkCodeLength} символов`)
  })

  it('documents the search query cap', () => {
    expect(telegramDoc).toContain(`до ${TELEGRAM_LIMITS.searchQueryMax} символов`)
  })

  it('points bot creation at BotFather', () => {
    expect(telegramDoc).toContain('BotFather')
  })
})

describe('api.md — authentication', () => {
  const guardSource = readFileSync(
    path.join(REPO_ROOT, 'apps/engines/src/apps/api/auth/api-key.guard.ts'),
    'utf8',
  )

  it('documents the key prefix and Bearer scheme (prefix taken from the guard source)', () => {
    const prefix = guardSource.match(/API_KEY_TOKEN_PREFIX = '([^']+)'/)?.[1]
    expect(prefix).toBeDefined()
    expect(apiDoc).toContain(`Bearer ${prefix}`)
  })

  it('documents every TTL label from the tRPC router zod enum', () => {
    const routerSource = readFileSync(
      path.join(REPO_ROOT, 'packages/trpc/src/routers/api-key.ts'),
      'utf8',
    )
    const enumBody = routerSource.match(/TtlSchema = z\.enum\(\[([^\]]+)\]\)/)?.[1]
    expect(enumBody).toBeDefined()
    const labels = [...enumBody!.matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(labels.length).toBeGreaterThanOrEqual(5)
    for (const label of labels) {
      expect(apiDoc, `TTL label ${label} missing from api.md`).toContain(`\`${label}\``)
    }
  })

  it('documents the three 401 messages verbatim from the guard source', () => {
    const messages = [...guardSource.matchAll(/UnauthorizedException\('([^']+)'\)/g)].map(
      (m) => m[1],
    )
    expect(messages).toHaveLength(3)
    for (const message of messages) {
      expect(apiDoc, `401 message "${message}" missing from api.md`).toContain(message)
    }
  })
})

/** Full route list extracted from the engines REST controller decorators. */
function extractEnginesRoutes(): string[] {
  const restDir = path.join(REPO_ROOT, 'apps/engines/src/apps/api/rest')
  const controllers = readdirSync(restDir).filter((f) => f.endsWith('.controller.ts'))
  expect(controllers.length).toBeGreaterThan(0)
  const routes: string[] = []
  for (const file of controllers) {
    const source = readFileSync(path.join(restDir, file), 'utf8')
    const controller = source.match(/@Controller\((?:'([^']*)')?\)/)
    if (!controller) throw new Error(`no @Controller decorator found in ${file}`)
    const base = controller[1] ?? ''
    for (const handler of source.matchAll(/@(?:Get|Post|Patch|Put|Delete)\((?:'([^']*)')?\)/g)) {
      const sub = handler[1] ?? ''
      routes.push(`/${[base, sub].filter(Boolean).join('/')}`)
    }
  }
  return routes
}

describe('api.md — endpoint inventory', () => {
  const routes = extractEnginesRoutes()

  it('extracts the full REST surface (new controllers/handlers must update this count)', () => {
    expect(routes).toHaveLength(19)
  })

  it.each(routes)('documents engines route %s', (route) => {
    expect(apiDoc).toContain(route)
  })

  it('mentions no /v1 path that the engines controllers do not serve', () => {
    const routeSet = new Set(routes)
    const documented = new Set([...apiDoc.matchAll(/\/v1\/[a-z/-]+/g)].map((m) => m[0]))
    expect(documented.size).toBeGreaterThan(0)
    for (const docPath of documented) {
      expect(routeSet.has(docPath), `api.md mentions ${docPath} — not an engines route`).toBe(true)
    }
  })
})
