# Contact Form Telegram Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver valid submissions from the public homepage contact form to one configured Telegram chat through the server-side Bot API.

**Architecture:** Add a public `POST /api/contact` route in `apps/web` that validates the request, checks same-origin and a five-per-ten-minutes per-IP in-memory limit, then calls the existing `TelegramApi.sendMessage` with `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`. Keep the form client-side and make it display loading, success, and retryable error states without exposing Telegram configuration.

**Tech Stack:** Next.js App Router route handlers, Zod 4, React 19, MUI wrappers from `@repo/ui`, `@repo/telegram`, Vitest, Testing Library, and GitHub Actions `envsubst` deployment configuration.

## Global Constraints

- Use only server-side `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`; never use `NEXT_PUBLIC_*` names for them.
- The endpoint is `POST /api/contact` and accepts JSON.
- Require non-empty `name`, `phone`, valid `email`, and both consent flags equal to `true`.
- Enforce limits: `name` 120, `company` 200, `phone` 50, `email` 320, `message` 2000 characters.
- Rate limit to 5 requests per IP per 10 minutes per application instance.
- Require an `Origin` matching `NEXT_PUBLIC_BASE_URL`, with the existing request-host fallback when that variable is absent.
- Escape all interpolated values before sending Telegram HTML.
- Never persist contact requests, log their personal data, or add live Telegram calls to tests.
- Preserve unrelated existing worktree changes in analytics, deployment, and other files.

---

### Task 1: Add and test the server-side contact endpoint

**Files:**
- Create: `apps/web/src/app/api/contact/route.ts`
- Test: `apps/web/test/api/contact-route.test.ts`

**Interfaces:**
- Consumes JSON `{ name, company, email, phone, message, consentPersonalData, consentMarketing }`.
- Produces `200 { ok: true }` on Telegram success; `400` for invalid JSON/data; `403` for an invalid or missing origin; `429` for the IP limit; `502` for Telegram/network failure; `503` when either Telegram variable is absent.
- Exposes `__testHooks.resetRateLimit(): void` solely as a deterministic test seam, matching existing public-route test patterns.

- [ ] **Step 1: Write the failing route tests**

Create a `NextRequest` helper against `http://localhost:3000/api/contact` with the app origin and a unique `x-forwarded-for` value. Stub global `fetch` so the real `TelegramApi` code runs without a live Telegram request. In `beforeEach`, set both env values, reset the rate-limit hook, clear the fetch mock, and use fake timers; restore timers and env in `afterEach`.

Cover these behaviors:

```ts
it('sends a valid request to the configured chat and escapes Telegram HTML', async () => {
  const res = await callRoute({
    name: '<Ирина>',
    company: 'Acme & Co',
    email: 'irina@example.com',
    phone: '+7 900 000-00-00',
    message: '<b>нужен SSO</b>',
    consentPersonalData: true,
    consentMarketing: true,
  })

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe('https://api.telegram.org/botbot-token/sendMessage')
  expect(JSON.parse(String(init.body))).toMatchObject({ chat_id: '-100123' })
  expect(JSON.parse(String(init.body)).text).toContain('&lt;Ирина&gt;')
  expect(JSON.parse(String(init.body)).text).not.toContain('<Ирина>')
  expect(JSON.parse(String(init.body)).text).toContain('&lt;b&gt;нужен SSO&lt;/b&gt;')
})

it('rejects invalid data without calling Telegram', async () => {
  const res = await callRoute({
    name: '',
    company: '',
    email: 'not-an-email',
    phone: '',
    message: '',
    consentPersonalData: true,
    consentMarketing: false,
  })

  expect(res.status).toBe(400)
  expect(fetchMock).not.toHaveBeenCalled()
})

it('rejects a cross-origin request before contacting Telegram', async () => {
  const res = await callRoute(validPayload, { origin: 'https://evil.example' })

  expect(res.status).toBe(403)
  expect(fetchMock).not.toHaveBeenCalled()
})

it('returns 503 when Telegram configuration is missing', async () => {
  vi.stubEnv('TELEGRAM_BOT_TOKEN', '')
  const res = await callRoute(validPayload)

  expect(res.status).toBe(503)
  expect(await res.json()).toEqual({ error: 'Сервис заявок временно недоступен.' })
  expect(fetchMock).not.toHaveBeenCalled()
})

it('returns a neutral 502 when Telegram rejects the message', async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ ok: false, description: 'Unauthorized' }), { status: 401 }),
  )

  const res = await callRoute(validPayload)

  expect(res.status).toBe(502)
  const body = await res.json()
  expect(body).toEqual({ error: 'Не удалось отправить заявку. Попробуйте ещё раз.' })
  expect(JSON.stringify(body)).not.toContain('bot-token')
})

it('returns 429 on the sixth request from one IP and allows another IP', async () => {
  for (let i = 0; i < 5; i += 1) expect((await callRoute(validPayload)).status).toBe(200)

  expect((await callRoute(validPayload)).status).toBe(429)
  expect((await callRoute(validPayload, { ip: '198.51.100.2' })).status).toBe(200)
  vi.advanceTimersByTime(10 * 60 * 1000 + 1)
  expect((await callRoute(validPayload)).status).toBe(200)
})
```

Use a `validPayload` object with the exact seven fields above and a helper that accepts `{ origin?, ip? }` overrides. Assert that malformed bodies and overlong strings return `400`, while a missing origin returns `403`, all without an outbound call.

- [ ] **Step 2: Run the focused route test and confirm the expected red failure**

Run:

```bash
pnpm --filter web exec vitest run test/api/contact-route.test.ts
```

Expected: Vitest fails because `apps/web/src/app/api/contact/route.ts` does not exist yet. Fix only test setup errors if they occur; do not add production code before the route tests fail for the missing behavior.

- [ ] **Step 3: Implement the minimal route**

Create the Node-runtime route with these exact rules:

```ts
const ContactSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    company: z.string().trim().max(200).default(''),
    email: z.string().trim().email().max(320),
    phone: z.string().trim().min(1).max(50),
    message: z.string().trim().max(2000).default(''),
    consentPersonalData: z.literal(true),
    consentMarketing: z.literal(true),
  })
  .strict()
```

Implement `clientIpOf`, `isSameAppOrigin`, and `isRateLimited` using the same first-hop `x-forwarded-for` handling and origin fallback as `apps/web/src/app/api/sso/resolve/route.ts`. Store only timestamps in the module-level rate-limit map. Parse with `await req.json().catch(() => null)` and return the safe Russian error bodies from the interface section.

Build the Telegram text with `escapeHtml` from `@repo/telegram`, include labels for all five form values, use `—` for empty optional values, and append `new Date().toISOString()` as the submission time. Call:

```ts
try {
  const result = await new TelegramApi(token).sendMessage(chatId, renderContactMessage(parsed.data))
  if (!result.ok) {
    return NextResponse.json(
      { error: 'Не удалось отправить заявку. Попробуйте ещё раз.' },
      { status: 502 },
    )
  }
} catch {
  return NextResponse.json(
    { error: 'Не удалось отправить заявку. Попробуйте ещё раз.' },
    { status: 502 },
  )
}
return NextResponse.json({ ok: true })
```

Do not include the Telegram result description in the response or logs.

- [ ] **Step 4: Run the focused route tests and make them green**

Run:

```bash
pnpm --filter web exec vitest run test/api/contact-route.test.ts
```

Expected: all contact-route tests pass with no network access. If the route test fails, adjust implementation only; keep the request contract and status mapping unchanged.

- [ ] **Step 5: Commit the server endpoint**

```bash
git add apps/web/src/app/api/contact/route.ts apps/web/test/api/contact-route.test.ts
git commit -m "feat(web): add Telegram contact endpoint"
```

### Task 2: Connect the homepage form to the endpoint

**Files:**
- Modify: `apps/web/src/components/public/contact-form.tsx`
- Modify: `apps/web/test/contact-form.test.tsx`

**Interfaces:**
- The existing `ContactForm` remains the public component rendered by `HomeContact`.
- It sends the five form values plus `consentPersonalData` and `consentMarketing` to `/api/contact`.
- It keeps form values and checkbox states after a failed request and clears them only after a `200` response.

- [ ] **Step 1: Extend the existing component test with failing interaction tests**

Use `userEvent.setup()` and a `vi.fn<typeof fetch>()` global stub. Add a helper that fills all five inputs and clicks both consent test IDs. Add tests with these assertions:

```ts
it('posts the completed form and shows the success message', async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ ok: true }))
  const user = userEvent.setup()
  render(<ContactForm />)
  await fillAndConsent(user)
  await user.click(screen.getByRole('button', { name: 'Отправить запрос' }))

  expect(fetchMock).toHaveBeenCalledWith('/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Ирина',
      company: 'Acme',
      email: 'irina@example.com',
      phone: '+7 900 000-00-00',
      message: 'Нужен SSO',
      consentPersonalData: true,
      consentMarketing: true,
    }),
  })
  expect(await screen.findByText('Заявка отправлена. Мы свяжемся в течение дня.')).toBeVisible()
  expect(screen.getByLabelText(/^Имя/)).toHaveValue('')
})

it('disables the submit button while the request is pending', async () => {
  let resolveRequest!: (response: Response) => void
  fetchMock.mockReturnValueOnce(new Promise((resolve) => { resolveRequest = resolve }))
  const user = userEvent.setup()
  render(<ContactForm />)
  await fillAndConsent(user)
  await user.click(screen.getByRole('button', { name: 'Отправить запрос' }))

  expect(screen.getByRole('button', { name: 'Отправка...' })).toBeDisabled()
  resolveRequest(Response.json({ ok: true }))
  expect(await screen.findByText('Заявка отправлена. Мы свяжемся в течение дня.')).toBeVisible()
})

it('shows an error and preserves the entered values when the request fails', async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ error: 'Не удалось отправить заявку. Попробуйте ещё раз.' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    }),
  )
  const user = userEvent.setup()
  render(<ContactForm />)
  await fillAndConsent(user)
  await user.click(screen.getByRole('button', { name: 'Отправить запрос' }))

  expect(await screen.findByText('Не удалось отправить заявку. Попробуйте ещё раз.')).toBeVisible()
  expect(screen.getByLabelText(/^Имя/)).toHaveValue('Ирина')
  expect(screen.getByTestId('contact-form-consent')).toBeChecked()
})
```

Keep the current test that verifies all five fields and add a validation test proving that missing consents do not call `fetch`.

- [ ] **Step 2: Run the focused component test and confirm the expected red failure**

Run:

```bash
pnpm --filter web exec vitest run test/contact-form.test.tsx
```

Expected: the new interaction tests fail because the component still logs and clears synchronously instead of making the request.

- [ ] **Step 3: Implement loading, request, success, and error states**

Change `handleSubmit` to `async`, keep the existing consent validation before any request, and add `isSubmitting` and `submitError` state. On submit, send the exact payload and headers from the test. Treat any non-2xx response or fetch rejection as the same neutral error message. Set `submitted` only after success; clear the five fields and both consent flags only after success; always clear `isSubmitting` in `finally`.

Remove the existing `console.log`. Render an error `Alert` when `submitError` is set. While submitting, render `Отправка...` and set the button's `disabled` prop. Preserve all entered state in the error branch.

- [ ] **Step 4: Run the focused component tests and make them green**

Run:

```bash
pnpm --filter web exec vitest run test/contact-form.test.tsx
```

Expected: all contact form tests pass, including the existing field-rendering test.

- [ ] **Step 5: Commit the form integration**

```bash
git add apps/web/src/components/public/contact-form.tsx apps/web/test/contact-form.test.tsx
git commit -m "feat(web): submit homepage contact form"
```

### Task 3: Wire production and local environment configuration

**Files:**
- Modify: `.env.example`
- Modify: `deploy/.env.template`
- Modify: `.github/workflows/deploy.yml`

**Interfaces:**
- Local developers see empty `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` entries in `.env.example`.
- Production deployment receives both GitHub repository secrets and renders them into `/opt/anynote/.env`, which `deploy/compose.yml` already passes to the web container through `env_file`.

- [ ] **Step 1: Add the local environment contract**

In the existing Telegram section of `.env.example`, add:

```dotenv
# Fixed destination for public homepage contact requests.
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

Do not add sample credentials or any `NEXT_PUBLIC_` alias.

- [ ] **Step 2: Add production template substitutions**

In the Telegram section of `deploy/.env.template`, add:

```dotenv
# Fixed destination for public homepage contact requests.
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}
```

In the `Render .env from template` step of `.github/workflows/deploy.yml`, add `TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}` and `TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}` to the step `env` map. Do not pass either value as a Docker build argument.

- [ ] **Step 3: Verify deployment wiring without exposing values**

Run:

```bash
rg -n 'TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID' .env.example deploy/.env.template .github/workflows/deploy.yml
git diff --check -- .env.example deploy/.env.template .github/workflows/deploy.yml
```

Expected: each name appears in the local template, production template, and workflow runtime env map; no actual token or chat ID appears in the diff.

- [ ] **Step 4: Commit the configuration wiring**

```bash
git add .env.example deploy/.env.template .github/workflows/deploy.yml
git commit -m "chore(deploy): pass Telegram contact secrets to web"
```

### Task 4: Run focused and repository-level verification

**Files:**
- No new files.

- [ ] **Step 1: Run all focused tests**

```bash
pnpm --filter web exec vitest run test/api/contact-route.test.ts test/contact-form.test.tsx
```

Expected: all route and form tests pass.

- [ ] **Step 2: Run web lint and type checking**

```bash
pnpm --filter web lint
pnpm --filter web check-types
```

Expected: both commands complete successfully. Existing unrelated type failures must be distinguished from failures in the changed files.

- [ ] **Step 3: Inspect the final diff and status**

```bash
git diff HEAD~3 --stat
git diff --check HEAD~3
git status --short
```

Confirm the implementation contains no `console.log` from the contact form, no Telegram token in client code, no live Telegram endpoint in tests, and no accidental edits to the user's pre-existing analytics changes.

- [ ] **Step 4: Report the deployment requirement**

After the code is merged, the next production deployment must run so the workflow renders the two already-configured GitHub secrets into the runtime `.env`. Verify the first real submission in the configured Telegram chat after deployment.
