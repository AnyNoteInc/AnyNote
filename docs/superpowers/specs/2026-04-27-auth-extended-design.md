# Расширенная аутентификация: почта, Google OAuth, восстановление пароля, подтверждение email, reCAPTCHA

**Status:** Approved (design)
**Date:** 2026-04-27
**Owner:** AnyNote auth track

## 1. Цели и рамки

Расширить текущую аутентификацию AnyNote:

1. **Инфраструктура почты** — Mailhog в Docker Compose, новый пакет `@repo/mail` с 9 шаблонами писем.
2. **Редизайн `/sign-in`** — добавить brand-icon, Google-кнопку, "Запомнить меня", ссылку на восстановление, ссылку на регистрацию.
3. **Редизайн `/sign-up`** — brand-icon, упорядоченные поля, ссылка "Назад ко входу".
4. **Google OAuth** через `@repo/auth` (better-auth `socialProviders.google`).
5. **Восстановление пароля** — страница `/reset-credentials` (запрос) + `/reset-credentials/[token]` (форма нового пароля). Ссылка действует 3 часа, одноразовая. После смены — редирект на `/sign-in`.
6. **Подтверждение email** — авто-отправка письма при регистрации, ссылка действует 3 часа.
7. **reCAPTCHA v3** на `/sign-in`, `/sign-up`, `/reset-credentials`.

### Out of scope (явно)

- Wire-up для 6 из 9 шаблонов (`password-changed`, `email-changed`, `new-login`, `suspicious-activity`, `invitation`, `account-deletion`) — только сами шаблоны и dispatch-инфраструктура. Триггеры подключим в отдельной задаче.
- Замена/удаление существующего `magicLink`-плагина — оставлен no-op как сейчас.
- Account lock-out при N неудачных попытках — better-auth уже имеет rate-limit; кастомная логика — отдельная задача.
- Production-настройка SPF/DKIM/реальный SMTP-провайдер — Mailhog покрывает dev, prod-доставка конфигурируется только env-переменными без кода.

## 2. Архитектура отправки писем

```
better-auth callback / app code
        ↓ (insert OutboxEvent: aggregate_type='email', event_type='email.send')
   prisma.outboxEvent.create
        ↓ (cron tick каждые 30 секунд в apps/engines)
   apps/engines/src/apps/mailer/cron/MailDispatchCronService
        ↓ (claim FOR UPDATE SKIP LOCKED → render template → SMTP)
   nodemailer → mailhog (dev) / реальный SMTP (prod)
        ↓ (mark DONE / FAILED + retry с exponential back-off)
```

**Решения:**

- Используем существующую таблицу `OutboxEvent` — поля `attempts`, `nextAttemptAt`, `lockedAt`, `lockedBy`, `lastError` уже есть. **Никаких schema-изменений в этой задаче.**
- Один `event_type='email.send'` для всех шаблонов; конкретный шаблон передаётся в `payload.kind`. Это упрощает claim-запрос в cron.
- Welcome-email отправляется при переходе `User.emailVerified false→true` (через `emailVerification.afterEmailVerification` callback) И сразу после `databaseHooks.user.create.after`, если пользователь создан через Google (там `emailVerified=true` ставится better-auth автоматически).
- reCAPTCHA v3 — невидимая, серверная валидация через плагин better-auth `captcha` с `minScore=0.5`. Применяется к endpoints `/sign-in/email`, `/sign-up/email`, `/forget-password`.

## 3. Пакет `@repo/mail`

### Структура

```
packages/mail/
├── package.json              # exports: ".", "./templates", "./transport", "./dispatch"
├── tsconfig.json             # extends @repo/typescript-config/base
├── src/
│   ├── index.ts              # типы + enqueueMailEvent() helper
│   ├── types.ts              # MailKind, MailPayloads, RenderedEmail, MailEventPayload
│   ├── enqueue.ts            # enqueueMailEvent(prisma, args) → insert OutboxEvent
│   ├── transport.ts          # 'server-only' — createMailTransport() через nodemailer
│   ├── dispatch.ts           # 'server-only' — claimBatch + processRow для cron
│   ├── utils.ts              # esc(), formatRuDateTime()
│   └── templates/
│       ├── index.ts                          # registry: kind → render(payload)
│       ├── verify-email.ts
│       ├── welcome.ts
│       ├── reset-password.ts
│       ├── password-changed.ts
│       ├── email-changed.ts
│       ├── new-login.ts
│       ├── suspicious-activity.ts
│       ├── invitation.ts
│       ├── account-deletion-requested.ts
│       └── account-deletion-completed.ts
└── test/
    ├── templates.test.ts     # snapshot subject/html/text + XSS-эскейп
    └── enqueue.test.ts       # OutboxEvent создаётся корректно
```

### Типы (контракт пакета)

```ts
export type MailKind =
  | 'verify-email'
  | 'welcome'
  | 'reset-password'
  | 'password-changed'
  | 'email-changed'
  | 'new-login'
  | 'suspicious-activity'
  | 'invitation'
  | 'account-deletion-requested'
  | 'account-deletion-completed'

export type RenderedEmail = { subject: string; html: string; text: string }

export type MailPayloads = {
  'verify-email':                { firstName: string; link: string; expiresAtIso: string }
  'welcome':                     { firstName: string; appUrl: string }
  'reset-password':              { firstName: string; link: string; expiresAtIso: string }
  'password-changed':            { firstName: string; supportEmail: string; ipAddress?: string }
  'email-changed':               { firstName: string; oldEmail: string; newEmail: string; isOldRecipient: boolean }
  'new-login':                   { firstName: string; ipAddress: string; userAgent: string; location?: string; loggedAtIso: string }
  'suspicious-activity':         { firstName: string; reason: string; lockedUntilIso?: string }
  'invitation':                  { firstName?: string; inviterName: string; workspaceName: string; link: string }
  'account-deletion-requested':  { firstName: string; link: string; expiresAtIso: string }
  'account-deletion-completed':  { firstName: string }
}

export type MailEventPayload = {
  [K in MailKind]: { kind: K; to: string; data: MailPayloads[K] }
}[MailKind]
```

### Шаблоны

Все шаблоны — функции `(input) => RenderedEmail`, без CSS, минимальный inline-HTML. Пример (`verify-email.ts`):

```ts
import { esc, formatRuDateTime } from '../utils.js'

export function renderVerifyEmail(p: MailPayloads['verify-email']): RenderedEmail {
  const expires = formatRuDateTime(p.expiresAtIso)
  return {
    subject: 'Подтвердите ваш email',
    text:
      `Здравствуйте, ${p.firstName}.\n\n` +
      `Чтобы завершить регистрацию в AnyNote, перейдите по ссылке:\n${p.link}\n\n` +
      `Ссылка действительна до ${expires}.\n\n` +
      `Если вы не регистрировались — проигнорируйте это письмо.`,
    html:
      `<p>Здравствуйте, ${esc(p.firstName)}.</p>` +
      `<p>Чтобы завершить регистрацию в AnyNote, перейдите по ссылке:</p>` +
      `<p><a href="${esc(p.link)}">${esc(p.link)}</a></p>` +
      `<p>Ссылка действительна до ${esc(expires)}.</p>` +
      `<p>Если вы не регистрировались — проигнорируйте это письмо.</p>`,
  }
}
```

Остальные 8 шаблонов — в том же стиле. Содержание соответствует требованиям из ТЗ:

- **welcome** — "Добро пожаловать в AnyNote", краткое описание продукта, ссылка на `/app`.
- **reset-password** — ссылка для смены пароля, срок действия 3ч, "если это были не вы — проигнорируйте".
- **password-changed** — "Ваш пароль был изменён", ссылка на support при подозрении на взлом.
- **email-changed** — отправляется на оба адреса (флаг `isOldRecipient` меняет текст: для старого "ваш email больше не привязан", для нового "ваш email теперь привязан").
- **new-login** — IP, user-agent, время; "если это были не вы — смените пароль".
- **suspicious-activity** — повод (`reason`), время разблокировки (`lockedUntilIso`).
- **invitation** — приглашающий, название workspace, ссылка-токен.
- **account-deletion-requested** — подтверждение запроса на удаление со ссылкой подтверждения, срок 3ч.
- **account-deletion-completed** — "ваш аккаунт удалён", без ссылок.

Реестр в `templates/index.ts`:

```ts
export function renderTemplate(kind: MailKind, data: unknown): RenderedEmail {
  switch (kind) {
    case 'verify-email':                return renderVerifyEmail(data as MailPayloads['verify-email'])
    case 'welcome':                     return renderWelcome(data as MailPayloads['welcome'])
    // ... остальные 8
  }
}
```

### Enqueue helper

```ts
export async function enqueueMailEvent<K extends MailKind>(
  prisma: PrismaClient,
  args: { kind: K; to: string; data: MailPayloads[K]; userId?: string },
): Promise<void> {
  const aggregateId = args.userId ?? randomUUID()
  await prisma.outboxEvent.create({
    data: {
      aggregateType: 'email',
      aggregateId,
      eventType: 'email.send',
      payload: { kind: args.kind, to: args.to, data: args.data },
      // status, attempts, nextAttemptAt — defaults
    },
  })
}
```

### OutboxEvent shape для mail-канала

| field | значение |
|---|---|
| `aggregateType` | `'email'` |
| `aggregateId` | `userId` (если есть) или `randomUUID()` (для invitation без user) |
| `eventType` | `'email.send'` |
| `payload` | `MailEventPayload` (JSON) |
| `workspaceId` | `null` |

### Transport

```ts
import 'server-only'
import nodemailer, { type Transporter } from 'nodemailer'

let _transport: Transporter | null = null
export function getMailTransport(): Transporter {
  if (_transport) return _transport
  _transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST!,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD! }
      : undefined,
    pool: true,
  })
  return _transport
}
```

### Dispatch (используется engines cron и тестами)

```ts
import 'server-only'

export type DispatchResult = { processed: number; succeeded: number; failed: number; retried: number }

export async function dispatchPending(
  prisma: PrismaClient,
  opts: { batch: number; maxAttempts: number; workerId: string },
): Promise<DispatchResult> {
  const rows = await claimBatch(prisma, opts)
  if (rows.length === 0) return { processed: 0, succeeded: 0, failed: 0, retried: 0 }
  const transport = getMailTransport()
  const from = process.env.MAIL_FROM!
  let succeeded = 0, failed = 0, retried = 0
  await Promise.all(rows.map(async (row) => {
    try {
      const rendered = renderTemplate(row.payload.kind, row.payload.data)
      await transport.sendMail({ from, to: row.payload.to, ...rendered })
      await markDone(prisma, row.id)
      succeeded += 1
    } catch (err) {
      const result = await markFailedOrRetry(prisma, row.id, row.attempts, opts.maxAttempts, err)
      if (result === 'retried') retried += 1
      else failed += 1
    }
  }))
  return { processed: rows.length, succeeded, failed, retried }
}
```

`markFailedOrRetry` — exponential back-off: `nextAttemptAt = now() + 60s * 2^attempts` (1м, 2м, 4м, 8м, 16м). При `attempts >= maxAttempts` → `status='FAILED'`.

Логи маскируют ссылку до origin (без token) — токен не должен утекать в логи.

## 4. Engines mailer (cron-диспатчер)

### Модуль

```
apps/engines/src/apps/mailer/
├── mailer.module.ts
└── cron/
    ├── mail-dispatch-cron.service.ts
    └── mail-dispatch-cron.service.spec.ts
```

`MailerModule` подключается в `apps/engines/src/app.module.ts` рядом с `IndexerModule` и `BillingModule`.

### Сервис (sketch)

```ts
@Injectable()
export class MailDispatchCronService implements OnModuleInit {
  private readonly log = new Logger(MailDispatchCronService.name)
  private readonly workerId = `engines-mailer-${process.env.HOSTNAME ?? randomUUID().slice(0, 8)}`
  private readonly batch = Number(process.env.MAIL_DISPATCH_BATCH ?? 20)
  private readonly maxAttempts = Number(process.env.MAIL_DISPATCH_MAX_ATTEMPTS ?? 5)

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  onModuleInit(): void {
    this.log.log(`MailDispatchCron ready; worker=${this.workerId} batch=${this.batch}`)
  }

  @Cron(process.env.MAIL_DISPATCH_CRON_EXPRESSION ?? '*/30 * * * * *')
  async tick(): Promise<void> {
    const result = await dispatchPending(this.prisma, {
      batch: this.batch,
      maxAttempts: this.maxAttempts,
      workerId: this.workerId,
    })
    if (result.processed > 0) this.log.log(`tick processed=${result.processed} ok=${result.succeeded} retry=${result.retried} fail=${result.failed}`)
  }
}
```

Сервис тонкий — вся логика в `@repo/mail/dispatch`, чтобы её можно было дёргать также из тестов и e2e напрямую (без подъёма engines в Playwright-job).

### Claim-запрос

```sql
SELECT id, payload, attempts
FROM outbox_events
WHERE status = 'PENDING'
  AND next_attempt_at <= now()
  AND aggregate_type = 'email'
  AND event_type = 'email.send'
ORDER BY id
LIMIT $1
FOR UPDATE SKIP LOCKED;
-- затем UPDATE на PROCESSING с lockedBy/lockedAt
```

Дедупликация per-aggregate-id здесь **не нужна** — каждое письмо — независимое событие.

## 5. Better-auth изменения

Файл: `packages/auth/src/auth.ts`. Полная новая форма:

### 5.1 Google OAuth provider

```ts
socialProviders: {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  },
},
```

Better-auth по умолчанию ставит `emailVerified=true` для Google (Google OIDC уже подтвердил email).

Frontend: `signIn.social({ provider: 'google', callbackURL: '/app' })`.

### 5.2 Email verification

```ts
emailVerification: {
  sendOnSignUp: true,
  autoSignInAfterVerification: true,
  expiresIn: 60 * 60 * 3, // 3 часа
  sendVerificationEmail: async ({ user, url }) => {
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 3).toISOString()
    await enqueueMailEvent(prisma, {
      kind: 'verify-email',
      to: user.email,
      data: { firstName: user.firstName, link: url, expiresAtIso: expiresAt },
      userId: user.id,
    })
  },
  afterEmailVerification: async (user) => {
    await enqueueMailEvent(prisma, {
      kind: 'welcome',
      to: user.email,
      data: { firstName: user.firstName, appUrl: `${process.env.NEXT_PUBLIC_BASE_URL}/app` },
      userId: user.id,
    })
  },
},
```

Better-auth формирует URL `${BETTER_AUTH_URL}/api/auth/verify-email?token=...&callbackURL=/verify-email?status=success`. После клика better-auth ставит `emailVerified=true`, удаляет verification-row (одноразовость), редиректит. При невалидном токене редиректит на тот же путь с `?error=...` (мы маппим на `?status=error`).

### 5.3 Reset password

```ts
emailAndPassword: {
  enabled: true,
  resetPasswordTokenExpiresIn: 60 * 60 * 3, // 3 часа
  sendResetPassword: async ({ user, token }) => {
    const link = `${process.env.NEXT_PUBLIC_BASE_URL}/reset-credentials/${token}`
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 3).toISOString()
    await enqueueMailEvent(prisma, {
      kind: 'reset-password',
      to: user.email,
      data: { firstName: user.firstName, link, expiresAtIso: expiresAt },
      userId: user.id,
    })
  },
},
```

URL переопределяем сами (по умолчанию better-auth указывает на `/api/auth/reset-password?token=...`, но нам нужна **своя** страница с формой нового пароля). Token остаётся валидным; страница вызывает `authClient.resetPassword({ newPassword, token })`. Better-auth удаляет verification row при успехе → одноразовость.

### 5.4 Welcome email на Google sign-up

```ts
databaseHooks: {
  user: {
    create: {
      after: async (user) => {
        // ... существующая логика (subscription + preferences)
        if (user.emailVerified) {
          await enqueueMailEvent(prisma, {
            kind: 'welcome',
            to: user.email,
            data: { firstName: user.firstName, appUrl: `${process.env.NEXT_PUBLIC_BASE_URL}/app` },
            userId: user.id,
          })
        }
      },
    },
  },
},
```

### 5.5 reCAPTCHA

```ts
import { captcha } from 'better-auth/plugins'

plugins: [
  captcha({
    provider: 'google-recaptcha',
    secretKey: process.env.RECAPTCHA_SECRET_KEY!,
    minScore: 0.5,
    endpoints: ['/sign-in/email', '/sign-up/email', '/forget-password'],
  }),
  // существующие: magicLink, deviceAuthorization, bearer, nextCookies, jwt, lastLoginMethod
],
```

Plugin читает токен из заголовка `x-captcha-response`. Если score < 0.5 — 401.

## 6. UI

### 6.1 Brand header (общий компонент)

Новый виджет `@repo/ui/widgets/auth/auth-header.tsx`:

```tsx
<Stack spacing={1.5} alignItems="center">
  <BrandIcon size={56} />
  <Typography variant="h5" fontWeight={700} textAlign="center">{title}</Typography>
</Stack>
```

`BrandIcon` — новый React-компонент в `@repo/ui/components/brand-icon.tsx`, отрендеренный SVG с тем же графическим контуром, что `apps/web/src/lib/brand-icon.tsx`.

### 6.2 `/sign-in` — `LoginForm`

```
┌────────────────────────────────┐
│        [AnyNote icon]          │
│      Вход в учётную запись     │
│  ────────────────────────────  │   <Divider />
│  [  Войти через Google  ]      │   variant="outlined" full-width
│  ────────────────────────────  │   <Divider />
│  Email          [_________]    │
│  Пароль         [_________]    │
│  [✓] Запомнить меня   Забыли пароль?  │
│  [        Войти        ]       │   variant="contained" full-width
│  ────────────────────────────  │   <Divider />
│  Новый пользователь? Регистрация │
└────────────────────────────────┘
```

Файл: `packages/ui/src/widgets/auth/login-form.tsx`. Props (новые/изменённые):

```ts
export type LoginFormValues = {
  email: string
  password: string
  rememberMe: boolean
}

export type LoginFormProps = {
  defaultValues?: Partial<LoginFormValues>
  onSubmit?: (values: LoginFormValues) => Promise<void>
  onGoogle?: () => Promise<void>
  forgotPasswordHref?: string  // default '/reset-credentials'
  signUpHref?: string           // default '/sign-up'
  isSubmitting?: boolean
}
```

Лейбл title удалён из props — заменяется AuthHeader сверху (рендерится в виджете).

### 6.3 `/sign-up` — `RegisterForm`

```
┌────────────────────────────────┐
│        [AnyNote icon]          │
│         Регистрация            │
│  Email          [_________]    │
│  Фамилия        [_________]    │
│  Имя            [_________]    │
│  Пароль         [_________]    │
│  Повторите      [_________]    │
│  ⏪ Назад ко входу              │
│  [     Регистрация     ]       │
└────────────────────────────────┘
```

Файл: `packages/ui/src/widgets/auth/register-form.tsx`. Изменения:
- Заменить локальный `<Typography variant="h4">` на `<AuthHeader title="Регистрация" />`.
- Порядок полей: Email → Фамилия → Имя → Пароль → Повторите.
- Добавить ссылку «⏪ Назад ко входу» с `KeyboardDoubleArrowLeftIcon` из `@mui/icons-material` перед кнопкой submit.
- Убрать prop `titleLabel`.

### 6.4 `/reset-credentials` — request form

```
┌────────────────────────────────┐
│        [AnyNote icon]          │
│        Забыли пароль           │
│  Email          [_________]    │
│  ⏪ Назад ко входу              │
│  [     Подтвердить     ]       │
│  ────────────────────────────  │
│  Введите Ваш E-mail и мы       │
│  вышлем Вам инструкции по      │
│  получению нового пароля       │
└────────────────────────────────┘
```

Новый виджет: `packages/ui/src/widgets/auth/reset-password-request-form.tsx`.
Сабмит: `await authClient.forgetPassword({ email, redirectTo: '/reset-credentials' })` (с captcha-токеном). После успеха — toast «Если такой email зарегистрирован, мы отправили ссылку».

### 6.5 `/reset-credentials/[token]` — set new password

```
┌────────────────────────────────┐
│        [AnyNote icon]          │
│        Новый пароль            │
│  Пароль         [_________]    │
│  Повторите      [_________]    │
│  [      Сохранить      ]       │
└────────────────────────────────┘
```

Новый виджет: `packages/ui/src/widgets/auth/reset-password-confirm-form.tsx`.
Сабмит: `await authClient.resetPassword({ newPassword, token })`. На успех `router.push('/sign-in')`. На ошибку (невалидный/истёкший токен) — показать сообщение «Ссылка недействительна» и кнопку «Запросить новую» → редирект на `/reset-credentials`.

### 6.6 `/verify-email` — результат подтверждения

Один URL с query `?status=success|error|expired`:

- `success`: «Email подтверждён. Перенаправляем в приложение…» + `setTimeout(() => router.push('/app'), 2000)`.
- `error`/`expired`: «Ссылка недействительна или истекла. Запросить новую» (кнопка → `authClient.sendVerificationEmail({ email })` для залогиненного юзера; если не залогинен — кнопка ведёт на `/sign-in`).

### 6.7 Auth layout

`apps/web/src/app/(auth)/layout.tsx`:

- **Убрать** встроенную ссылку «Вернуться ко входу» внизу — каждая страница теперь несёт свой контекстный back-link.
- **Сохранить** Container/Paper-обёртку, redirect-if-session-active.
- **Добавить** `<RecaptchaProvider siteKey={process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY!}>` (lazy-load script для group `(auth)`).

### 6.8 reCAPTCHA frontend

Зависимость: `react-google-recaptcha-v3` (типы в коробке) — добавляется в `apps/web`.

Хук:

```ts
import { useGoogleReCaptcha } from 'react-google-recaptcha-v3'

export function useRecaptchaV3() {
  const { executeRecaptcha } = useGoogleReCaptcha()
  return useCallback(async (action: string) => {
    if (!executeRecaptcha) throw new Error('reCAPTCHA not ready')
    return executeRecaptcha(action)
  }, [executeRecaptcha])
}
```

Вызов в формах:

```ts
const executeRecaptcha = useRecaptchaV3()
const handleSubmit = async (values) => {
  const token = await executeRecaptcha('sign_in')
  await signIn.email({
    ...values,
    fetchOptions: { headers: { 'x-captcha-response': token } },
  })
}
```

### 6.9 Структура файлов после изменений

```
apps/web/src/app/(auth)/
├── layout.tsx                                         # обновлён
├── sign-in/{page.tsx, sign-in-form.tsx}               # обновлены
├── sign-up/{page.tsx, sign-up-form.tsx}               # обновлены
├── reset-credentials/
│   ├── page.tsx
│   ├── reset-request-form.tsx
│   └── [token]/{page.tsx, reset-confirm-form.tsx}
└── verify-email/{page.tsx, verify-email-view.tsx}

packages/ui/src/widgets/auth/
├── auth-header.tsx                                    # новый
├── login-form.tsx                                     # переработан
├── register-form.tsx                                  # переработан
├── reset-password-request-form.tsx                    # новый
└── reset-password-confirm-form.tsx                    # новый

packages/ui/src/components/
└── brand-icon.tsx                                     # новый
```

## 7. Инфраструктура и конфигурация

### 7.1 Mailhog в `compose.yml`

```yaml
mailhog:
  image: mailhog/mailhog:latest
  ports:
    - "1025:1025"   # SMTP
    - "8025:8025"   # Web UI / API
  healthcheck:
    test: ["CMD-SHELL", "wget -qO- http://localhost:8025/api/v2/messages | grep -q 'total' || exit 1"]
    interval: 10s
    timeout: 3s
    retries: 5
```

Без volume — стейт писем эфемерный. JSON API на `http://localhost:8025/api/v2/messages` используется в Playwright.

### 7.2 Новые env vars

Добавляются в `.env.example` и в `turbo.json` `globalEnv`:

```ini
# ── Mail (apps/engines mailer cron + @repo/mail) ──────────────────────
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
MAIL_FROM=AnyNote <noreply@anynote.local>
MAIL_DISPATCH_CRON_EXPRESSION=*/30 * * * * *
MAIL_DISPATCH_BATCH=20
MAIL_DISPATCH_MAX_ATTEMPTS=5

# ── Google OAuth (better-auth socialProviders.google) ─────────────────
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# ── reCAPTCHA v3 (better-auth captcha plugin + frontend) ──────────────
NEXT_PUBLIC_RECAPTCHA_SITE_KEY=
RECAPTCHA_SECRET_KEY=
```

### 7.3 Зависимости

| pkg | где | назначение |
|---|---|---|
| `nodemailer` + `@types/nodemailer` | `@repo/mail` | SMTP transport |
| `react-google-recaptcha-v3` | `apps/web` | v3 hook + provider |

### 7.4 Prisma миграция

**Не требуется.** `Verification`, `OutboxEvent`, `User.emailVerified` уже есть в схеме.

## 8. Тестовая стратегия

### 8.1 Vitest — `@repo/mail`

- `templates.test.ts`: для каждого из 9 шаблонов вызвать `renderTemplate(kind, fixturePayload)`, сравнить `subject/text/html` со снапшотом. Дополнительно — XSS-проверка: имя `'<script>alert(1)</script>'` должно появиться в html в эскейпленом виде (`&lt;script&gt;...`).
- `enqueue.test.ts`: с реальным test-Prisma проверить, что `enqueueMailEvent({ kind, to, data, userId })` создаёт OutboxEvent с правильными полями (паттерн как в `apps/web/test/yookassa-webhook-handlers.test.ts` — live integration test).

### 8.2 Jest — `apps/engines/src/apps/mailer`

`mail-dispatch-cron.service.spec.ts` (паттерн из `vectorization-cron.service.spec.ts`):

- **happy path**: вставить PENDING OutboxEvent → один `tick()` → status DONE, `processedAt` заполнен. SMTP-транспорт замокан (`jest.spyOn(transport, 'sendMail').mockResolvedValue(...)`).
- **retry on failure**: транспорт throws → status остаётся PENDING, `attempts=1`, `nextAttemptAt > now()`, `lastError` записан.
- **max attempts**: после `MAIL_DISPATCH_MAX_ATTEMPTS` неудач → status=FAILED, больше не клеймится.
- **lock contention**: два параллельных tick() с одной строкой PENDING — только один должен послать.
- **batching**: 25 PENDING при `batch=20` → один tick обрабатывает 20, второй — 5.

### 8.3 Vitest — `apps/web`

- `(auth)/sign-in/sign-in-form.test.tsx`: rendering + клик «Войти через Google» вызывает `signIn.social({ provider: 'google' })`; submit вызывает `signIn.email(...)` с captcha-токеном (mock `useRecaptchaV3`).
- `(auth)/reset-credentials/reset-request-form.test.tsx`: submit → `forgetPassword({ email })` с captcha-токеном.
- `(auth)/reset-credentials/[token]/reset-confirm-form.test.tsx`: success-redirect на `/sign-in`; password mismatch → form-error без API-вызова.
- `(auth)/verify-email/verify-email-view.test.tsx`: `?status=success` рендерит сообщение и через 2с делает `router.push('/app')` (fake timers).

### 8.4 Vitest — `@repo/auth`

`packages/auth/test/auth.test.ts` — новые кейсы:

- `sendResetPassword` callback вставляет OutboxEvent с `kind='reset-password'`, link указывает на `${BASE_URL}/reset-credentials/{token}`.
- `sendVerificationEmail` callback вставляет OutboxEvent с `kind='verify-email'`, `expiresAtIso ≈ now+3h`.
- `databaseHooks.user.create.after`: при `emailVerified=true` вставляет welcome; при `false` — не вставляет.
- `emailVerification.afterEmailVerification`: вставляет welcome.

(Live-прогон через `auth.api.signUpEmail({...})` и проверка OutboxEvent в Prisma.)

### 8.5 Playwright — `apps/e2e/auth-extended.spec.ts`

Helper `apps/e2e/helpers/mailhog.ts`:

```ts
export async function readLastMailhogMessage(opts: { to: string; subjectMatch?: RegExp }): Promise<{ subject: string; text: string; link?: string }>
export async function clearMailhog(): Promise<void>
export async function extractLinkFromMail(text: string, prefix: string): Promise<string>
```

Helper `apps/e2e/helpers/dispatch-emails.ts`: дёргает `dispatchPending()` из `@repo/mail/dispatch` напрямую (не зависим от engines в CI).

E2E-сценарии:

1. **Email verification happy path**: clear mailhog → register user → dispatch → ждём verify-email → `goto(link)` → редирект на `/verify-email?status=success` → `/app`. Проверить, что dispatch отправил **второе** письмо (welcome).
2. **Password reset happy path**: register + verify → logout → `/sign-in` → «Забыли пароль» → submit на `/reset-credentials` → dispatch → goto link → `/reset-credentials/[token]` → ввести новый пароль → submit → `/sign-in` → войти с новым паролем → `/app`.
3. **Reset link одноразовый**: использовать reset link → второй `goto(link)` → страница «ссылка недействительна».
4. **reCAPTCHA — server-side reject**: переопределить `useRecaptchaV3` стабом, возвращающим заведомо плохой токен → submit на `/sign-in` → ошибка captcha-fail.

**Google OAuth** не покрывается e2e (требует реальные Google-credentials). Покрывается ручным smoke-тестом + unit-тестом для `databaseHooks.user.create.after`.

### 8.6 `pnpm gates`

После всех изменений `pnpm gates` (type-check + lint + build + test) должен оставаться зелёным во всех воркспейсах: `@repo/mail`, `@repo/auth`, `@repo/ui`, `apps/web`, `apps/engines`.

## 9. Ссылки

- Существующий outbox-cron паттерн: `apps/engines/src/apps/indexer/cron/vectorization-cron.service.ts`
- Существующий plan-gating: `apps/engines/src/apps/indexer/services/plan-features.service.ts`
- Better-auth captcha plugin: https://www.better-auth.com/docs/plugins/captcha
- Better-auth email-verification: https://www.better-auth.com/docs/concepts/email-verification
- Better-auth Google provider: https://www.better-auth.com/docs/authentication/google
- Live integration test pattern: `apps/web/test/yookassa-webhook-handlers.test.ts`
