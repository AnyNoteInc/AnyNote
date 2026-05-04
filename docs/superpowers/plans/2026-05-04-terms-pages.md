# Юридические документы (terms): план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить пять `.md`-документов из `docs/terms/` как публичные страницы по `/terms/<slug>`, обновить футер и форму регистрации, удалить старые legal-страницы.

**Architecture:** Динамический Next.js-роут `(about)/terms/[document]/page.tsx` импортирует `.md` из `docs/terms/` через `@mdx-js/loader`, маппит markdown-узлы на MUI-компоненты в `mdx-components.tsx`. Источник правды путей и заголовков — общий модуль `legal-documents.ts`, потребляемый страницей-индексом, футером и формой регистрации.

**Tech Stack:** Next.js 16 (Turbopack dev / Webpack prod), `@next/mdx`, `@mdx-js/loader`, `@mdx-js/react`, MUI v6, react-hook-form.

**Spec:** `docs/superpowers/specs/2026-05-04-terms-pages-design.md`

---

## Файловая карта

### Новые файлы

| Путь                                                 | Ответственность                                                                                            |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `apps/web/mdx-components.tsx`                        | Маппинг markdown-узлов на MUI-компоненты (h\*, p, ul, table, …).                                           |
| `apps/web/src/lib/legal-documents.ts`                | Единый источник `slug → { title, eyebrow, href, summary }` для index-страницы, футера и формы регистрации. |
| `apps/web/src/app/(about)/terms/page.tsx`            | `/terms` — index-страница со списком 5 документов.                                                         |
| `apps/web/src/app/(about)/terms/[document]/page.tsx` | Динамический рендер документа по слагу.                                                                    |

### Изменяемые файлы

| Путь                                                 | Что меняется                                                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `apps/web/package.json`                              | Добавить `@next/mdx`, `@mdx-js/loader`, `@mdx-js/react`, `@types/mdx`.                                   |
| `apps/web/next.config.js`                            | Применить `withMDX`, добавить webpack-алиас `@docs → ../../docs`.                                        |
| `apps/web/tsconfig.json`                             | Добавить `"@docs/*": ["../../docs/*"]` в `compilerOptions.paths`.                                        |
| `apps/web/src/components/public/content.ts`          | Добавить секцию «Юридические документы», обновить секцию «Компания».                                     |
| `apps/web/src/components/public/public-footer.tsx`   | Обновить нижнюю строку ссылок (`/privacy` → `/terms/privacy-policy`, `/oferta` → `/terms/public-offer`). |
| `apps/web/src/components/public/cookie-banner.tsx`   | Ссылка `/privacy` → `/terms/privacy-policy`.                                                             |
| `apps/web/src/components/billing/checkout-modal.tsx` | Ссылка `/oferta` → `/terms/public-offer`.                                                                |
| `packages/ui/src/widgets/auth/register-form.tsx`     | Опциональный пропс `termsUrls`, чекбокс согласия с тремя ссылками.                                       |
| `apps/web/src/app/(auth)/sign-up/sign-up-form.tsx`   | Передать `termsUrls` в `<RegisterForm>`.                                                                 |
| `apps/web/src/app/(about)/terms/page.tsx` (старый)   | Удалить (заменён).                                                                                       |
| `apps/web/src/app/(about)/privacy/`                  | Удалить.                                                                                                 |
| `apps/web/src/app/(about)/oferta/`                   | Удалить.                                                                                                 |
| `apps/web/src/app/(about)/offer/`                    | Удалить.                                                                                                 |
| `apps/e2e/helpers/auth.ts`                           | В `signUpAndAuthAs` после заполнения полей кликнуть чекбокс согласия.                                    |

---

## Phase 1: MDX-инфраструктура

### Task 1: Установить MDX-зависимости

**Files:**

- Modify: `apps/web/package.json`

- [ ] **Step 1: Добавить зависимости через pnpm**

```bash
pnpm --filter web add @next/mdx @mdx-js/loader @mdx-js/react
pnpm --filter web add -D @types/mdx
```

- [ ] **Step 2: Проверить package.json**

```bash
grep -E '@next/mdx|@mdx-js|@types/mdx' apps/web/package.json
```

Expected: 4 строки с этими пакетами.

### Task 2: Настроить next.config.js

**Files:**

- Modify: `apps/web/next.config.js`

- [ ] **Step 1: Заменить содержимое next.config.js**

```js
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import createMDX from '@next/mdx'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const docsDir = path.resolve(__dirname, '../../docs')

const withMDX = createMDX({
  extension: /\.mdx?$/,
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: ['pg', '@prisma/client'],
  transpilePackages: [
    '@repo/ui',
    '@repo/trpc',
    '@repo/auth',
    '@repo/db',
    '@repo/mail',
    '@repo/storage',
    '@repo/editor',
    '@repo/excalidraw',
    '@repo/genogram',
    '@repo/yookassa',
  ],
  experimental: {
    optimizePackageImports: ['emoji-picker-react'],
  },
  turbopack: {
    resolveAlias: {
      '@docs': docsDir,
    },
  },
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
      '.cjs': ['.cts', '.cjs'],
    }
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      '@docs': docsDir,
    }
    return config
  },
}

export default withMDX(nextConfig)
```

**Note:** `withMDX` сам добавляет webpack-loader для `.md`/`.mdx`. `pageExtensions` НЕ расширяем — `.md` импортируются как модули, не как страницы.

- [ ] **Step 2: Проверить, что dev-сервер запускается**

```bash
pnpm --filter web dev
```

Expected: компиляция проходит без ошибок, сервер слушает `http://localhost:3000`. Завершить через Ctrl+C.

### Task 3: Добавить путь @docs в tsconfig.json

**Files:**

- Modify: `apps/web/tsconfig.json`

- [ ] **Step 1: Добавить `@docs/*` в paths**

```json
{
  "extends": "@repo/typescript-config/nextjs.json",
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"],
      "@docs/*": ["../../docs/*"]
    },
    "plugins": [
      {
        "name": "next"
      }
    ]
  },
  "include": ["**/*.ts", "**/*.tsx", "next-env.d.ts", "next.config.js", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 2: Проверить типы**

```bash
pnpm --filter web check-types
```

Expected: PASS (никаких изменений типов ещё не было — шаг проверяет, что путь сам по себе ничего не ломает).

### Task 4: Создать mdx-components.tsx

**Files:**

- Create: `apps/web/mdx-components.tsx`

- [ ] **Step 1: Записать файл**

```tsx
import type { MDXComponents } from 'mdx/types'
import type { ReactNode } from 'react'

import {
  Box,
  Divider,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@repo/ui/components'

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...components,
    h1: ({ children }) => (
      <Typography variant="h3" component="h1" sx={{ mt: 0, mb: 2.5 }}>
        {children}
      </Typography>
    ),
    h2: ({ children }) => (
      <Typography variant="h4" component="h2" sx={{ mt: 4, mb: 2 }}>
        {children}
      </Typography>
    ),
    h3: ({ children }) => (
      <Typography variant="h5" component="h3" sx={{ mt: 3, mb: 1.5 }}>
        {children}
      </Typography>
    ),
    h4: ({ children }) => (
      <Typography variant="h6" component="h4" sx={{ mt: 2.5, mb: 1.25 }}>
        {children}
      </Typography>
    ),
    p: ({ children }) => (
      <Typography variant="body1" color="text.secondary" sx={{ mb: 1.5, lineHeight: 1.7 }}>
        {children}
      </Typography>
    ),
    ul: ({ children }) => (
      <Box component="ul" sx={{ pl: 3, mb: 2, color: 'text.secondary', '& li': { mb: 0.75 } }}>
        {children}
      </Box>
    ),
    ol: ({ children }) => (
      <Box component="ol" sx={{ pl: 3, mb: 2, color: 'text.secondary', '& li': { mb: 0.75 } }}>
        {children}
      </Box>
    ),
    li: ({ children }) => (
      <Typography component="li" variant="body1" color="text.secondary" sx={{ lineHeight: 1.7 }}>
        {children}
      </Typography>
    ),
    a: ({ children, href }) => (
      <Box
        component="a"
        href={href}
        sx={{ color: 'primary.main', textDecoration: 'underline' }}
        target={href?.startsWith('http') ? '_blank' : undefined}
        rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
      >
        {children}
      </Box>
    ),
    hr: () => <Divider sx={{ my: 3 }} />,
    blockquote: ({ children }) => (
      <Box
        component="blockquote"
        sx={{
          m: 0,
          mb: 2,
          pl: 2,
          py: 0.5,
          borderLeft: '3px solid',
          borderColor: 'divider',
          color: 'text.secondary',
          fontStyle: 'italic',
        }}
      >
        {children}
      </Box>
    ),
    code: ({ children }) => (
      <Box
        component="code"
        sx={{
          fontFamily: 'monospace',
          bgcolor: 'action.hover',
          px: 0.75,
          py: 0.25,
          borderRadius: 0.5,
          fontSize: '0.92em',
        }}
      >
        {children}
      </Box>
    ),
    pre: ({ children }) => (
      <Paper
        component="pre"
        variant="outlined"
        sx={{ p: 2, mb: 2, overflow: 'auto', fontFamily: 'monospace' }}
      >
        {children}
      </Paper>
    ),
    table: ({ children }: { children?: ReactNode }) => (
      <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
        <Table size="small">{children}</Table>
      </TableContainer>
    ),
    thead: ({ children }: { children?: ReactNode }) => <TableHead>{children}</TableHead>,
    tbody: ({ children }: { children?: ReactNode }) => <TableBody>{children}</TableBody>,
    tr: ({ children }: { children?: ReactNode }) => <TableRow>{children}</TableRow>,
    th: ({ children }: { children?: ReactNode }) => (
      <TableCell sx={{ fontWeight: 600 }}>{children}</TableCell>
    ),
    td: ({ children }: { children?: ReactNode }) => <TableCell>{children}</TableCell>,
    wrapper: ({ children }: { children?: ReactNode }) => <Stack spacing={0}>{children}</Stack>,
  }
}
```

- [ ] **Step 2: Проверить типы**

```bash
pnpm --filter web check-types
```

Expected: PASS.

### Task 5: Создать legal-documents.ts

**Files:**

- Create: `apps/web/src/lib/legal-documents.ts`

- [ ] **Step 1: Записать файл**

```ts
export type LegalDocumentSlug =
  | 'user-agreement'
  | 'privacy-policy'
  | 'consent'
  | 'public-offer'
  | 'information'

export type LegalDocument = {
  slug: LegalDocumentSlug
  title: string
  eyebrow: string
  summary: string
  href: string
}

export const legalDocuments: readonly LegalDocument[] = [
  {
    slug: 'user-agreement',
    title: 'Пользовательское соглашение',
    eyebrow: 'Terms',
    summary: 'Условия использования сервиса, прав и обязанностей пользователя и администрации.',
    href: '/terms/user-agreement',
  },
  {
    slug: 'privacy-policy',
    title: 'Политика обработки персональных данных',
    eyebrow: 'Privacy',
    summary: 'Какие данные мы собираем, цели и условия их обработки и хранения.',
    href: '/terms/privacy-policy',
  },
  {
    slug: 'consent',
    title: 'Согласие на обработку персональных данных',
    eyebrow: 'Consent',
    summary:
      'Согласие пользователя на обработку персональных данных при регистрации и использовании сервиса.',
    href: '/terms/consent',
  },
  {
    slug: 'public-offer',
    title: 'Публичная оферта',
    eyebrow: 'Offer',
    summary:
      'Договор-оферта на оказание услуг по предоставлению доступа к функциональности сервиса.',
    href: '/terms/public-offer',
  },
  {
    slug: 'information',
    title: 'Информация о самозанятом',
    eyebrow: 'Info',
    summary: 'Реквизиты исполнителя и контактные данные для обращений.',
    href: '/terms/information',
  },
] as const

export const legalDocumentBySlug: Record<LegalDocumentSlug, LegalDocument> = Object.fromEntries(
  legalDocuments.map((doc) => [doc.slug, doc]),
) as Record<LegalDocumentSlug, LegalDocument>
```

---

## Phase 2: Страницы /terms

### Task 6: Удалить старые legal-страницы

**Files:**

- Delete: `apps/web/src/app/(about)/terms/page.tsx`
- Delete: `apps/web/src/app/(about)/privacy/`
- Delete: `apps/web/src/app/(about)/oferta/`
- Delete: `apps/web/src/app/(about)/offer/`

- [ ] **Step 1: Удалить файлы**

```bash
rm /Users/victor/Projects/anynote/apps/web/src/app/\(about\)/terms/page.tsx
rm -rf /Users/victor/Projects/anynote/apps/web/src/app/\(about\)/privacy
rm -rf /Users/victor/Projects/anynote/apps/web/src/app/\(about\)/oferta
rm -rf /Users/victor/Projects/anynote/apps/web/src/app/\(about\)/offer
```

- [ ] **Step 2: Проверить, что папки удалены**

```bash
ls /Users/victor/Projects/anynote/apps/web/src/app/\(about\)/
```

Expected: нет `privacy`, `oferta`, `offer`. Папка `terms` существует, если есть подпапки (например, удаление `page.tsx` оставляет пустую `terms/` — это нормально, мы наполним её в следующих задачах).

### Task 7: Создать index-страницу /terms

**Files:**

- Create: `apps/web/src/app/(about)/terms/page.tsx`

- [ ] **Step 1: Записать файл**

```tsx
import type { Metadata } from 'next'
import Link from 'next/link'

import { Box, Stack, Typography } from '@repo/ui/components'

import { PublicPageShell } from '@/components/public/public-page-shell'
import { legalDocuments } from '@/lib/legal-documents'

export const metadata: Metadata = {
  title: 'Юридические документы',
}

export default function TermsIndexPage() {
  return (
    <PublicPageShell
      eyebrow="Terms"
      title="Юридические документы"
      description="Полный перечень соглашений, политик и публичных оферт сервиса «Любые заметки»."
    >
      <Stack spacing={2}>
        {legalDocuments.map((doc) => (
          <Box
            key={doc.slug}
            component={Link}
            href={doc.href}
            sx={{
              display: 'block',
              p: 2.5,
              borderRadius: 2,
              border: '1px solid',
              borderColor: 'divider',
              textDecoration: 'none',
              color: 'inherit',
              transition: 'border-color .15s, background-color .15s',
              '&:hover': { borderColor: 'primary.main', backgroundColor: 'action.hover' },
            }}
          >
            <Typography
              variant="overline"
              color="text.secondary"
              sx={{ display: 'block', mb: 0.5 }}
            >
              {doc.eyebrow}
            </Typography>
            <Typography variant="h6" sx={{ mb: 0.5 }}>
              {doc.title}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {doc.summary}
            </Typography>
          </Box>
        ))}
      </Stack>
    </PublicPageShell>
  )
}
```

### Task 8: Создать динамическую страницу /terms/[document]

**Files:**

- Create: `apps/web/src/app/(about)/terms/[document]/page.tsx`

- [ ] **Step 1: Записать файл**

```tsx
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import UserAgreement from '@docs/terms/UserAgreement.md'
import PrivacyPolicy from '@docs/terms/PrivacyPolicy.md'
import Consent from '@docs/terms/ConsentToProcessing.md'
import PublicOffer from '@docs/terms/PublicOffer.md'
import Information from '@docs/terms/Information.md'

import { PublicPageShell } from '@/components/public/public-page-shell'
import { legalDocumentBySlug, legalDocuments, type LegalDocumentSlug } from '@/lib/legal-documents'

const documentComponents: Record<LegalDocumentSlug, React.ComponentType> = {
  'user-agreement': UserAgreement,
  'privacy-policy': PrivacyPolicy,
  consent: Consent,
  'public-offer': PublicOffer,
  information: Information,
}

export function generateStaticParams() {
  return legalDocuments.map((doc) => ({ document: doc.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ document: string }>
}): Promise<Metadata> {
  const { document } = await params
  const meta = legalDocumentBySlug[document as LegalDocumentSlug]
  return { title: meta?.title ?? 'Документ' }
}

export default async function LegalDocumentPage({
  params,
}: {
  params: Promise<{ document: string }>
}) {
  const { document } = await params
  const meta = legalDocumentBySlug[document as LegalDocumentSlug]
  if (!meta) notFound()
  const Component = documentComponents[meta.slug]
  return (
    <PublicPageShell eyebrow={meta.eyebrow} title={meta.title} description={meta.summary}>
      <Component />
    </PublicPageShell>
  )
}
```

- [ ] **Step 2: Проверить рендер в dev**

```bash
pnpm --filter web dev
```

Открыть в браузере (или curl) и убедиться, что отвечают:

- `http://localhost:3000/terms` (200, видны 5 карточек)
- `http://localhost:3000/terms/user-agreement` (200, рендер UserAgreement.md)
- `http://localhost:3000/terms/privacy-policy` (200)
- `http://localhost:3000/terms/consent` (200)
- `http://localhost:3000/terms/public-offer` (200)
- `http://localhost:3000/terms/information` (200, видна таблица реквизитов)
- `http://localhost:3000/terms/unknown-slug` (404)
- `http://localhost:3000/privacy`, `/oferta`, `/offer` (404)

Завершить dev-сервер.

---

## Phase 3: Footer и обновление ссылок

### Task 9: Обновить content.ts

**Files:**

- Modify: `apps/web/src/components/public/content.ts:1-19`

- [ ] **Step 1: Заменить `publicFooterSections`**

Найти блок:

```ts
export const publicFooterSections = [
  {
    title: 'Продукт',
    links: [
      { label: 'Возможности', href: '/#features' },
      { label: 'Тарифы', href: '/pricing' },
      { label: 'Roadmap', href: '/roadmap' },
    ],
  },
  {
    title: 'Компания',
    links: [
      { label: 'Контакты', href: '/contact' },
      { label: 'Оферта', href: '/oferta' },
      { label: 'Политика', href: '/privacy' },
    ],
  },
] as const
```

Заменить на:

```ts
export const publicFooterSections = [
  {
    title: 'Продукт',
    links: [
      { label: 'Возможности', href: '/#features' },
      { label: 'Тарифы', href: '/pricing' },
      { label: 'Roadmap', href: '/roadmap' },
    ],
  },
  {
    title: 'Компания',
    links: [{ label: 'Контакты', href: '/contact' }],
  },
  {
    title: 'Юридические документы',
    links: [
      { label: 'Пользовательское соглашение', href: '/terms/user-agreement' },
      { label: 'Политика обработки персональных данных', href: '/terms/privacy-policy' },
      { label: 'Согласие на обработку персональных данных', href: '/terms/consent' },
      { label: 'Публичная оферта', href: '/terms/public-offer' },
      { label: 'Информация о самозанятом', href: '/terms/information' },
    ],
  },
] as const
```

### Task 10: Обновить нижнюю строку public-footer.tsx

**Files:**

- Modify: `apps/web/src/components/public/public-footer.tsx:84-87`

- [ ] **Step 1: Найти блок и заменить**

Найти:

```tsx
{[
  { label: 'Политика', href: '/privacy' },
  { label: 'Оферта', href: '/oferta' },
].map((l) => (
```

Заменить на:

```tsx
{[
  { label: 'Политика', href: '/terms/privacy-policy' },
  { label: 'Оферта', href: '/terms/public-offer' },
].map((l) => (
```

- [ ] **Step 2: Также проверить layout grid**

В `public-footer.tsx` найти `gridTemplateColumns: { ..., lg: '1.4fr 1fr 1fr 1fr' }` (строка ~24). Это grid из 4 колонок: brand + 3 секции (Продукт, Компания, Юридические). Контактная колонка идёт отдельно. После добавления секции «Юридические документы» grid содержит:

1. Brand block
2. Продукт
3. Компания
4. Юридические документы
5. Связаться (отдельным `<Stack>`)

Это уже 5 колонок, а grid задан на 4 — переполнение. Нужно поменять `lg`-grid на `1.2fr 1fr 1fr 1.4fr 1fr`.

```tsx
gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: '1.2fr 1fr 1fr 1.4fr 1fr' },
```

### Task 11: Обновить cookie-banner

**Files:**

- Modify: `apps/web/src/components/public/cookie-banner.tsx:77`

- [ ] **Step 1: Заменить ссылку**

Найти `href="/privacy"` и заменить на `href="/terms/privacy-policy"`.

### Task 12: Обновить checkout-modal

**Files:**

- Modify: `apps/web/src/components/billing/checkout-modal.tsx:96`

- [ ] **Step 1: Заменить ссылку**

Найти `href="/oferta"` и заменить на `href="/terms/public-offer"`.

- [ ] **Step 2: Проверить, что больше ссылок на старые пути не осталось**

```bash
grep -rn "'/privacy'\|\"/privacy\"\|'/oferta'\|\"/oferta\"\|'/offer'\|\"/offer\"" /Users/victor/Projects/anynote/apps/web/src /Users/victor/Projects/anynote/packages/ui/src 2>/dev/null
```

Expected: пусто (никаких упоминаний).

---

## Phase 4: Чекбокс при регистрации

### Task 13: Добавить чекбокс в RegisterForm

**Files:**

- Modify: `packages/ui/src/widgets/auth/register-form.tsx`

- [ ] **Step 1: Заменить содержимое файла**

```tsx
'use client'

import { useForm } from 'react-hook-form'
import {
  Box,
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  KeyboardDoubleArrowLeftIcon,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

import { AuthHeader } from './auth-header'

export type RegisterFormValues = {
  email: string
  firstName: string
  lastName: string
  password: string
  confirmPassword: string
  agreedToTerms: boolean
}

export type RegisterSubmitPayload = Omit<RegisterFormValues, 'confirmPassword' | 'agreedToTerms'>

export type TermsUrls = {
  userAgreement: string
  privacyPolicy: string
  publicOffer: string
}

export type RegisterFormProps = {
  defaultValues?: Partial<RegisterFormValues>
  onSubmit?: (values: RegisterSubmitPayload) => Promise<void>
  signInHref?: string
  isSubmitting?: boolean
  termsUrls?: TermsUrls
}

export function RegisterForm({
  defaultValues,
  onSubmit,
  signInHref = '/sign-in',
  isSubmitting,
  termsUrls,
}: RegisterFormProps) {
  const formDefaults: RegisterFormValues = {
    email: '',
    lastName: '',
    firstName: '',
    password: '',
    confirmPassword: '',
    agreedToTerms: false,
    ...defaultValues,
  }

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: rhfSubmitting },
  } = useForm<RegisterFormValues>({
    defaultValues: formDefaults,
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  })

  const submitting = isSubmitting ?? rhfSubmitting

  const handleFormSubmit = handleSubmit(
    async ({ confirmPassword, agreedToTerms: _agreedToTerms, ...values }) => {
      if (values.password !== confirmPassword) {
        setError('confirmPassword', {
          type: 'validate',
          message: 'Пароли не совпадают',
        })
        return
      }
      await onSubmit?.(values)
    },
  )

  return (
    <Stack spacing={3} component="form" onSubmit={handleFormSubmit}>
      <AuthHeader title="Регистрация" />
      <Stack spacing={2.5}>
        <TextField
          {...register('email', {
            required: 'Введите email',
            pattern: {
              value: /\S+@\S+\.\S+/,
              message: 'Введите корректный email',
            },
          })}
          type="email"
          label="Email"
          fullWidth
          autoComplete="email"
          error={!!errors.email}
          helperText={errors.email?.message}
        />
        <TextField
          {...register('lastName', { required: 'Введите фамилию' })}
          label="Фамилия"
          fullWidth
          autoComplete="family-name"
          error={!!errors.lastName}
          helperText={errors.lastName?.message}
        />
        <TextField
          {...register('firstName', { required: 'Введите имя' })}
          label="Имя"
          fullWidth
          autoComplete="given-name"
          error={!!errors.firstName}
          helperText={errors.firstName?.message}
        />
        <Divider />
        <TextField
          {...register('password', {
            required: 'Введите пароль',
            minLength: { value: 8, message: 'Минимум 8 символов' },
          })}
          label="Пароль"
          type="password"
          fullWidth
          autoComplete="new-password"
          error={!!errors.password}
          helperText={errors.password?.message}
        />
        <TextField
          {...register('confirmPassword', {
            required: 'Повторите пароль',
          })}
          label="Повторите пароль"
          type="password"
          fullWidth
          autoComplete="new-password"
          error={!!errors.confirmPassword}
          helperText={errors.confirmPassword?.message}
        />
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <KeyboardDoubleArrowLeftIcon fontSize="small" />
          <Typography
            component="a"
            href={signInHref}
            variant="body2"
            sx={{ textDecoration: 'none', color: 'inherit' }}
          >
            Назад ко входу
          </Typography>
        </Stack>
        {termsUrls ? (
          <Box>
            <FormControlLabel
              control={
                <Checkbox
                  {...register('agreedToTerms', {
                    required: 'Необходимо принять условия',
                  })}
                  size="small"
                  data-testid="register-terms-checkbox"
                />
              }
              sx={{ alignItems: 'flex-start', m: 0 }}
              label={
                <Typography variant="body2" color="text.secondary" sx={{ pt: 0.75 }}>
                  Я принимаю{' '}
                  <Box
                    component="a"
                    href={termsUrls.userAgreement}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{ color: 'primary.main' }}
                  >
                    пользовательское соглашение
                  </Box>
                  ,{' '}
                  <Box
                    component="a"
                    href={termsUrls.privacyPolicy}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{ color: 'primary.main' }}
                  >
                    политику обработки персональных данных
                  </Box>{' '}
                  и{' '}
                  <Box
                    component="a"
                    href={termsUrls.publicOffer}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{ color: 'primary.main' }}
                  >
                    оферту на оказание услуг
                  </Box>
                </Typography>
              }
            />
            {errors.agreedToTerms ? (
              <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5, ml: 4 }}>
                {errors.agreedToTerms.message}
              </Typography>
            ) : null}
          </Box>
        ) : null}
        <Button type="submit" variant="contained" size="large" disabled={submitting}>
          Зарегистрироваться
        </Button>
      </Stack>
    </Stack>
  )
}
```

- [ ] **Step 2: Проверить типы**

```bash
pnpm --filter @repo/ui check-types
pnpm --filter web check-types
```

Expected: PASS.

### Task 14: Передать termsUrls в sign-up-form

**Files:**

- Modify: `apps/web/src/app/(auth)/sign-up/sign-up-form.tsx`

- [ ] **Step 1: Передать пропс**

Найти `<RegisterForm onSubmit={handleSubmit} isSubmitting={isSubmitting} />` и заменить на:

```tsx
<RegisterForm
  onSubmit={handleSubmit}
  isSubmitting={isSubmitting}
  termsUrls={{
    userAgreement: '/terms/user-agreement',
    privacyPolicy: '/terms/privacy-policy',
    publicOffer: '/terms/public-offer',
  }}
/>
```

### Task 15: Обновить e2e helper signUpAndAuthAs

**Files:**

- Modify: `apps/e2e/helpers/auth.ts`

- [ ] **Step 1: Перед нажатием кнопки «Зарегистрироваться» отметить чекбокс**

Найти строку:

```ts
await page.getByRole('textbox', { name: 'Повторите пароль' }).fill(password)
await page.getByRole('button', { name: 'Зарегистрироваться' }).click()
```

Вставить между ними отметку чекбокса:

```ts
await page.getByRole('textbox', { name: 'Повторите пароль' }).fill(password)
await page.getByTestId('register-terms-checkbox').check()
await page.getByRole('button', { name: 'Зарегистрироваться' }).click()
```

---

## Phase 5: Верификация

### Task 16: Lint, format, check-types

- [ ] **Step 1: Запустить lint**

```bash
pnpm lint
```

Expected: 0 ошибок, 0 предупреждений.

- [ ] **Step 2: Запустить format**

```bash
pnpm format
```

Expected: завершается без ошибок (форматирование может затронуть новые файлы — это норма).

- [ ] **Step 3: Запустить check-types**

```bash
pnpm check-types
```

Expected: PASS во всех пакетах.

### Task 17: Прогнать Playwright e2e на загрузку картинок и файлов

- [ ] **Step 1: Убедиться, что Docker compose поднят**

```bash
docker compose ps
```

Expected: `postgres`, `minio`, `mailhog`, `qdrant` все в статусе `Up (healthy)`. Если нет — `docker compose up -d`.

- [ ] **Step 2: Прогнать тесты загрузки**

```bash
pnpm exec playwright test apps/e2e/files.spec.ts apps/e2e/editor-slash-media.spec.ts
```

Expected: все тесты PASS. Если падает — диагностика в `playwright-report/`.

### Task 18: Smoke-проверка через browser MCP

- [ ] **Step 1: Открыть dev-сервер и пройти основные пути**

Запустить `pnpm --filter web dev` в фоне.

С помощью Playwright MCP пройти сценарии:

1. `/` → найти в футере секцию «Юридические документы» с 5 ссылками.
2. Кликнуть «Пользовательское соглашение» → попадаем на `/terms/user-agreement`, видны заголовки и таблицы.
3. Кликнуть «Информация о самозанятом» → видна таблица реквизитов.
4. `/sign-up` → проверить, что чекбокс рендерится; нажать «Зарегистрироваться» без галочки → видна ошибка валидации.
5. Отметить чекбокс → 3 ссылки кликабельны и открывают новые вкладки.
6. `/privacy` → 404. `/oferta` → 404. `/offer` → 404.

Завершить dev-сервер.

---

## Self-Review Checklist (для исполнителя)

Перед сдачей пройтись по списку:

- [ ] `/terms` показывает 5 карточек с описаниями.
- [ ] Все 5 документов рендерятся корректно (включая таблицу в `Information.md` и таблицы в `PublicOffer.md`/`UserAgreement.md`).
- [ ] `/privacy`, `/oferta`, `/offer` возвращают 404.
- [ ] Footer содержит секцию «Юридические документы» с 5 ссылками; нижняя строка ведёт на `/terms/privacy-policy` и `/terms/public-offer`.
- [ ] Cookie banner ссылается на `/terms/privacy-policy`.
- [ ] Модалка checkout ссылается на `/terms/public-offer`.
- [ ] На `/sign-up` без отметки чекбокса submit показывает ошибку «Необходимо принять условия».
- [ ] Все 3 ссылки в чекбоксе открываются в новой вкладке.
- [ ] `pnpm lint`, `pnpm format`, `pnpm check-types` — проходят.
- [ ] Playwright `files.spec.ts` и `editor-slash-media.spec.ts` — проходят.

## Open questions / гипотезы

- **Turbopack + .md import**: гипотеза — `withMDX` достаточно для Turbopack-dev в Next 16, и `turbopack.resolveAlias` решает алиас `@docs`. Если в dev возникает ошибка импорта `.md`, упасть назад на `next build --webpack` (production build) и/или статическое чтение через `fs.readFile` в server component (запасной план). Логировать первую попытку — если она проходит, гипотеза подтверждена.
- **Размер `.md`**: `PublicOffer.md` ~80 KB, `PrivacyPolicy.md` ~70 KB. С `generateStaticParams` все 5 пререндерятся при build, что превращается в 5 статических HTML-страниц — допустимо для legal-страниц.
