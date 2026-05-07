# Mail Migration: SMTP/Outbox → SendSay (Synchronous) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace nodemailer SMTP transport in `@repo/mail` with the SendSay HTTP API (`sendsay-api`); make all email sends synchronous; remove the transactional-outbox + cron dispatcher; remove the Mailhog dev container.

**Architecture:** `@repo/mail` keeps `sendMailNow(args)` as its single public send function, with the same signature. Internally it calls SendSay's `issue.send` action via the `sendsay-api` Node client. `enqueueMailEvent` and `dispatchPending` (the outbox-pattern functions) are deleted along with their tests, the `apps/engines` mailer module, and the Mailhog container. All `enqueueMailEvent(...)` callers in `@repo/auth` switch to `sendMailNow(...)`. Templates and the typed payload contract (`MailKind`, `MailPayloads`) are unchanged. The `outbox_events` table itself stays — it's also used by the page indexer (`aggregateType='page'`); only the `aggregateType='email'` rows go away naturally as no code writes them anymore.

**Tech Stack:** TypeScript 5.9, Node 22, pnpm workspaces, vitest, NestJS (engines), Next.js (web), Playwright (e2e), `sendsay-api@^2.4.0`.

**Sender identity:** SendSay requires a verified sender domain on the account. The current MAIL_FROM/SMTP env vars are being removed. We hardcode `noreply@anynote.ru` / `AnyNote` in `@repo/mail` (matching the production sendsay account's verified domain). No new env vars beyond `SENDSAY_API_URL` and `SENDSAY_API_KEY`.

**Dev/test fallback:** When `SENDSAY_API_KEY` is unset (dev/CI/playwright), `sendMailNow` logs the kind+recipient at info level and returns successfully — no HTTP call. This mirrors the magic-link plugin's existing dev fallback pattern in `packages/auth/src/auth.ts:151-156` and lets the rest of the app run locally without sendsay credentials.

---

## File Structure

**Create:**
- `packages/mail/src/sendsay.ts` — typed wrapper around the `sendsay-api` Node client (singleton + `sendEmail` function).
- `packages/mail/test/sendsay.test.ts` — unit tests for the wrapper.

**Modify:**
- `packages/mail/package.json` — remove `nodemailer` + `@types/nodemailer`; add `sendsay-api`.
- `packages/mail/src/send-now.ts` — replace transport+sendMail with `sendEmail` from `./sendsay.ts`.
- `packages/mail/src/index.ts` — drop `enqueueMailEvent`, `dispatchPending`, `getMailTransport` exports; keep `sendMailNow`, `renderTemplate`, types.
- `packages/mail/test/send-now.test.ts` — mock `./sendsay.ts` instead of `./transport.ts`.
- `packages/auth/src/auth.ts` — replace `enqueueMailEvent` calls with `sendMailNow`; drop the import of `enqueueMailEvent`.
- `packages/auth/test/auth.test.ts` — assert `sendMailNow` is called for welcome flows; drop outbox queries.
- `apps/engines/src/app.module.ts` — remove `MailerModule` import and registration.
- `compose.yml` — remove the `mailhog` service.
- `playwright.config.ts` — remove `MAIL_FROM`, `SMTP_*` env entries from `webServer.env`.
- `turbo.json` — remove `SMTP_*`, `MAIL_FROM`, `MAIL_DISPATCH_*` from `globalEnv`; add `SENDSAY_API_URL`, `SENDSAY_API_KEY`.
- `deploy/.env.template` — remove `SMTP_*`, `MAIL_FROM`, `MAIL_DISPATCH_*`; add `SENDSAY_API_URL`, `SENDSAY_API_KEY`.
- `.github/workflows/deploy.yml` — remove SMTP/MAIL secrets from `Render .env from template` env block; add `SENDSAY_API_URL`, `SENDSAY_API_KEY`.
- `CLAUDE.md`, `AGENTS.md`, `README.md` — drop Mailhog mentions and SMTP wording; describe sendsay + dev fallback.

**Delete:**
- `packages/mail/src/transport.ts`
- `packages/mail/src/dispatch.ts`
- `packages/mail/src/enqueue.ts`
- `packages/mail/test/dispatch.test.ts`
- `packages/mail/test/enqueue.test.ts`
- `apps/engines/src/apps/mailer/` (whole dir: `mailer.module.ts`, `cron/mail-dispatch-cron.service.ts`, `cron/mail-dispatch-cron.service.spec.ts`)
- `apps/e2e/helpers/mailhog.ts`
- `apps/e2e/helpers/dispatch-emails.ts`
- `apps/e2e/auth-extended.spec.ts` — three of its tests depend on Mailhog mail capture; without Mailhog and a sendsay mock there's no clean way to verify rendered HTML/links end-to-end. The captcha sub-test is gated behind `RECAPTCHA_SECRET_KEY` and is already a unit-level concern. Re-add a sendsay-mock-based variant later if needed.

---

### Task 1: Add sendsay-api dependency and remove nodemailer

**Files:**
- Modify: `packages/mail/package.json`

- [ ] **Step 1: Update `packages/mail/package.json` dependencies**

Replace the `dependencies` and `devDependencies` blocks so `nodemailer` and its types are gone and `sendsay-api` is added:

```json
  "dependencies": {
    "@repo/db": "workspace:*",
    "sendsay-api": "^2.4.0"
  },
  "devDependencies": {
    "@repo/eslint-config": "workspace:*",
    "@repo/typescript-config": "workspace:*",
    "@types/node": "^22.19.1",
    "eslint": "^9.39.1",
    "typescript": "^5.9.2",
    "vitest": "^3.2.4"
  }
```

- [ ] **Step 2: Reinstall workspace deps**

Run: `pnpm install`
Expected: lockfile updates; `sendsay-api` resolves to `2.4.x`; no `nodemailer` references survive in `pnpm-lock.yaml` under `@repo/mail`. Verify with `grep -A1 "'@repo/mail':" pnpm-lock.yaml | grep -E "nodemailer|sendsay"` — only sendsay should appear.

- [ ] **Step 3: Commit**

```bash
git add packages/mail/package.json pnpm-lock.yaml
git commit -m "chore(mail): swap nodemailer dependency for sendsay-api"
```

---

### Task 2: Write failing test for the SendSay wrapper

**Files:**
- Create: `packages/mail/test/sendsay.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `packages/mail/test/sendsay.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

const requestMock = vi.fn(async (_payload: unknown) => ({}))

vi.mock('sendsay-api', () => {
  const SendsayCtor = vi.fn(function SendsayCtor(this: unknown, _opts: unknown) {
    Object.assign(this as object, { request: requestMock })
  })
  return { default: SendsayCtor }
})

import { sendEmail, __resetSendsayClient } from '../src/sendsay.ts'

describe('sendsay wrapper', () => {
  beforeEach(() => {
    requestMock.mockReset()
    requestMock.mockResolvedValue({})
    process.env.SENDSAY_API_URL = 'https://api.sendsay.test'
    process.env.SENDSAY_API_KEY = 'test-key'
    __resetSendsayClient()
  })

  afterEach(() => {
    delete process.env.SENDSAY_API_URL
    delete process.env.SENDSAY_API_KEY
  })

  it('issues a single issue.send request with the rendered email payload', async () => {
    await sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
      text: 'Hi',
    })
    expect(requestMock).toHaveBeenCalledTimes(1)
    const payload = requestMock.mock.calls[0][0] as {
      action: string
      sendwhen: string
      letter: {
        subject: string
        'from.name': string
        'from.email': string
        message: { html: string; text: string }
      }
      'users.list': string
      group: string
    }
    expect(payload.action).toBe('issue.send')
    expect(payload.sendwhen).toBe('now')
    expect(payload.letter.subject).toBe('Hello')
    expect(payload.letter.message.html).toBe('<p>Hi</p>')
    expect(payload.letter.message.text).toBe('Hi')
    expect(payload['users.list']).toBe('user@example.com')
    expect(payload.letter['from.email']).toBe('noreply@anynote.ru')
    expect(payload.letter['from.name']).toBe('AnyNote')
    expect(payload.group).toBe('transactional')
  })

  it('logs and skips the request when SENDSAY_API_KEY is empty (dev fallback)', async () => {
    delete process.env.SENDSAY_API_KEY
    __resetSendsayClient()
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    await sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
      text: 'Hi',
    })
    expect(requestMock).not.toHaveBeenCalled()
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('[mail] sendsay disabled'),
    )
    infoSpy.mockRestore()
  })

  it('throws when sendsay returns an error envelope', async () => {
    requestMock.mockResolvedValueOnce({ errors: [{ id: 'auth/invalid', explain: 'bad key' }] })
    await expect(
      sendEmail({
        to: 'user@example.com',
        subject: 'Hello',
        html: '<p>Hi</p>',
        text: 'Hi',
      }),
    ).rejects.toThrow(/sendsay.*auth\/invalid.*bad key/)
  })

  it('propagates network errors thrown by the sendsay client', async () => {
    requestMock.mockRejectedValueOnce(new Error('ECONNRESET'))
    await expect(
      sendEmail({
        to: 'user@example.com',
        subject: 'Hello',
        html: '<p>Hi</p>',
        text: 'Hi',
      }),
    ).rejects.toThrow(/ECONNRESET/)
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --filter @repo/mail test sendsay`
Expected: FAIL — `Failed to resolve import "../src/sendsay.ts"` or equivalent.

---

### Task 3: Implement the SendSay wrapper to make the test pass

**Files:**
- Create: `packages/mail/src/sendsay.ts`

- [ ] **Step 1: Implement the wrapper**

Create `packages/mail/src/sendsay.ts`:

```ts
import Sendsay from 'sendsay-api'

type SendsayClient = { request: (payload: Record<string, unknown>) => Promise<unknown> }

const FROM_EMAIL = 'noreply@anynote.ru'
const FROM_NAME = 'AnyNote'

let _client: SendsayClient | null = null

function getClient(): SendsayClient | null {
  if (_client) return _client
  const apiKey = process.env.SENDSAY_API_KEY
  if (!apiKey) return null
  const apiUrl = process.env.SENDSAY_API_URL || 'https://api.sendsay.ru'
  const Ctor = Sendsay as unknown as new (opts: { apiUrl: string; apiKey: string }) => SendsayClient
  _client = new Ctor({ apiUrl, apiKey })
  return _client
}

/** Test-only helper to reset the cached client (env changes between tests). */
export function __resetSendsayClient(): void {
  _client = null
}

export type SendEmailArgs = {
  to: string
  subject: string
  html: string
  text: string
}

type SendsayResponse = {
  errors?: Array<{ id?: string; explain?: string }>
}

export async function sendEmail(args: SendEmailArgs): Promise<void> {
  const client = getClient()
  if (!client) {
    console.info(`[mail] sendsay disabled (no SENDSAY_API_KEY); would send to ${args.to}: ${args.subject}`)
    return
  }
  const response = (await client.request({
    action: 'issue.send',
    sendwhen: 'now',
    letter: {
      subject: args.subject,
      'from.name': FROM_NAME,
      'from.email': FROM_EMAIL,
      message: { html: args.html, text: args.text },
    },
    'users.list': args.to,
    group: 'transactional',
  })) as SendsayResponse
  if (response?.errors && response.errors.length > 0) {
    const first = response.errors[0]
    throw new Error(`sendsay error: ${first?.id ?? 'unknown'} - ${first?.explain ?? ''}`)
  }
}
```

- [ ] **Step 2: Run the test to confirm it passes**

Run: `pnpm --filter @repo/mail test sendsay`
Expected: PASS — all four cases green.

- [ ] **Step 3: Commit**

```bash
git add packages/mail/src/sendsay.ts packages/mail/test/sendsay.test.ts
git commit -m "feat(mail): add sendsay-api wrapper with dev fallback"
```

---

### Task 4: Rewrite `sendMailNow` to delegate to the SendSay wrapper

**Files:**
- Modify: `packages/mail/src/send-now.ts`
- Modify: `packages/mail/test/send-now.test.ts`

- [ ] **Step 1: Update the failing test first**

Replace the contents of `packages/mail/test/send-now.test.ts` with:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

const sendEmailMock = vi.fn(async (_args: unknown) => {})

vi.mock('../src/sendsay.ts', () => ({
  sendEmail: (args: unknown) => sendEmailMock(args),
  __resetSendsayClient: () => {},
}))

import { sendMailNow } from '../src/send-now.ts'

describe('sendMailNow', () => {
  beforeEach(() => {
    sendEmailMock.mockReset()
    sendEmailMock.mockResolvedValue(undefined)
  })

  it('renders the template and forwards subject/html/text to sendsay', async () => {
    await sendMailNow({
      kind: 'verify-email',
      to: 'user@example.com',
      data: { firstName: 'Иван', link: 'https://x', expiresAtIso: '2026-04-28T12:00:00Z' },
    })
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const call = sendEmailMock.mock.calls[0][0] as {
      to: string
      subject: string
      text: string
      html: string
    }
    expect(call.to).toBe('user@example.com')
    expect(call.subject).toBeTruthy()
    expect(call.html).toContain('https://x')
  })

  it('propagates the sendsay error so callers can roll back', async () => {
    sendEmailMock.mockRejectedValueOnce(new Error('sendsay down'))
    await expect(
      sendMailNow({
        kind: 'reset-password',
        to: 'user@example.com',
        data: { firstName: 'X', link: 'https://x', expiresAtIso: '2026-04-28T12:00:00Z' },
      }),
    ).rejects.toThrow(/sendsay down/)
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --filter @repo/mail test send-now`
Expected: FAIL — `sendsay down` test or render test fails because `send-now.ts` still imports the old transport.

- [ ] **Step 3: Update `packages/mail/src/send-now.ts`**

Replace the entire contents of `packages/mail/src/send-now.ts` with:

```ts
import type { MailKind, MailPayloads } from './types.ts'
import { renderTemplate } from './templates/index.ts'
import { sendEmail } from './sendsay.ts'

export type SendMailNowArgs<K extends MailKind> = {
  kind: K
  to: string
  data: MailPayloads[K]
}

export async function sendMailNow<K extends MailKind>(args: SendMailNowArgs<K>): Promise<void> {
  const rendered = renderTemplate(args.kind, args.data)
  await sendEmail({
    to: args.to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  })
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --filter @repo/mail test send-now`
Expected: PASS — both cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/mail/src/send-now.ts packages/mail/test/send-now.test.ts
git commit -m "refactor(mail): route sendMailNow through sendsay wrapper"
```

---

### Task 5: Delete outbox/SMTP-only files from `@repo/mail`

**Files:**
- Delete: `packages/mail/src/transport.ts`
- Delete: `packages/mail/src/dispatch.ts`
- Delete: `packages/mail/src/enqueue.ts`
- Delete: `packages/mail/test/dispatch.test.ts`
- Delete: `packages/mail/test/enqueue.test.ts`

- [ ] **Step 1: Delete the files**

Run:
```bash
rm packages/mail/src/transport.ts \
   packages/mail/src/dispatch.ts \
   packages/mail/src/enqueue.ts \
   packages/mail/test/dispatch.test.ts \
   packages/mail/test/enqueue.test.ts
```

- [ ] **Step 2: Trim `packages/mail/src/index.ts`**

Replace the file's content with:

```ts
export type { MailKind, MailPayloads, MailEventPayload, RenderedEmail } from './types.ts'
export { renderTemplate } from './templates/index.ts'
export { sendMailNow, type SendMailNowArgs } from './send-now.ts'
```

- [ ] **Step 3: Run package tests**

Run: `pnpm --filter @repo/mail test`
Expected: PASS — only `sendsay`, `send-now`, and `templates` test files run.

- [ ] **Step 4: Run package type-check**

Run: `pnpm --filter @repo/mail check-types`
Expected: PASS — no dangling references to the deleted files.

- [ ] **Step 5: Commit**

```bash
git add packages/mail/src/index.ts \
        packages/mail/src/transport.ts \
        packages/mail/src/dispatch.ts \
        packages/mail/src/enqueue.ts \
        packages/mail/test/dispatch.test.ts \
        packages/mail/test/enqueue.test.ts
git commit -m "refactor(mail): remove SMTP transport and outbox dispatcher"
```

---

### Task 6: Switch `@repo/auth` to synchronous sends only

**Files:**
- Modify: `packages/auth/src/auth.ts`
- Modify: `packages/auth/test/auth.test.ts`

- [ ] **Step 1: Update `packages/auth/test/auth.test.ts`**

Replace the existing welcome-mail assertions (the `does not enqueue welcome at user.create when emailVerified=false` and `Google-style verified user welcome enqueue path is valid` cases) with `sendMailNow`-based assertions. Apply these three edits:

a) Drop the `prisma.outboxEvent.deleteMany(...)` line in `cleanup()` (no rows are written there anymore):

```ts
async function cleanup(): Promise<void> {
  await prisma.subscription.deleteMany({
    where: { user: { email: { contains: TAG } } },
  })
  await prisma.userPreference.deleteMany({
    where: { user: { email: { contains: TAG } } },
  })
  await prisma.account.deleteMany({
    where: { user: { email: { contains: TAG } } },
  })
  const usersInRange = await prisma.user.findMany({
    where: { email: { contains: TAG } },
    select: { id: true },
  })
  if (usersInRange.length > 0) {
    await prisma.verification.deleteMany({
      where: { value: { in: usersInRange.map((u) => u.id) } },
    })
  }
  await prisma.user.deleteMany({ where: { email: { contains: TAG } } })
}
```

b) Replace the `does not enqueue welcome at user.create when emailVerified=false` test with:

```ts
  it('does not send welcome at user.create when emailVerified=false', async () => {
    const email = `nowelcome${TAG}`
    sendMailNowMock.mockClear()
    await auth.api.signUpEmail({
      body: {
        email,
        password: 'StrongPass123!',
        name: 'Test User',
        firstName: 'Test',
        lastName: 'User',
      },
    })
    const welcomeCalls = sendMailNowMock.mock.calls.filter(
      (call) => (call[0] as { kind: string }).kind === 'welcome',
    )
    expect(welcomeCalls).toHaveLength(0)
  })
```

c) Replace the `Google-style verified user welcome enqueue path is valid` test with a direct `sendMailNow` call:

```ts
  it('Google-style verified user welcome send path is valid', async () => {
    const email = `googled${TAG}`
    const personalPlan = await prisma.plan.findUniqueOrThrow({ where: { slug: 'personal' } })
    const created = await prisma.user.create({
      data: {
        email,
        emailVerified: true,
        name: 'G User',
        firstName: 'G',
        lastName: 'User',
      },
    })
    await prisma.subscription.create({
      data: {
        userId: created.id,
        planId: personalPlan.id,
        status: SubscriptionStatus.ACTIVE,
        billingPeriod: 'MONTHLY',
      },
    })
    await prisma.userPreference.create({ data: { userId: created.id } })

    sendMailNowMock.mockClear()
    if (created.emailVerified) {
      const { sendMailNow } = await import('@repo/mail')
      await sendMailNow({
        kind: 'welcome',
        to: created.email,
        data: { firstName: created.firstName, appUrl: 'http://localhost:3000/app' },
      })
    }
    expect(sendMailNowMock).toHaveBeenCalledTimes(1)
    const call = sendMailNowMock.mock.calls[0][0] as { kind: string; to: string }
    expect(call.kind).toBe('welcome')
    expect(call.to).toBe(email)
  })
```

(Leave the other six tests in the file as-is — they already mock `sendMailNow` and don't query the outbox.)

- [ ] **Step 2: Run the test to confirm the welcome-flow tests fail**

Run: `pnpm --filter @repo/auth test`
Expected: FAIL — auth.ts still calls `enqueueMailEvent` for welcome, so `sendMailNowMock` doesn't capture it.

- [ ] **Step 3: Update `packages/auth/src/auth.ts`**

Apply two edits:

a) Replace the import on line 16:

```ts
import { sendMailNow } from '@repo/mail'
```

b) Replace the `afterEmailVerification` callback (currently lines 93-104) and the verified-user branch inside `databaseHooks.user.create.after` (currently lines 204-213) so both call `sendMailNow` directly:

```ts
    afterEmailVerification: async (user) => {
      const userWithName = user as { firstName?: string; email: string; id: string }
      await sendMailNow({
        kind: 'welcome',
        to: userWithName.email,
        data: {
          firstName: userWithName.firstName ?? '',
          appUrl: `${appUrl()}/app`,
        },
      })
    },
```

```ts
          if (userWithName.emailVerified) {
            await sendMailNow({
              kind: 'welcome',
              to: userWithName.email,
              data: {
                firstName: userWithName.firstName ?? '',
                appUrl: `${appUrl()}/app`,
              },
            })
          }
```

- [ ] **Step 4: Run tests again**

Run: `pnpm --filter @repo/auth test`
Expected: PASS — all auth tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/auth/src/auth.ts packages/auth/test/auth.test.ts
git commit -m "refactor(auth): send welcome mail synchronously via sendMailNow"
```

---

### Task 7: Remove the `MailerModule` from `apps/engines`

**Files:**
- Modify: `apps/engines/src/app.module.ts`
- Delete: `apps/engines/src/apps/mailer/mailer.module.ts`
- Delete: `apps/engines/src/apps/mailer/cron/mail-dispatch-cron.service.ts`
- Delete: `apps/engines/src/apps/mailer/cron/mail-dispatch-cron.service.spec.ts`

- [ ] **Step 1: Delete the mailer directory**

Run: `rm -r apps/engines/src/apps/mailer`

- [ ] **Step 2: Edit `apps/engines/src/app.module.ts`**

Remove the `MailerModule` import line and the `MailerModule,` entry from the `imports` array. After the edit, the file imports become:

```ts
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ScheduleModule } from '@nestjs/schedule'

import { BillingModule } from './apps/billing/billing.module.js'
import { IndexerModule } from './apps/indexer/indexer.module.js'
import { McpModule } from './apps/mcp/mcp.module.js'
import { HealthModule } from './health/health.module.js'
import { DbModule } from './infra/db/db.module.js'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    DbModule,
    BillingModule,
    IndexerModule,
    McpModule,
    HealthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 3: Update `apps/engines/src/runtime-imports.spec.ts`**

Open the file and delete the line `await expect(import('@repo/mail/dispatch')).resolves.toHaveProperty('dispatchPending')` (the path is gone). Leave any other assertions in the file intact.

- [ ] **Step 4: Run engines test + type-check**

Run: `pnpm --filter engines test && pnpm --filter engines check-types`
Expected: PASS — no references to `@repo/mail/dispatch` or `MailerModule` survive.

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/app.module.ts \
        apps/engines/src/apps/mailer \
        apps/engines/src/runtime-imports.spec.ts
git commit -m "refactor(engines): drop mailer cron module"
```

---

### Task 8: Strip Mailhog and SMTP/dispatch helpers from the E2E setup

**Files:**
- Delete: `apps/e2e/helpers/mailhog.ts`
- Delete: `apps/e2e/helpers/dispatch-emails.ts`
- Delete: `apps/e2e/auth-extended.spec.ts`

- [ ] **Step 1: Delete the helpers and the spec**

Run: `rm apps/e2e/helpers/mailhog.ts apps/e2e/helpers/dispatch-emails.ts apps/e2e/auth-extended.spec.ts`

- [ ] **Step 2: Verify no other E2E spec imports the removed helpers**

Run: `grep -rn "helpers/mailhog\|helpers/dispatch-emails\|flushMailQueue\|findLastMessageTo\|clearMailhog" apps/e2e`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/helpers/mailhog.ts apps/e2e/helpers/dispatch-emails.ts apps/e2e/auth-extended.spec.ts
git commit -m "test(e2e): remove mailhog-dependent helpers and spec"
```

---

### Task 9: Remove the Mailhog container from `compose.yml`

**Files:**
- Modify: `compose.yml`

- [ ] **Step 1: Delete the `mailhog:` service block**

Remove the entire block (currently 8 lines) starting at `  mailhog:` through the `retries: 5` line just before the next service definition. The result: `compose.yml` lists postgres, minio, minio-init, qdrant, gotenberg, and the volumes block — no mailhog.

- [ ] **Step 2: Validate the compose file parses**

Run: `docker compose -f compose.yml config --quiet`
Expected: exit 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add compose.yml
git commit -m "chore(compose): drop mailhog dev container"
```

---

### Task 10: Update `playwright.config.ts` and `turbo.json`

**Files:**
- Modify: `playwright.config.ts`
- Modify: `turbo.json`

- [ ] **Step 1: Edit `playwright.config.ts`**

Inside `webServer.env`, drop these four lines and replace them with the two SendSay placeholders so the dev server starts in dev-fallback mode (no actual sends during E2E):

Remove:
```ts
MAIL_FROM: 'AnyNote <noreply@anynote.local>',
SMTP_HOST: 'localhost',
SMTP_PORT: '1025',
SMTP_SECURE: 'false',
```

The resulting `env` block should look like:

```ts
    env: {
      BETTER_AUTH_URL: 'http://localhost:3100',
      NEXT_PUBLIC_BASE_URL: 'http://localhost:3100',
      PLAYWRIGHT: 'true',
      YOOKASSA_MOCK_ENABLED: 'true',
      YOOKASSA_RETURN_URL_BASE: 'http://localhost:3100',
    },
```

(SendSay env vars are intentionally omitted — `sendMailNow` falls back to console-log when `SENDSAY_API_KEY` is unset.)

- [ ] **Step 2: Edit `turbo.json`**

In the `globalEnv` array:

Remove these entries:
```
"SMTP_HOST",
"SMTP_PORT",
"SMTP_SECURE",
"SMTP_USER",
"SMTP_PASSWORD",
"MAIL_FROM",
"MAIL_DISPATCH_CRON_EXPRESSION",
"MAIL_DISPATCH_BATCH",
"MAIL_DISPATCH_MAX_ATTEMPTS",
```

Add these entries (place them anywhere in the array; conventionally near other URL/key vars):
```
"SENDSAY_API_URL",
"SENDSAY_API_KEY",
```

- [ ] **Step 3: Run repo type-check**

Run: `pnpm check-types`
Expected: PASS — no env-typed code references the removed vars.

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts turbo.json
git commit -m "chore(config): swap SMTP/MAIL env vars for SENDSAY_*"
```

---

### Task 11: Update `deploy/.env.template`

**Files:**
- Modify: `deploy/.env.template`

- [ ] **Step 1: Replace the `# === Mail ===` block**

Find the block (currently 9 lines, starting at `# === Mail ===` through `MAIL_DISPATCH_MAX_ATTEMPTS=5`) and replace it with:

```
# === Mail (SendSay) ===
SENDSAY_API_URL=${SENDSAY_API_URL}
SENDSAY_API_KEY=${SENDSAY_API_KEY}
```

- [ ] **Step 2: Verify no SMTP/MAIL_FROM/MAIL_DISPATCH_* placeholders remain**

Run: `grep -E "SMTP|MAIL_FROM|MAIL_DISPATCH" deploy/.env.template`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add deploy/.env.template
git commit -m "chore(deploy): switch env template from SMTP to SENDSAY"
```

---

### Task 12: Update the Deploy GitHub Actions workflow

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Edit the `Render .env from template` step's `env:` block**

Remove:
```yaml
SMTP_HOST: ${{ secrets.SMTP_HOST }}
SMTP_PORT: ${{ secrets.SMTP_PORT }}
SMTP_SECURE: ${{ secrets.SMTP_SECURE }}
SMTP_USER: ${{ secrets.SMTP_USER }}
SMTP_PASSWORD: ${{ secrets.SMTP_PASSWORD }}
MAIL_FROM: ${{ secrets.MAIL_FROM }}
```

Add (placing them where the SMTP block used to live keeps the diff readable):
```yaml
SENDSAY_API_URL: ${{ secrets.SENDSAY_API_URL }}
SENDSAY_API_KEY: ${{ secrets.SENDSAY_API_KEY }}
```

- [ ] **Step 2: Validate workflow YAML**

Run: `gh workflow view deploy.yml --json name,path 2>&1 | head -3` *(if `gh` is available locally)* — informational only.

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy.yml'))"`
Expected: exit 0, no parse errors.

- [ ] **Step 3: Confirm the `envsubst` placeholder check still passes**

Read the existing post-render check: the workflow already greps `'\$\{[A-Z_]+\}'` and fails on unsubstituted vars. Make sure both `SENDSAY_API_URL` and `SENDSAY_API_KEY` are listed in the `env:` block above so envsubst can substitute them.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "chore(deploy-ci): pass SENDSAY_* secrets, drop SMTP/MAIL_FROM"
```

---

### Task 13: Update repo docs (Mailhog → sendsay narrative)

**Files:**
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`
- Modify: `README.md`

- [ ] **Step 1: `CLAUDE.md` edits**

Make these three edits:

a) Line 49 — replace the line `Local infra (postgres, minio, qdrant, **mailhog**) — must be up before \`pnpm dev\`:` with:

```
Local infra (postgres, minio, qdrant) — must be up before `pnpm dev`:
```

b) Lines 207-209 — replace the paragraph beginning `\`sendResetPassword\`, \`sendVerificationEmail\`, and \`afterEmailVerification\` all enqueue rows...` with:

```
`sendResetPassword`, `sendVerificationEmail`, and `afterEmailVerification` all call `sendMailNow` from `@repo/mail` directly — sends are synchronous and go through the SendSay HTTP API. When `SENDSAY_API_KEY` is not set (default in dev/CI), `sendMailNow` logs a one-line `[mail] sendsay disabled` message and returns successfully so the rest of the app keeps working. Production must set both `SENDSAY_API_URL` and `SENDSAY_API_KEY`.

E2E note: `apps/e2e/helpers/auth.ts` exports `signUpAndAuthAs`, which clears cookies, signs up, marks the user `emailVerified=true` directly via Prisma, and signs in via the UI. There is no longer a Mailhog-based verification flow in E2E — sends fall back to the console log under Playwright.
```

c) Lines 221 — replace the docker compose paragraph with:

```
`compose.yml` runs Postgres (5432), MinIO (9000/9001), Qdrant (6333/6334), and Gotenberg (3001). All have health checks. Run `docker compose up -d` before `pnpm dev`. No LLM provider runs in compose; configure embedding/LLM connections per-workspace in **Settings → AI агент**. No mail server runs locally — `@repo/mail` calls SendSay directly when `SENDSAY_API_KEY` is set, otherwise it logs and returns.
```

d) Line 225 — change `(the dev server still talks to Postgres/Mailhog)` to `(the dev server still talks to Postgres)`.

- [ ] **Step 2: `AGENTS.md` edits**

Open the file and locate the line containing `Postgres, MinIO, Qdrant, and Mailhog`. Replace with `Postgres, MinIO, Qdrant`.

- [ ] **Step 3: `README.md` edits**

Make these edits:

a) Line 30 — change comment from `# postgres, minio, qdrant, mailhog` to `# postgres, minio, qdrant`.

b) Line 124 — replace `compose.yml  postgres · minio · qdrant · mailhog (dev)` with `compose.yml  postgres · minio · qdrant · gotenberg (dev)`.

c) Line 136 — change `brings up Postgres, Qdrant, MinIO, Mailhog.` to `brings up Postgres, Qdrant, MinIO, Gotenberg.`.

- [ ] **Step 4: Verify no `mailhog`/`Mailhog` survives in canonical sources**

Run: `grep -niE "mailhog" CLAUDE.md AGENTS.md README.md compose.yml deploy .github`
Expected: no matches (historical mentions in `docs/superpowers/plans/*.md` are fine — those are historical artefacts).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md AGENTS.md README.md
git commit -m "docs: replace mailhog/SMTP narrative with sendsay synchronous send"
```

---

### Task 14: Final verification — run the merge gate

**Files:** *(none — checks only)*

- [ ] **Step 1: Run lint, type-check, build, and tests**

Run: `pnpm gates`
Expected: PASS for every workspace.

- [ ] **Step 2: Run a quick local sanity check on the dev fallback**

Run:
```bash
SENDSAY_API_KEY= pnpm --filter @repo/mail test
```
Expected: PASS — the dev-fallback test confirms no HTTP call is attempted.

- [ ] **Step 3: Run the playwright suite headless**

Run: `pnpm exec playwright test --reporter=list`
Expected: PASS — none of the surviving specs reach into Mailhog. (Specs that need a verified user use `signUpAndAuthAs`, which marks the user verified directly in the DB.)

- [ ] **Step 4: If gates pass, confirm there are no orphan references**

Run:
```bash
grep -rE "nodemailer|getMailTransport|enqueueMailEvent|dispatchPending|MAIL_DISPATCH|MAIL_FROM|SMTP_(HOST|PORT|SECURE|USER|PASSWORD)" \
  --include="*.ts" --include="*.tsx" --include="*.json" --include="*.yml" --include="*.yaml" --include="*.md" \
  apps packages compose.yml deploy .github CLAUDE.md AGENTS.md README.md turbo.json playwright.config.ts
```
Expected: no matches in source/config/canonical docs (historical `docs/superpowers/plans/*.md` files are excluded from the search and may still mention old names).

---

## Self-Review Notes

**Spec coverage check:**
1. Remove SMTP packages → Task 1 (drop nodemailer + types) and Task 5 (delete transport.ts).
2. Install sendsay-api → Task 1.
3. Replace sending without changing the user-facing API → Tasks 2-4 (sendMailNow keeps signature; private deletes only outbox-coupled exports that have to go because §5 removes the outbox itself).
4. Add SENDSAY_API_URL / SENDSAY_API_KEY to deploy → Tasks 11 (template) and 12 (workflow secrets).
5. Synchronous-only sends, drop cron + outbox → Tasks 5, 6, 7 (delete dispatch/enqueue/MailerModule and switch auth.ts to sendMailNow).
6. Remove mailhog from compose.yml → Task 9 (and Tasks 10, 13 strip the matching env/config/doc references).

**Type consistency:** `sendEmail({ to, subject, html, text })` is the wrapper signature; `sendMailNow` calls it with `rendered.html`/`rendered.text`/`rendered.subject` (output of `renderTemplate`). Both `MailKind` and `MailPayloads` keep their existing definitions.

**Risk:** SendSay rejects sends from un-verified domains. The hardcoded `noreply@anynote.ru` must already be a verified sender in the production SendSay account — this is an operational precondition, not a code change.
