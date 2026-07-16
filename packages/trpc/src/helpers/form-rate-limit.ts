import { createHmac, randomBytes } from 'node:crypto'

export type FormRateLimitScope = 'replay-ip' | 'submit-ip' | 'submit-form' | 'upload-ip'

export interface FormRateLimiter {
  consume(scope: FormRateLimitScope, key: string, now: number): boolean
}

type FormRateLimiterOptions = {
  salt?: Uint8Array
  maxKeys?: number
}

type RateLimitEntry = {
  scope: FormRateLimitScope
  timestamps: number[]
  lastSeen: number
}

const MAX_KEYS = 20_000
const PROCESS_SALT = randomBytes(32)

const LIMITS: Record<FormRateLimitScope, { attempts: number; windowMs: number }> = {
  // Early replay is a pre-CAPTCHA convenience path, so cap its DB probes
  // conservatively and globally per client IP.
  'replay-ip': { attempts: 30, windowMs: 10 * 60 * 1_000 },
  'submit-ip': { attempts: 10, windowMs: 10 * 60 * 1_000 },
  'submit-form': { attempts: 100, windowMs: 60 * 1_000 },
  'upload-ip': { attempts: 30, windowMs: 10 * 60 * 1_000 },
}

class InMemoryFormRateLimiter implements FormRateLimiter {
  readonly #entries = new Map<string, RateLimitEntry>()
  readonly #salt: Uint8Array
  readonly #maxKeys: number

  constructor(options: FormRateLimiterOptions) {
    this.#salt = options.salt ?? PROCESS_SALT
    this.#maxKeys = options.maxKeys ?? MAX_KEYS
    if (!Number.isInteger(this.#maxKeys) || this.#maxKeys < 1) {
      throw new TypeError('maxKeys must be a positive integer')
    }
  }

  consume(scope: FormRateLimitScope, key: string, now: number): boolean {
    const storageKey = this.#storageKey(scope, key)
    const limit = LIMITS[scope]
    const existing = this.#entries.get(storageKey)
    const timestamps =
      existing?.timestamps.filter((timestamp) => timestamp > now - limit.windowMs) ?? []

    if (timestamps.length >= limit.attempts) {
      if (existing) {
        existing.timestamps = timestamps
        existing.lastSeen = now
      }
      return false
    }

    if (!existing) {
      this.#pruneExpired(now)
      if (this.#entries.size >= this.#maxKeys) this.#evictOldest()
    }

    timestamps.push(now)
    this.#entries.set(storageKey, { scope, timestamps, lastSeen: now })
    return true
  }

  #storageKey(scope: FormRateLimitScope, key: string): string {
    const digest = createHmac('sha256', this.#salt).update(key).digest('hex')
    return `${scope}:${digest}`
  }

  #pruneExpired(now: number): void {
    for (const [key, entry] of this.#entries) {
      const windowMs = LIMITS[entry.scope].windowMs
      if (!entry.timestamps.some((timestamp) => timestamp > now - windowMs)) {
        this.#entries.delete(key)
      }
    }
  }

  #evictOldest(): void {
    let oldestKey: string | undefined
    let oldestSeen = Number.POSITIVE_INFINITY
    for (const [key, entry] of this.#entries) {
      if (entry.lastSeen < oldestSeen) {
        oldestKey = key
        oldestSeen = entry.lastSeen
      }
    }
    if (oldestKey) this.#entries.delete(oldestKey)
  }
}

export function createFormRateLimiter(options: FormRateLimiterOptions = {}): FormRateLimiter {
  return new InMemoryFormRateLimiter(options)
}

export const formRateLimiter: FormRateLimiter = createFormRateLimiter()

export function formClientIp(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headers.get('x-real-ip')?.trim() ??
    'unknown'
  )
}
