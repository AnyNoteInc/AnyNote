# Contact Form Telegram tRPC Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bespoke contact route with a public `contact.submit` tRPC mutation while preserving Telegram delivery and the current form UX.

**Architecture:** Move validation, same-origin checking, per-IP rate limiting, Telegram formatting, and Bot API delivery into `packages/trpc/src/routers/contact.ts`. Register it in `appRouter`; the existing `/api/trpc` route remains the only HTTP transport. The homepage form uses the existing `TRPCReactProvider` from `(about)/layout.tsx` and calls `trpc.contact.submit.useMutation()`.

**Tech Stack:** tRPC v11, Zod 4, `@repo/telegram`, React 19, MUI wrappers from `@repo/ui`, Vitest, and Testing Library.

## Global Constraints

- Use only server-side `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
- Keep the public mutation input as `name`, `company`, `email`, `phone`, `message`, `consentPersonalData`, and `consentMarketing`.
- Require non-empty `name`, `phone`, valid `email`, and both consent flags equal to `true`.
- Enforce limits: `name` 120, `company` 200, `phone` 50, `email` 320, `message` 2000 characters.
- Rate limit to 5 requests per IP per 10 minutes per application instance.
- Require a same-origin browser request; reject missing or cross-origin `Origin` headers.
- Escape all interpolated values before sending Telegram HTML.
- Never persist contact requests, log their personal data, or add live Telegram calls to tests.
- Preserve unrelated existing worktree changes.

---

### Task 1: Add and test the public contact tRPC router

**Files:**
- Create: `packages/trpc/src/routers/contact.ts`
- Modify: `packages/trpc/src/index.ts`
- Create: `packages/trpc/test/contact-router.test.ts`
- Delete: `apps/web/src/app/api/contact/route.ts`
- Delete: `apps/web/test/api/contact-route.test.ts`

**Interfaces:**
- Consumes: the existing tRPC `Context` with `headers` and `resHeaders`, plus `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
- Produces: `contact.submit(input)` returning `{ ok: true }` or a tRPC error with no Telegram token or upstream description.

- [ ] **Step 1: Write the failing router tests**

Call the registered router through `createCaller` with a context containing `headers`, `resHeaders`, and the existing required context ports. Stub global `fetch` so the real `TelegramApi` runs without a live Telegram request. Cover valid delivery and HTML escaping, invalid and overlong input, missing and cross-origin headers, missing configuration, Telegram rejection, network failure, and the sixth request from one IP.

The success assertion must verify the exact tRPC input shape and the Telegram request:

```ts
const result = await caller.contact.submit({
  name: '<Ирина>',
  company: 'Acme & Co',
  email: 'irina@example.com',
  phone: '+7 900 000-00-00',
  message: '<b>нужен SSO</b>',
  consentPersonalData: true,
  consentMarketing: true,
})

expect(result).toEqual({ ok: true })
const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
expect(url).toBe('https://api.telegram.org/botbot-token/sendMessage')
const body = JSON.parse(String(init.body)) as { chat_id: string; text: string }
expect(body.chat_id).toBe('-100123')
expect(body.text).toContain('&lt;Ирина&gt;')
expect(body.text).not.toContain('<Ирина>')
expect(body.text).toContain('&lt;b&gt;нужен SSO&lt;/b&gt;')
```

Assert `BAD_REQUEST`, `FORBIDDEN`, `PRECONDITION_FAILED`, `BAD_GATEWAY`, and `TOO_MANY_REQUESTS` respectively, and ensure none of the safe error messages contains the bot token or Telegram's upstream description.

- [ ] **Step 2: Run the focused router tests and confirm red**

Run:

```bash
pnpm --filter @repo/trpc exec vitest run test/contact-router.test.ts
```

Expected: fail because `contactRouter` and `appRouter.contact` do not exist yet.

- [ ] **Step 3: Implement the minimal router**

Create `contactRouter` with a `publicProcedure` mutation and this input schema:

```ts
const contactInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  company: z.string().trim().max(200).default(''),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().min(1).max(50),
  message: z.string().trim().max(2000).default(''),
  consentPersonalData: z.literal(true),
  consentMarketing: z.literal(true),
}).strict()
```

Check `ctx.headers.get('origin')` against `NEXT_PUBLIC_BASE_URL`, falling back to `BETTER_AUTH_URL`, then the request host with the forwarded protocol. Consume a module-level five-per-ten-minute IP limiter. Throw only safe `TRPCError` messages. Use `TelegramApi` and `escapeHtml`; return `{ ok: true }` only after Telegram reports success. Export a resettable limiter factory or test seam without exposing secrets.

Register `contact: contactRouter` in `appRouter`. Remove the bespoke route and route-level tests after equivalent router coverage exists.

- [ ] **Step 4: Run router tests green**

Run:

```bash
pnpm --filter @repo/trpc exec vitest run test/contact-router.test.ts
```

Expected: all contact router tests pass without network access.

- [ ] **Step 5: Commit the router refactor**

```bash
git add packages/trpc/src/routers/contact.ts packages/trpc/src/index.ts packages/trpc/test/contact-router.test.ts apps/web/src/app/api/contact/route.ts apps/web/test/api/contact-route.test.ts
git commit -m "refactor(trpc): move contact delivery into router"
```

### Task 2: Connect the homepage form to tRPC

**Files:**
- Modify: `apps/web/src/components/public/contact-form.tsx`
- Modify: `apps/web/test/contact-form.test.tsx`

**Interfaces:**
- Consumes: `trpc.contact.submit.useMutation()` from `@/trpc/client`.
- Produces: the existing loading, success, and retryable error UX with fields preserved on failure and cleared only after mutation success.

- [ ] **Step 1: Rewrite the component test for the tRPC mutation**

Mock `@/trpc/client` with a `useMutation` seam exposing `mutateAsync`. Replace fetch assertions with:

```ts
expect(mutateAsyncMock).toHaveBeenCalledWith({
  name: 'Ирина',
  company: 'Acme',
  email: 'irina@example.com',
  phone: '+7 900 000-00-00',
  message: 'Нужен SSO',
  consentPersonalData: true,
  consentMarketing: true,
})
```

Keep tests for missing consents, pending state, success reset, and failed submission preserving entered values.

- [ ] **Step 2: Run the focused form test and confirm red**

Run:

```bash
pnpm --filter web exec vitest run test/contact-form.test.tsx
```

Expected: fail because the component still calls `/api/contact` and the test now expects the tRPC mutation.

- [ ] **Step 3: Switch the form to `mutateAsync`**

Import `trpc` from `@/trpc/client`, create the `contact.submit` mutation at component scope, and pass all seven fields to `mutateAsync`. Preserve the current local loading state and all existing success/error messages. Do not read Telegram environment variables in client code.

- [ ] **Step 4: Run form tests green**

Run:

```bash
pnpm --filter web exec vitest run test/contact-form.test.tsx
```

Expected: all contact form tests pass.

- [ ] **Step 5: Commit the form migration**

```bash
git add apps/web/src/components/public/contact-form.tsx apps/web/test/contact-form.test.tsx
git commit -m "refactor(web): submit contact form through trpc"
```

### Task 3: Verify the integrated change

**Files:**
- No additional production files expected.

- [ ] **Step 1: Run package and web checks**

Run:

```bash
pnpm --filter @repo/trpc check-types
pnpm --filter @repo/trpc lint
pnpm --filter @repo/trpc test
pnpm --filter web exec vitest run test/contact-form.test.tsx
pnpm --filter web check-types
```

If a check exposes a pre-existing unrelated failure, record it separately and do not alter unrelated worktree changes.

- [ ] **Step 2: Review the final diff**

Run `git status --short` and a targeted diff review. Confirm `/api/contact` is gone, Telegram config references remain server/deployment configuration only, and no personal data or secrets are logged.
