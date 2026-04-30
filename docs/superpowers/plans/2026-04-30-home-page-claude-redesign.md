# Home Page Claude Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repaint `apps/web/src/app/page.tsx` in a Claude-influenced editorial aesthetic, add "Что ещё" / "Особое решение" sections and a redesigned dark footer, and rebrand public surfaces from "AnyNote" / "AI" to "Любые заметки" / "ИИ".

**Architecture:** Split the 908-line monolithic `page.tsx` into eight focused section components under `apps/web/src/components/public/home/` plus shared design tokens and an `Origami` primitive. Repaint the existing footer in place. Extend the existing `<ContactForm>` with two new fields rather than fork it. Pricing data, footer columns, and contact info stay in `content.ts`.

**Tech Stack:** Next.js 16 (RSC), React 19, MUI v6 via `@repo/ui/components`, `next/font/google` for Crimson Pro serif, MUI `sx`-prop CSS-in-JS (existing pattern), Playwright for the e2e gate.

**Reference:** Design spec at [docs/superpowers/specs/2026-04-30-home-page-claude-redesign-design.md](docs/superpowers/specs/2026-04-30-home-page-claude-redesign-design.md). Visual mockups at [.superpowers/brainstorm/](.superpowers/brainstorm/) (most recent session).

---

## File Structure

**Created:**
- `apps/web/src/components/public/home/home-tokens.ts` — palette, typography, motion CSS-in-JS
- `apps/web/src/components/public/home/origami.tsx` — rhombus/triangle/circle primitive
- `apps/web/src/components/public/home/home-hero.tsx` — section 1
- `apps/web/src/components/public/home/home-market-fit.tsx` — section 2
- `apps/web/src/components/public/home/home-modes.tsx` — section 3
- `apps/web/src/components/public/home/home-search.tsx` — section 4
- `apps/web/src/components/public/home/home-features.tsx` — section 5 (new)
- `apps/web/src/components/public/home/home-pricing.tsx` — section 6
- `apps/web/src/components/public/home/home-contact.tsx` — section 7 (new)
- `apps/web/src/components/public/home/home-final-cta.tsx` — section 8
- `apps/e2e/home-redesign.spec.ts` — e2e gate

**Modified:**
- `apps/web/src/app/layout.tsx` — register Crimson Pro font
- `apps/web/src/app/page.tsx` — slim composer (~80 lines target)
- `apps/web/src/components/public/content.ts` — pricing string fix, new `homeFeatures` / `publicContact`, restructured `publicFooterSections`
- `apps/web/src/components/public/contact-form.tsx` — extend with `company` + `message` fields
- `apps/web/src/components/public/public-header.tsx` — rebrand
- `apps/web/src/components/public/public-footer.tsx` — repaint
- `apps/web/src/app/(about)/contact/page.tsx`, `pricing/page.tsx`, etc. — rebrand sweep on public-page strings only

---

### Task 1: Add Crimson Pro serif font

**Files:**
- Modify: `apps/web/src/app/layout.tsx`

- [ ] **Step 1: Add the Google font import**

At the top of `apps/web/src/app/layout.tsx`, add the import next to the existing `localFont` imports:

```ts
import { Crimson_Pro } from 'next/font/google'
```

- [ ] **Step 2: Initialize the font variable**

Below the existing `geistMono` definition:

```ts
const crimsonPro = Crimson_Pro({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600'],
  variable: '--font-crimson',
  display: 'swap',
})
```

- [ ] **Step 3: Attach the variable on `<html>`**

Find the `<html>` element in the root layout's return statement. Append `${crimsonPro.variable}` to the existing `className` string so the variable is available app-wide alongside `--font-geist-sans` and `--font-geist-mono`.

- [ ] **Step 4: Update root metadata title**

Change the `metadata.title` literal:

```ts
export const metadata: Metadata = {
  title: 'Любые заметки',
  description: 'Рабочая память команды с ИИ-поиском. Документы, схемы и заметки в одном пространстве.',
  // ...icons unchanged
}
```

- [ ] **Step 5: Type-check**

Run: `pnpm --filter web check-types`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/layout.tsx
git commit -m "feat(web): add Crimson Pro serif font and rebrand metadata"
```

---

### Task 2: Create shared design tokens

**Files:**
- Create: `apps/web/src/components/public/home/home-tokens.ts`

- [ ] **Step 1: Create the tokens file**

```ts
// apps/web/src/components/public/home/home-tokens.ts
export const homeTokens = {
  palette: {
    paper: '#faf9f5',
    paperDeep: '#f0eee6',
    ink: '#1d1d1b',
    inkSoft: 'rgba(29,29,27,0.65)',
    inkMute: 'rgba(29,29,27,0.42)',
    orange: '#c96442',
    orangeWarm: '#d97757',
    line: 'rgba(0,0,0,0.08)',
  },
  fonts: {
    serif: 'var(--font-crimson), "Charter", Georgia, "Times New Roman", serif',
    mono: 'var(--font-geist-mono), ui-monospace, "SF Mono", monospace',
    sans: 'var(--font-geist-sans), system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  keyframes: {
    heroIn: {
      from: { opacity: 0, transform: 'translateY(18px)' },
      to: { opacity: 1, transform: 'translateY(0)' },
    },
    surfaceFloat: {
      '0%, 100%': { transform: 'translateY(0)' },
      '50%': { transform: 'translateY(-10px)' },
    },
    scan: {
      from: { transform: 'translateX(-30%)', opacity: 0.2 },
      to: { transform: 'translateX(130%)', opacity: 0 },
    },
  },
} as const

export const homeBaseSx = {
  '@keyframes anHeroIn': homeTokens.keyframes.heroIn,
  '@keyframes anSurfaceFloat': homeTokens.keyframes.surfaceFloat,
  '@keyframes anScan': homeTokens.keyframes.scan,
} as const

export const eyebrowSx = {
  fontFamily: homeTokens.fonts.mono,
  fontSize: 11,
  letterSpacing: '0.16em',
  textTransform: 'uppercase' as const,
  color: homeTokens.palette.inkMute,
}

export const sectionTitleSx = {
  fontFamily: homeTokens.fonts.serif,
  fontWeight: 500,
  fontSize: { xs: '2rem', md: '2.75rem' },
  lineHeight: 1.05,
  letterSpacing: '-0.02em',
  color: homeTokens.palette.ink,
  m: 0,
  maxWidth: 780,
  '& em': { fontStyle: 'italic', color: homeTokens.palette.orange },
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter web check-types`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/public/home/home-tokens.ts
git commit -m "feat(public): add home page design tokens"
```

---

### Task 3: Origami primitive component

**Files:**
- Create: `apps/web/src/components/public/home/origami.tsx`

- [ ] **Step 1: Create the file**

```tsx
// apps/web/src/components/public/home/origami.tsx
import type { CSSProperties } from 'react'
import { Box } from '@repo/ui/components'

import { homeTokens } from './home-tokens'

type Variant = 'rhombus' | 'triangle' | 'circle'

const clipPaths: Record<Variant, string | undefined> = {
  rhombus: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
  triangle: 'polygon(50% 0%, 100% 100%, 0% 100%)',
  circle: undefined,
}

const gradients = {
  warm: `linear-gradient(135deg, ${homeTokens.palette.orangeWarm}, #b8512f)`,
  deep: `linear-gradient(135deg, ${homeTokens.palette.orange}, #8a3f25)`,
  ink: homeTokens.palette.ink,
} as const

type Props = {
  variant: Variant
  size: number
  gradient?: keyof typeof gradients
  rotate?: number
  style?: CSSProperties
  ariaHidden?: boolean
}

export function Origami({
  variant,
  size,
  gradient = 'warm',
  rotate = 0,
  style,
  ariaHidden = true,
}: Props) {
  return (
    <Box
      aria-hidden={ariaHidden}
      sx={{
        position: 'absolute',
        width: size,
        height: size,
        background: gradients[gradient],
        clipPath: clipPaths[variant],
        borderRadius: variant === 'circle' ? '50%' : 0,
        boxShadow:
          variant === 'circle'
            ? '4px 6px 16px rgba(0,0,0,0.18)'
            : '6px 8px 24px rgba(0,0,0,0.14)',
        transform: rotate ? `rotate(${rotate}deg)` : undefined,
        '@media (prefers-reduced-motion: reduce)': { transform: 'none' },
        ...style,
      }}
    />
  )
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter web check-types`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/public/home/origami.tsx
git commit -m "feat(public): add Origami shape primitive"
```

---

### Task 4: Update content data

**Files:**
- Modify: `apps/web/src/components/public/content.ts`

- [ ] **Step 1: Fix the existing pricing string**

Find the `landingPricingCards` `pro` entry. Change `'Чаты с AI'` to `'Чаты с ИИ'` in the `features` array.

- [ ] **Step 2: Add `homeFeatures`**

Append below the existing exports:

```ts
export const homeFeatures = [
  {
    icon: '⚡',
    title: 'Мгновенный редактор',
    body: 'Документы и холсты открываются за доли секунды — Tiptap и кеш страниц вместо ожидания загрузки.',
  },
  {
    icon: '🤝',
    title: 'Несколько курсоров на странице',
    body: 'Команда редактирует одну страницу одновременно — без конфликтов и пересохранений.',
  },
  {
    icon: '🌗',
    title: 'Светлая и тёмная тема',
    body: 'Интерфейс адаптируется под систему или переключается вручную — глаза не устают в любое время.',
  },
  {
    icon: '🔐',
    title: 'Гранулярные права',
    body: 'Чтение или запись для участников, групп и гостей — каждому даёте ровно столько доступа, сколько нужно.',
  },
  {
    icon: '🔗',
    title: 'Публичные ссылки',
    body: 'Откройте страницу одной ссылкой — без регистрации для читателя и без рассылок «вот файл в почту».',
  },
  {
    icon: '🛡️',
    title: 'Без санкционных рисков',
    body: 'Российский хостинг и self-hosted-сборка — продукт работает в любой ситуации, ваши данные остаются у вас.',
  },
] as const
```

- [ ] **Step 3: Add `publicContact`**

```ts
export const publicContact = {
  email: 'hello@любые-заметки.app',
  phone: '+7 (495) 123-45-67',
  telegram: '@anynote_support',
} as const
```

- [ ] **Step 4: Restructure `publicFooterSections`**

Replace the existing `publicFooterSections` export with three columns:

```ts
export const publicFooterSections = [
  {
    title: 'Продукт',
    links: [
      { label: 'Возможности', href: '/#features' },
      { label: 'Тарифы', href: '/pricing' },
      { label: 'Roadmap', href: '/roadmap' },
      { label: 'Документация', href: '/docs' },
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

(The "Связаться" column renders directly from `publicContact`, not from this list.)

- [ ] **Step 5: Type-check**

Run: `pnpm --filter web check-types`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/public/content.ts
git commit -m "feat(public): rebrand pricing copy and add home content data"
```

---

### Task 5: Extend ContactForm with company and message fields

**Files:**
- Modify: `apps/web/src/components/public/contact-form.tsx`
- Test: `apps/web/test/contact-form.test.tsx`

- [ ] **Step 1: Write failing test**

Create `apps/web/test/contact-form.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ContactForm } from '@/components/public/contact-form'

describe('ContactForm', () => {
  it('renders all five fields', () => {
    render(<ContactForm />)
    expect(screen.getByLabelText('Имя')).toBeInTheDocument()
    expect(screen.getByLabelText('Компания')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Телефон')).toBeInTheDocument()
    expect(screen.getByLabelText('Что нужно')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `pnpm --filter web test contact-form`
Expected: FAIL — "Компания" label not found.

If `@testing-library/react` is not installed, install it: `pnpm add -D --filter web @testing-library/react jsdom`.

- [ ] **Step 3: Update `ContactForm`**

Replace the existing component file with:

```tsx
'use client'

import { useState, type ChangeEvent, type FormEvent } from 'react'
import { Alert, Box, Button, Stack, TextField } from '@repo/ui/components'

type ContactFormState = {
  name: string
  company: string
  email: string
  phone: string
  message: string
}

const initialState: ContactFormState = {
  name: '',
  company: '',
  email: '',
  phone: '',
  message: '',
}

export function ContactForm() {
  const [form, setForm] = useState<ContactFormState>(initialState)
  const [submitted, setSubmitted] = useState(false)

  const handleChange =
    (field: keyof ContactFormState) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((prev) => ({ ...prev, [field]: event.target.value }))
    }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    console.log('Любые заметки contact request', form)
    setSubmitted(true)
    setForm(initialState)
  }

  return (
    <Stack spacing={3}>
      <Box
        component="form"
        onSubmit={handleSubmit}
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
          gap: 2,
        }}
      >
        <TextField
          label="Имя"
          name="name"
          value={form.name}
          onChange={handleChange('name')}
          required
          fullWidth
        />
        <TextField
          label="Компания"
          name="company"
          value={form.company}
          onChange={handleChange('company')}
          fullWidth
        />
        <TextField
          label="Телефон"
          name="phone"
          value={form.phone}
          onChange={handleChange('phone')}
          required
          fullWidth
        />
        <TextField
          label="Email"
          name="email"
          type="email"
          value={form.email}
          onChange={handleChange('email')}
          required
          fullWidth
        />
        <TextField
          label="Что нужно"
          name="message"
          value={form.message}
          onChange={handleChange('message')}
          fullWidth
          multiline
          minRows={3}
          sx={{ gridColumn: { md: '1 / -1' } }}
        />
        <Box sx={{ gridColumn: { md: '1 / -1' }, pt: 0.5 }}>
          <Button type="submit" size="large">
            Отправить запрос
          </Button>
        </Box>
      </Box>

      {submitted ? (
        <Alert severity="success">
          Заявка отправлена. Мы свяжемся в течение дня.
        </Alert>
      ) : null}
    </Stack>
  )
}
```

- [ ] **Step 4: Run test to confirm it passes**

Run: `pnpm --filter web test contact-form`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/public/contact-form.tsx apps/web/test/contact-form.test.tsx
git commit -m "feat(public): extend ContactForm with company and message fields"
```

---

### Task 6: Hero section component

**Files:**
- Create: `apps/web/src/components/public/home/home-hero.tsx`

- [ ] **Step 1: Create the file**

```tsx
// apps/web/src/components/public/home/home-hero.tsx
import { ArrowRightOutlinedIcon, Box, Button, Container, Stack, Typography } from '@repo/ui/components'

import { Origami } from './origami'
import { homeBaseSx, homeTokens } from './home-tokens'

const t = homeTokens.palette

type Props = {
  primaryHref: string
  primaryLabel: string
  showSecondary: boolean
}

export function HomeHero({ primaryHref, primaryLabel, showSecondary }: Props) {
  return (
    <Box
      component="section"
      sx={{
        ...homeBaseSx,
        position: 'relative',
        background: `linear-gradient(180deg, ${t.paper} 0%, ${t.paperDeep} 100%)`,
        borderBottom: `1px solid ${t.line}`,
        overflow: 'hidden',
        py: { xs: 6, md: 10 },
      }}
    >
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `linear-gradient(rgba(0,0,0,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.045) 1px, transparent 1px)`,
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(circle at 80% 20%, black, transparent 70%)',
          pointerEvents: 'none',
        }}
      />
      <Container maxWidth="xl" sx={{ position: 'relative' }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', lg: '1fr 1.15fr' },
            gap: { xs: 5, lg: 7 },
            alignItems: 'center',
          }}
        >
          <Stack spacing={3} sx={{ animation: 'anHeroIn 520ms ease-out both', maxWidth: 580 }}>
            <Box
              sx={{
                display: 'inline-flex', alignSelf: 'flex-start', alignItems: 'center', gap: 1,
                px: 1.5, py: 0.6, borderRadius: 999, bgcolor: '#fff',
                border: `1px solid ${t.line}`, fontSize: 12, color: '#444',
                '&::before': {
                  content: '""', width: 7, height: 7, borderRadius: '50%',
                  background: t.orange, boxShadow: `0 0 0 4px rgba(201,100,66,0.16)`,
                },
              }}
            >
              Любые заметки · ИИ-пространство
            </Box>
            <Typography
              component="h1"
              sx={{
                fontFamily: homeTokens.fonts.serif,
                fontWeight: 500,
                fontSize: { xs: '2.5rem', sm: '3.4rem', md: '4rem', xl: '4.5rem' },
                lineHeight: 1.02,
                letterSpacing: '-0.025em',
                color: t.ink,
                m: 0,
                '& em': { fontStyle: 'italic', color: t.orange },
              }}
            >
              Рабочая память команды <em>с ИИ-поиском</em>
            </Typography>
            <Typography sx={{ color: t.inkSoft, fontSize: { xs: '1rem', md: '1.06rem' }, lineHeight: 1.55, maxWidth: 480 }}>
              Соберите документы, заметки, схемы и файлы в одном пространстве. «Любые заметки» отвечает по вашим материалам и помогает быстро передать контекст команде или клиенту.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <Button
                href={primaryHref}
                size="large"
                endIcon={<ArrowRightOutlinedIcon />}
                sx={{
                  bgcolor: t.ink, color: `${t.paperDeep} !important`,
                  borderRadius: 1.25, minHeight: 50, px: 2.75,
                  '&:hover': { bgcolor: t.orange },
                  '& .MuiButton-endIcon': { color: 'inherit' },
                }}
              >
                {primaryLabel}
              </Button>
              {showSecondary && (
                <Button
                  href="/pricing"
                  variant="outlined"
                  size="large"
                  sx={{
                    borderRadius: 1.25, minHeight: 50, px: 2.5,
                    color: t.ink, borderColor: 'rgba(29,29,27,0.18)',
                  }}
                >
                  Смотреть тарифы
                </Button>
              )}
            </Stack>
            <Stack direction="row" useFlexGap flexWrap="wrap" sx={{ pt: 1.5, columnGap: 2.5, rowGap: 1, color: 'rgba(29,29,27,0.55)' }}>
              {['Без банковской карты', 'Публичные ссылки', 'ИИ по вашим данным'].map((label) => (
                <Stack key={label} direction="row" alignItems="center" spacing={1}>
                  <Box aria-hidden sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: t.orange, opacity: 0.8 }} />
                  <Typography variant="body2">{label}</Typography>
                </Stack>
              ))}
            </Stack>
          </Stack>

          <HeroPreview />
        </Box>
      </Container>
    </Box>
  )
}

function HeroPreview() {
  return (
    <Box sx={{ position: 'relative', minHeight: { xs: 320, sm: 460, lg: 520 }, animation: 'anSurfaceFloat 6s ease-in-out infinite' }}>
      <Origami variant="rhombus" size={96} gradient="warm" rotate={8} style={{ top: -10, left: '4%', zIndex: 3 }} />
      <Origami variant="triangle" size={70} gradient="deep" rotate={-15} style={{ bottom: 30, right: -8, zIndex: 3 }} />
      <Origami variant="circle" size={50} gradient="ink" style={{ bottom: -14, left: '16%', zIndex: 2 }} />

      <Box
        sx={{
          position: 'relative', zIndex: 4,
          mt: 2.5, ml: { lg: 2 },
          bgcolor: '#fff', borderRadius: 1.75,
          border: `1px solid ${homeTokens.palette.line}`,
          boxShadow: '0 30px 60px rgba(29,29,27,0.12), 0 6px 18px rgba(29,29,27,0.06)',
          overflow: 'hidden',
        }}
      >
        <BrowserChrome />
        <Box sx={{ display: 'grid', gridTemplateColumns: '168px 1fr', minHeight: 380 }}>
          <PreviewSidebar />
          <PreviewMain />
        </Box>
      </Box>
    </Box>
  )
}

function BrowserChrome() {
  return (
    <Stack direction="row" alignItems="center" spacing={0.75} sx={{ px: 1.5, py: 1.1, bgcolor: homeTokens.palette.paper, borderBottom: `1px solid ${homeTokens.palette.line}` }}>
      {[0, 1, 2].map((i) => (
        <Box key={i} sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'rgba(0,0,0,0.12)' }} />
      ))}
      <Typography sx={{ ml: 1.25, fontFamily: homeTokens.fonts.mono, fontSize: 10.5, color: 'rgba(0,0,0,0.42)' }}>
        любые-заметки.app / workspaces / база-знаний
      </Typography>
    </Stack>
  )
}

function PreviewSidebar() {
  const t = homeTokens.palette
  return (
    <Box component="aside" sx={{ bgcolor: t.paper, borderRight: `1px solid ${t.line}`, p: '10px 8px', fontSize: 12 }}>
      <Stack direction="row" alignItems="center" spacing={0.875} sx={{ p: '4px 6px 8px', borderBottom: `1px solid ${t.line}`, mb: 0.75 }}>
        <Box sx={{ width: 22, height: 22, borderRadius: 0.625, background: 'linear-gradient(135deg,#0f766e,#155e75)', display: 'grid', placeItems: 'center', fontSize: 12 }}>📒</Box>
        <Box>
          <Typography sx={{ fontWeight: 500, fontSize: 12.5, lineHeight: 1.1 }}>База знаний</Typography>
          <Box sx={{ mt: 0.25 }}>
            <Box component="span" sx={{ px: 0.75, py: '1px', borderRadius: 999, border: '1px solid rgba(0,0,0,0.15)', fontSize: 9.5, color: 'rgba(0,0,0,0.55)' }}>Бесплатный</Box>
          </Box>
        </Box>
      </Stack>
      <NavRow icon="🔍" label="Поиск и чаты" />
      <NavRow icon="⚙" label="Настройки" />
      <SectionLabel>Избранное</SectionLabel>
      <TreeItem chev="▾" emoji="⭐" label="Roadmap 2026" />
      <SectionLabel right="+">Страницы</SectionLabel>
      <TreeItem chev="▸" emoji="📝" label="Заметки встреч" />
      <TreeItem chev="▾" emoji="📄" label="Стратегия 2026" />
      <TreeItem nested active emoji="🎯" label="Q2 цели" />
      <TreeItem nested emoji="📊" label="Метрики" />
      <TreeItem chev="▸" emoji="🎨" label="Архитектура" />
      <TreeItem chev="▸" emoji="🌳" label="Команда" />
      <Box sx={{ mt: 1.75, pt: 1, borderTop: `1px solid ${t.line}` }}>
        <NavRow icon="🗑" label="Корзина" />
      </Box>
    </Box>
  )
}

function NavRow({ icon, label }: { icon: string; label: string }) {
  return (
    <Stack direction="row" alignItems="center" spacing={0.875} sx={{ p: '5px 7px', borderRadius: 0.625, color: 'rgba(0,0,0,0.65)', my: '1px' }}>
      <Box component="span" sx={{ fontSize: 12, opacity: 0.7 }}>{icon}</Box>
      <span>{label}</span>
    </Stack>
  )
}

function SectionLabel({ children, right }: { children: React.ReactNode; right?: string }) {
  return (
    <Stack direction="row" justifyContent="space-between" sx={{ mt: 1.25, p: '4px 7px 2px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(0,0,0,0.42)' }}>
      <span>{children}</span>
      {right && <span>{right}</span>}
    </Stack>
  )
}

function TreeItem({ chev, emoji, label, active, nested }: { chev?: string; emoji: string; label: string; active?: boolean; nested?: boolean }) {
  return (
    <Stack direction="row" alignItems="center" spacing={0.75} sx={{ p: '4px 7px', pl: nested ? '22px' : '7px', borderRadius: 0.625, color: active ? homeTokens.palette.ink : 'rgba(0,0,0,0.74)', bgcolor: active ? 'rgba(0,0,0,0.06)' : 'transparent', fontWeight: active ? 500 : 400, my: '1px' }}>
      {chev && <Box component="span" sx={{ width: 9, color: 'rgba(0,0,0,0.35)', fontSize: 9 }}>{chev}</Box>}
      <Box component="span" sx={{ fontSize: 12 }}>{emoji}</Box>
      <span>{label}</span>
    </Stack>
  )
}

function PreviewMain() {
  const t = homeTokens.palette
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ p: '10px 16px', borderBottom: `1px solid ${t.line}`, fontSize: 11.5, color: 'rgba(0,0,0,0.5)' }}>
        <span>База знаний</span><span style={{ opacity: 0.45 }}>/</span>
        <span>Стратегия 2026</span><span style={{ opacity: 0.45 }}>/</span>
        <Box component="span" sx={{ color: t.ink, fontWeight: 500 }}>Q2 цели</Box>
      </Stack>
      <Box sx={{ p: '22px 28px 18px', flex: 1 }}>
        <Box sx={{ width: 32, height: 32, bgcolor: 'rgba(201,100,66,0.12)', borderRadius: 0.75, display: 'grid', placeItems: 'center', fontSize: 18, mb: 1.25 }}>🎯</Box>
        <Typography sx={{ fontFamily: homeTokens.fonts.serif, fontSize: 22, fontWeight: 500, lineHeight: 1.15, letterSpacing: '-0.01em', mb: 1.75 }}>Q2 цели</Typography>
        {['92%', '78%', '86%'].map((w, i) => (
          <Box key={i} sx={{ height: 9, width: w, borderRadius: 0.375, bgcolor: 'rgba(0,0,0,0.08)', mb: 1 }} />
        ))}
        <Box sx={{ height: 14, width: '38%', borderRadius: 0.375, bgcolor: 'rgba(0,0,0,0.18)', mt: 2, mb: 1.25 }} />
        {['92%', '86%', '78%'].map((w, i) => (
          <Box key={`b${i}`} sx={{ height: 9, width: w, borderRadius: 0.375, bgcolor: 'rgba(0,0,0,0.08)', mb: 1 }} />
        ))}
      </Box>
      <AiPanel />
    </Box>
  )
}

function AiPanel() {
  const t = homeTokens.palette
  return (
    <Box sx={{ position: 'absolute', right: 18, bottom: 18, width: 270, bgcolor: t.ink, color: t.paperDeep, borderRadius: 1.5, p: '14px 16px', boxShadow: '0 24px 50px rgba(0,0,0,0.35)', zIndex: 5, overflow: 'hidden', '&::after': { content: '""', position: 'absolute', top: 0, bottom: 0, left: '-30%', width: '30%', background: 'linear-gradient(90deg, transparent, rgba(217,119,87,0.25), transparent)', animation: 'anScan 2.8s ease-in-out infinite' }, '@media (prefers-reduced-motion: reduce)': { '&::after': { display: 'none' } } }}>
      <Stack direction="row" alignItems="center" spacing={0.875} sx={{ fontSize: 12, color: 'rgba(240,238,230,0.65)', mb: 1 }}>
        <Box component="span" sx={{ color: t.orangeWarm }}>✦</Box>
        <span>Что мы обещали в марте?</span>
      </Stack>
      <Typography sx={{ fontSize: 13, lineHeight: 1.45, mb: 1.25 }}>
        Запуск рекламной кампании, редизайн сайта, еженедельные отчёты. Срок макета — 25 апреля.
      </Typography>
      <Stack spacing={0.625} sx={{ borderTop: '1px solid rgba(255,255,255,0.1)', pt: 1.25 }}>
        {[
          { em: '📄', name: 'Стратегия 2026' },
          { em: '📝', name: 'Заметка встречи 18.03' },
        ].map((s) => (
          <Stack key={s.name} direction="row" spacing={0.75} alignItems="center" sx={{ fontSize: 11, color: 'rgba(240,238,230,0.7)' }}>
            <span>{s.em}</span><span>{s.name}</span>
          </Stack>
        ))}
      </Stack>
    </Box>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter web check-types`
Expected: zero errors.

- [ ] **Step 3: Wire into page.tsx temporarily for visual check**

In `apps/web/src/app/page.tsx`, at the top of the existing `HomePage` return statement (just below `<PublicHeader>`), add:

```tsx
import { HomeHero } from '@/components/public/home/home-hero'
// ...
<HomeHero
  primaryHref={session ? '/app' : '/registration'}
  primaryLabel={session ? 'Открыть рабочее пространство' : 'Начать бесплатно'}
  showSecondary={!session}
/>
```

Run `pnpm --filter web dev` and navigate to `http://localhost:3000/`. Verify hero renders above the old hero. Then revert the temporary import (keep the new file untouched).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/public/home/home-hero.tsx
git commit -m "feat(public): add HomeHero section with workspace preview"
```

---

### Task 7: Market-fit section component

**Files:**
- Create: `apps/web/src/components/public/home/home-market-fit.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { Box, Container, Stack, Typography } from '@repo/ui/components'
import { eyebrowSx, sectionTitleSx, homeTokens } from './home-tokens'

const t = homeTokens.palette

const rows = [
  { value: '10 секунд', title: 'Понятно, что делает продукт', body: 'Главная сразу показывает рабочее пространство, ИИ-поиск и сценарий команды. Никаких абстрактных обещаний.' },
  { value: '1 ссылка', title: 'Меньше трения для клиента', body: 'Материалы, файлы, схемы и решения открываются в одном аккуратном пространстве — без «вот вам 12 файлов в почту».' },
  { value: '0 карт', title: 'Старт без лишних барьеров', body: 'Бесплатный персональный план помогает попробовать продукт до разговора о покупке.' },
] as const

export function HomeMarketFit() {
  return (
    <Box component="section" id="why" sx={{ bgcolor: t.paper, py: { xs: 7, md: 11 } }}>
      <Container maxWidth="xl">
        <Stack spacing={2}>
          <Typography sx={eyebrowSx}>ПОЧЕМУ ЭТО ВАЖНО</Typography>
          <Typography component="h2" sx={sectionTitleSx}>
            Команда покупает не хранилище — <em>а быстрый доступ к контексту</em>
          </Typography>
          <Typography sx={{ color: t.inkSoft, fontSize: 16, lineHeight: 1.6, maxWidth: 620 }}>
            Современный продукт даёт посетителю увидеть сценарий и начать без созвона. «Любые заметки» работает на этой логике с первой страницы.
          </Typography>
        </Stack>

        <Box sx={{ mt: { xs: 4, md: 6 }, borderTop: `1px solid ${t.line}` }}>
          {rows.map((row) => (
            <Box
              key={row.title}
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: '200px 0.85fr 1fr' },
                gap: { xs: 1, md: 4 },
                py: { xs: 3, md: 4 },
                borderBottom: `1px solid ${t.line}`,
                alignItems: 'baseline',
                transition: 'padding-left .25s ease',
                '&:hover': { pl: { md: 1.5 } },
                '@media (prefers-reduced-motion: reduce)': { '&:hover': { pl: 0 } },
              }}
            >
              <Typography sx={{ fontFamily: homeTokens.fonts.mono, color: t.orange, fontSize: 18 }}>{row.value}</Typography>
              <Typography sx={{ fontFamily: homeTokens.fonts.serif, fontSize: 22, fontWeight: 500, lineHeight: 1.2 }}>{row.title}</Typography>
              <Typography sx={{ color: t.inkSoft, lineHeight: 1.65 }}>{row.body}</Typography>
            </Box>
          ))}
        </Box>
      </Container>
    </Box>
  )
}
```

- [ ] **Step 2: Type-check + commit**

```bash
pnpm --filter web check-types
git add apps/web/src/components/public/home/home-market-fit.tsx
git commit -m "feat(public): add HomeMarketFit section"
```

---

### Task 8: Workspace modes section component

**Files:**
- Create: `apps/web/src/components/public/home/home-modes.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { Box, Container, Stack, Typography } from '@repo/ui/components'
import { eyebrowSx, sectionTitleSx, homeTokens } from './home-tokens'

const t = homeTokens.palette

type Mode = { icon: string; title: string; body: string; mini: 'doc' | 'canvas' | 'chat' | 'share' }
const modes: Mode[] = [
  { icon: '📄', title: 'Документы', body: 'Заметки, договоры, брифы и регламенты живут в структуре, которую понимает вся команда.', mini: 'doc' },
  { icon: '🎨', title: 'Схемы и холсты', body: 'Сложные процессы можно объяснять визуально рядом с текстом — без отдельной Miro.', mini: 'canvas' },
  { icon: '💬', title: 'ИИ-чаты', body: 'Помощник отвечает по материалам пространства и сохраняет контекст для следующего шага.', mini: 'chat' },
  { icon: '🔗', title: 'Публичные ссылки', body: 'Клиент видит чистую страницу с нужными материалами — без пересылки десятков вложений.', mini: 'share' },
]

export function HomeModes() {
  return (
    <Box component="section" id="modes" sx={{ bgcolor: '#fff', borderBlock: `1px solid ${t.line}`, py: { xs: 7, md: 11 } }}>
      <Container maxWidth="xl">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '0.8fr 1.2fr' }, gap: { xs: 4, lg: 7 }, alignItems: 'start' }}>
          <Stack spacing={2} sx={{ position: { lg: 'sticky' }, top: { lg: 96 } }}>
            <Typography sx={eyebrowSx}>РАБОЧЕЕ ПРОСТРАНСТВО</Typography>
            <Typography component="h2" sx={sectionTitleSx}>
              Один продукт — <em>четыре режима работы</em>
            </Typography>
            <Typography sx={{ color: t.inkSoft, fontSize: 16, lineHeight: 1.6, maxWidth: 460 }}>
              Текст, схемы, ИИ-чаты и публичные ссылки в одном дереве страниц. Не нужно переключаться между четырьмя инструментами.
            </Typography>
          </Stack>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, borderTop: `1px solid ${t.line}`, borderLeft: { sm: `1px solid ${t.line}` } }}>
            {modes.map((m) => (
              <Box
                key={m.title}
                sx={{
                  p: 3.25, borderRight: { sm: `1px solid ${t.line}` }, borderBottom: `1px solid ${t.line}`,
                  bgcolor: '#fff', transition: 'background .2s ease',
                  '&:hover': { bgcolor: t.paper },
                }}
              >
                <Box sx={{ width: 38, height: 38, bgcolor: 'rgba(201,100,66,0.12)', borderRadius: 1, display: 'grid', placeItems: 'center', fontSize: 18, color: t.orange, mb: 2.25 }}>
                  {m.icon}
                </Box>
                <Typography sx={{ fontFamily: homeTokens.fonts.serif, fontSize: 22, fontWeight: 500, mb: 1, letterSpacing: '-0.01em' }}>
                  {m.title}
                </Typography>
                <Typography sx={{ color: t.inkSoft, fontSize: 14, lineHeight: 1.6, mb: 2.25 }}>{m.body}</Typography>
                <ModeMini variant={m.mini} />
              </Box>
            ))}
          </Box>
        </Box>
      </Container>
    </Box>
  )
}

function ModeMini({ variant }: { variant: Mode['mini'] }) {
  const wrapper = { bgcolor: homeTokens.palette.paper, border: `1px solid ${homeTokens.palette.line}`, borderRadius: 1, p: 1.5, minHeight: 100, position: 'relative' as const, overflow: 'hidden' }
  if (variant === 'doc') {
    const lines = [{ h: 10, w: '50%', dark: true }, { h: 7, w: '88%' }, { h: 7, w: '72%' }, { h: 7, w: '80%' }, { h: 7, w: '88%' }] as const
    return (
      <Box sx={wrapper}>
        {lines.map((l, i) => (
          <Box key={i} sx={{ height: l.h, width: l.w, borderRadius: 0.25, bgcolor: l.dark ? homeTokens.palette.ink : 'rgba(0,0,0,0.1)', mb: 0.75 }} />
        ))}
      </Box>
    )
  }
  if (variant === 'canvas') {
    return (
      <Box sx={{ ...wrapper, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.25 }}>
        <Box aria-hidden sx={{ position: 'absolute', top: '50%', left: '12%', right: '12%', height: '1px', bgcolor: 'rgba(0,0,0,0.15)' }} />
        <Box sx={{ width: 36, height: 36, borderRadius: '50%', bgcolor: homeTokens.palette.ink, boxShadow: '2px 2px 6px rgba(0,0,0,0.1)', position: 'relative' }} />
        <Box sx={{ width: 40, height: 40, bgcolor: homeTokens.palette.orange, clipPath: 'polygon(50% 0, 100% 100%, 0 100%)', boxShadow: '2px 2px 6px rgba(0,0,0,0.1)', position: 'relative' }} />
        <Box sx={{ width: 36, height: 36, borderRadius: 0.75, bgcolor: homeTokens.palette.orangeWarm, transform: 'rotate(15deg)', boxShadow: '2px 2px 6px rgba(0,0,0,0.1)', position: 'relative' }} />
      </Box>
    )
  }
  if (variant === 'chat') {
    return (
      <Stack spacing={0.75} sx={wrapper}>
        <Box sx={{ alignSelf: 'flex-end', bgcolor: homeTokens.palette.ink, color: homeTokens.palette.paperDeep, borderRadius: 1.25, px: 1.25, py: 0.75, fontSize: 11, maxWidth: '80%' }}>Что мы обещали клиенту?</Box>
        <Box sx={{ alignSelf: 'flex-start', bgcolor: 'rgba(201,100,66,0.12)', color: homeTokens.palette.ink, border: '1px solid rgba(201,100,66,0.22)', borderRadius: 1.25, px: 1.25, py: 0.75, fontSize: 11, maxWidth: '80%' }}>
          <Box component="span" sx={{ color: homeTokens.palette.orange, mr: 0.5 }}>✦</Box>
          Редизайн сайта и отчёт. Срок — 25 апреля.
        </Box>
      </Stack>
    )
  }
  return (
    <Stack spacing={1} sx={wrapper}>
      <Box sx={{ fontFamily: homeTokens.fonts.mono, fontSize: 10, bgcolor: '#fff', border: '1px dashed rgba(0,0,0,0.2)', p: '6px 9px', borderRadius: 0.75, color: 'rgba(0,0,0,0.6)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        любые-заметки.app/<Box component="span" sx={{ color: homeTokens.palette.orange }}>share/abc123</Box>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: '30px 1fr', gap: 1, bgcolor: '#fff', border: `1px solid ${homeTokens.palette.line}`, borderRadius: 0.75, p: 0.875 }}>
        <Box sx={{ bgcolor: homeTokens.palette.ink, borderRadius: 0.5 }} />
        <Stack spacing={0.5} justifyContent="center">
          <Box sx={{ height: 5, width: '80%', borderRadius: 0.25, bgcolor: 'rgba(0,0,0,0.18)' }} />
          <Box sx={{ height: 5, width: '60%', borderRadius: 0.25, bgcolor: 'rgba(0,0,0,0.1)' }} />
        </Stack>
      </Box>
    </Stack>
  )
}
```

- [ ] **Step 2: Type-check + commit**

```bash
pnpm --filter web check-types
git add apps/web/src/components/public/home/home-modes.tsx
git commit -m "feat(public): add HomeModes section with 4 mode cards"
```

---

### Task 9: ИИ-поиск section component

**Files:**
- Create: `apps/web/src/components/public/home/home-search.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { Box, Container, Stack, Typography } from '@repo/ui/components'
import { eyebrowSx, sectionTitleSx, homeBaseSx, homeTokens } from './home-tokens'

const t = homeTokens.palette

const steps = [
  'Загрузите документы, заметки и вложения команды',
  'Разложите их по рабочим пространствам и страницам',
  'Задайте вопрос обычными словами',
  'Получите ответ со ссылками на исходные материалы',
] as const

const sources = [
  { em: '📄', name: 'Договор № 14 от 12.03', meta: '2 цитаты' },
  { em: '📋', name: 'Бриф проекта', meta: '3 цитаты' },
  { em: '📝', name: 'Заметка встречи 18.03', meta: '1 цитата' },
] as const

export function HomeSearch() {
  return (
    <Box component="section" id="search" sx={{ ...homeBaseSx, bgcolor: t.paper, py: { xs: 7, md: 11 } }}>
      <Container maxWidth="xl">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '0.9fr 1.1fr' }, gap: { xs: 4, lg: 8 }, alignItems: 'start' }}>
          <Stack spacing={2}>
            <Typography sx={eyebrowSx}>ИИ-ПОИСК</Typography>
            <Typography component="h2" sx={sectionTitleSx}>
              Ответ должен приходить из ваших документов — <em>не из догадок</em>
            </Typography>
            <Typography sx={{ color: t.inkSoft, fontSize: 16, lineHeight: 1.6, maxWidth: 560 }}>
              Вместо поиска по папкам команда спрашивает «Любые заметки» обычными словами и сразу видит, на какие материалы опирается ответ.
            </Typography>
            <Stack spacing={1.75} sx={{ mt: 3 }}>
              {steps.map((step, i) => (
                <Stack key={step} direction="row" spacing={1.75} alignItems="flex-start">
                  <Box sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: t.ink, color: t.paperDeep, display: 'grid', placeItems: 'center', fontFamily: homeTokens.fonts.mono, fontSize: 12, flexShrink: 0 }}>{i + 1}</Box>
                  <Typography sx={{ fontSize: 16, lineHeight: 1.5, pt: '3px' }}>{step}</Typography>
                </Stack>
              ))}
            </Stack>
          </Stack>

          <Box sx={{ bgcolor: '#fff', border: `1px solid ${t.line}`, borderRadius: 1.75, boxShadow: '0 30px 60px rgba(29,29,27,0.08)', overflow: 'hidden' }}>
            <Stack
              direction="row"
              alignItems="center"
              spacing={1.25}
              sx={{
                bgcolor: t.ink, color: t.paperDeep, p: '18px 22px', position: 'relative', overflow: 'hidden',
                '&::after': { content: '""', position: 'absolute', top: 0, bottom: 0, left: '-30%', width: '30%', background: 'linear-gradient(90deg, transparent, rgba(217,119,87,0.28), transparent)', animation: 'anScan 3s ease-in-out infinite' },
                '@media (prefers-reduced-motion: reduce)': { '&::after': { display: 'none' } },
              }}
            >
              <Box component="span" sx={{ color: t.orangeWarm, fontSize: 14 }}>✦</Box>
              <Typography sx={{ fontWeight: 500, fontSize: 15 }}>Что мы обещали клиенту в марте?</Typography>
            </Stack>
            <Box sx={{ p: '22px 24px 18px' }}>
              <Typography sx={{ fontFamily: homeTokens.fonts.serif, fontSize: 19, lineHeight: 1.45, mb: 2.25, letterSpacing: '-0.005em' }}>
                В марте команда согласовала редизайн сайта, запуск рекламной кампании и еженедельные отчёты. Крайний срок первого макета — <Box component="span" sx={{ borderRight: `2px solid ${t.orange}`, pr: '2px' }}>25 апреля</Box>.
              </Typography>
              <Box sx={{ height: 1, bgcolor: t.line, mx: -3, mb: 2 }} />
              <Typography sx={{ ...eyebrowSx, mb: 1.25 }}>ИСТОЧНИКИ</Typography>
              <Stack spacing={1}>
                {sources.map((s) => (
                  <Stack
                    key={s.name}
                    direction="row"
                    spacing={1.25}
                    alignItems="center"
                    sx={{ p: '8px 10px', borderRadius: 1, bgcolor: t.paper, transition: 'background .18s ease', '&:hover': { bgcolor: t.paperDeep } }}
                  >
                    <Box component="span" sx={{ fontSize: 16 }}>{s.em}</Box>
                    <Typography sx={{ fontSize: 13, flex: 1 }}>{s.name}</Typography>
                    <Typography sx={{ fontFamily: homeTokens.fonts.mono, fontSize: 11, color: t.inkMute }}>{s.meta}</Typography>
                  </Stack>
                ))}
              </Stack>
            </Box>
          </Box>
        </Box>
      </Container>
    </Box>
  )
}
```

- [ ] **Step 2: Type-check + commit**

```bash
pnpm --filter web check-types
git add apps/web/src/components/public/home/home-search.tsx
git commit -m "feat(public): add HomeSearch section with answer card"
```

---

### Task 10: Что ещё (features) section component

**Files:**
- Create: `apps/web/src/components/public/home/home-features.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { Box, Container, Stack, Typography } from '@repo/ui/components'
import { eyebrowSx, sectionTitleSx, homeTokens } from './home-tokens'
import { homeFeatures } from '../content'

const t = homeTokens.palette

export function HomeFeatures() {
  return (
    <Box component="section" id="features" sx={{ bgcolor: t.paper, py: { xs: 7, md: 11 } }}>
      <Container maxWidth="xl">
        <Stack spacing={2}>
          <Typography sx={eyebrowSx}>ВОЗМОЖНОСТИ</Typography>
          <Typography component="h2" sx={sectionTitleSx}>
            Что ещё <em>стоит знать</em>
          </Typography>
          <Typography sx={{ color: t.inkSoft, fontSize: 16, lineHeight: 1.6, maxWidth: 620 }}>
            Шесть свойств, на которые мы зашили инженерные часы, чтобы продукт был приятным в ежедневной работе.
          </Typography>
        </Stack>

        <Box
          sx={{
            mt: { xs: 5, md: 7 },
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
            columnGap: { xs: 3, md: 6 },
            rowGap: { xs: 4.5, md: 7 },
          }}
        >
          {homeFeatures.map((f) => (
            <Box key={f.title}>
              <Box sx={{ fontSize: 22, lineHeight: 1, mb: 2.25 }}>{f.icon}</Box>
              <Typography sx={{ fontFamily: homeTokens.fonts.serif, fontSize: 20, fontWeight: 500, lineHeight: 1.2, letterSpacing: '-0.01em', mb: 0.5 }}>
                {f.title}
              </Typography>
              <Typography sx={{ fontSize: 14, lineHeight: 1.6, color: t.inkSoft, maxWidth: 320 }}>
                {f.body}
              </Typography>
            </Box>
          ))}
        </Box>
      </Container>
    </Box>
  )
}
```

- [ ] **Step 2: Type-check + commit**

```bash
pnpm --filter web check-types
git add apps/web/src/components/public/home/home-features.tsx
git commit -m "feat(public): add HomeFeatures section (Что ещё)"
```

---

### Task 11: Pricing section component

**Files:**
- Create: `apps/web/src/components/public/home/home-pricing.tsx`

- [ ] **Step 1: Create the file**

```tsx
import Link from 'next/link'
import { Box, Button, Container, Stack, Typography } from '@repo/ui/components'

import { landingPricingCards } from '../content'
import { eyebrowSx, sectionTitleSx, homeTokens } from './home-tokens'

const t = homeTokens.palette

export function HomePricing() {
  return (
    <Box component="section" id="pricing" sx={{ bgcolor: t.ink, color: t.paperDeep, py: { xs: 7, md: 11 } }}>
      <Container maxWidth="xl">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '0.7fr 1.3fr' }, gap: { xs: 4, lg: 7 }, alignItems: 'start' }}>
          <Stack spacing={2}>
            <Typography sx={{ ...eyebrowSx, color: 'rgba(240,238,230,0.55)' }}>ТАРИФЫ</Typography>
            <Typography component="h2" sx={{ ...sectionTitleSx, color: t.paperDeep }}>
              Начните бесплатно — <em>расширяйте по мере роста</em>
            </Typography>
            <Button
              href="/pricing"
              variant="outlined"
              sx={{ alignSelf: 'flex-start', mt: 1, color: t.paperDeep, borderColor: 'rgba(240,238,230,0.28)' }}
            >
              Сравнить планы
            </Button>
          </Stack>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' },
              borderTop: '1px solid rgba(240,238,230,0.16)',
              borderLeft: { md: '1px solid rgba(240,238,230,0.16)' },
            }}
          >
            {landingPricingCards.map((plan) => {
              const isFeatured = plan.slug === 'pro'
              return (
                <Link key={plan.slug} href="/pricing" style={{ color: 'inherit', textDecoration: 'none' }}>
                  <Box
                    sx={{
                      p: 3.5, minHeight: 280, position: 'relative', display: 'flex', flexDirection: 'column',
                      borderRight: { md: '1px solid rgba(240,238,230,0.16)' },
                      borderBottom: '1px solid rgba(240,238,230,0.16)',
                      bgcolor: isFeatured ? 'rgba(201,100,66,0.14)' : 'transparent',
                      transition: 'background-color .2s ease',
                      '&:hover': { bgcolor: isFeatured ? 'rgba(201,100,66,0.18)' : 'rgba(240,238,230,0.04)' },
                    }}
                  >
                    {isFeatured && (
                      <Box
                        aria-hidden
                        sx={{
                          position: 'absolute', top: -16, right: 18, width: 32, height: 32,
                          background: `linear-gradient(135deg, ${t.orangeWarm}, ${t.orange})`,
                          clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
                          boxShadow: '4px 6px 14px rgba(0,0,0,0.3)', transform: 'rotate(8deg)',
                        }}
                      />
                    )}
                    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.25 }}>
                      <Typography sx={{ fontFamily: homeTokens.fonts.serif, fontSize: 22, fontWeight: 500, color: t.paperDeep }}>{plan.name}</Typography>
                      {isFeatured && (
                        <Box component="span" sx={{ bgcolor: t.paperDeep, color: t.ink, fontSize: 10, px: 1, py: '3px', borderRadius: 999, fontFamily: homeTokens.fonts.mono, textTransform: 'uppercase', letterSpacing: '0.08em' }}>популярный</Box>
                      )}
                    </Stack>
                    <Typography
                      sx={{
                        fontFamily: homeTokens.fonts.serif, fontSize: 28, fontWeight: 500, letterSpacing: '-0.01em', mb: 1.75,
                        color: plan.slug === 'personal' ? t.orangeWarm : t.paperDeep,
                      }}
                    >
                      {plan.price}
                    </Typography>
                    <Stack component="ul" spacing={0.875} sx={{ flex: 1, p: 0, m: 0, listStyle: 'none' }}>
                      {plan.features.map((item) => (
                        <Typography
                          component="li"
                          key={item}
                          sx={{
                            position: 'relative', pl: 2.25, fontSize: 13, lineHeight: 1.55,
                            color: 'rgba(240,238,230,0.72)',
                            '&::before': { content: '"+"', position: 'absolute', left: 0, top: 0, color: t.orangeWarm, fontFamily: homeTokens.fonts.mono },
                          }}
                        >
                          {item}
                        </Typography>
                      ))}
                    </Stack>
                    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 2 }}>
                      <Typography sx={{ fontSize: 13, color: 'rgba(240,238,230,0.85)' }}>Подробнее →</Typography>
                    </Stack>
                  </Box>
                </Link>
              )
            })}
          </Box>
        </Box>
      </Container>
    </Box>
  )
}
```

- [ ] **Step 2: Type-check + commit**

```bash
pnpm --filter web check-types
git add apps/web/src/components/public/home/home-pricing.tsx
git commit -m "feat(public): add HomePricing dark section"
```

---

### Task 12: Особое решение (contact) section component

**Files:**
- Create: `apps/web/src/components/public/home/home-contact.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { Box, Container, Stack, Typography } from '@repo/ui/components'

import { ContactForm } from '../contact-form'
import { Origami } from './origami'
import { eyebrowSx, sectionTitleSx, homeTokens } from './home-tokens'

const t = homeTokens.palette

export function HomeContact() {
  return (
    <Box component="section" id="contact" sx={{ bgcolor: '#fff', py: { xs: 7, md: 11 } }}>
      <Container maxWidth="xl">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1.1fr' }, gap: { xs: 4, lg: 8 }, alignItems: 'center' }}>
          <Stack spacing={2}>
            <Typography sx={eyebrowSx}>ОСОБОЕ РЕШЕНИЕ</Typography>
            <Typography component="h2" sx={sectionTitleSx}>
              Нужна <em>нестандартная конфигурация?</em>
            </Typography>
            <Typography sx={{ color: t.inkSoft, fontSize: 16, lineHeight: 1.6, maxWidth: 540 }}>
              On-prem, выделенный домен, SSO, индивидуальные интеграции, корпоративный тариф — оставьте контакты, обсудим за день.
            </Typography>

            <Box sx={{ position: 'relative', minHeight: 280, mt: 3, display: { xs: 'none', md: 'block' } }}>
              <Origami variant="rhombus" size={140} gradient="warm" rotate={8} style={{ top: 0, left: 24 }} />
              <Origami variant="triangle" size={90} gradient="deep" rotate={-12} style={{ top: 60, right: 30 }} />
              <Origami variant="circle" size={70} gradient="ink" style={{ bottom: 0, left: 110 }} />
              <Box sx={{ position: 'absolute', bottom: 18, right: 0, bgcolor: '#fff', border: `1px solid ${t.line}`, borderRadius: 1.5, p: '14px 16px', boxShadow: '0 18px 40px rgba(0,0,0,0.08)', maxWidth: 240, zIndex: 2 }}>
                <Typography sx={{ ...eyebrowSx, mb: 0.75 }}>СРЕДНЕЕ ВРЕМЯ ОТВЕТА</Typography>
                <Typography sx={{ fontFamily: homeTokens.fonts.serif, fontSize: 14, lineHeight: 1.4, m: 0 }}>
                  «Связались в тот же день и собрали стенд за неделю».
                </Typography>
              </Box>
            </Box>
          </Stack>

          <Box sx={{ bgcolor: '#fff', border: `1px solid ${t.line}`, borderRadius: 1.75, p: { xs: 3, md: 3.5 }, boxShadow: '0 24px 48px rgba(0,0,0,0.06)' }}>
            <ContactForm />
          </Box>
        </Box>
      </Container>
    </Box>
  )
}
```

- [ ] **Step 2: Type-check + commit**

```bash
pnpm --filter web check-types
git add apps/web/src/components/public/home/home-contact.tsx
git commit -m "feat(public): add HomeContact section with origami illustration"
```

---

### Task 13: Final CTA section component

**Files:**
- Create: `apps/web/src/components/public/home/home-final-cta.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { ArrowRightOutlinedIcon, Box, Button, Container, Stack, Typography } from '@repo/ui/components'

import { Origami } from './origami'
import { homeTokens } from './home-tokens'

const t = homeTokens.palette

type Props = { primaryHref: string; primaryLabel: string }

export function HomeFinalCta({ primaryHref, primaryLabel }: Props) {
  return (
    <Box
      component="section"
      sx={{
        position: 'relative',
        background: `linear-gradient(180deg, ${t.paper} 0%, ${t.paperDeep} 100%)`,
        py: { xs: 8, md: 11 },
        overflow: 'hidden',
      }}
    >
      <Origami
        variant="rhombus"
        size={260}
        gradient="warm"
        style={{ top: '50%', right: -60, transform: 'translateY(-50%) rotate(0deg)', boxShadow: '-20px 20px 60px rgba(201,100,66,0.3)', opacity: 0.85 }}
      />
      <Origami variant="circle" size={80} gradient="ink" style={{ bottom: 30, left: 60, boxShadow: '8px 12px 30px rgba(0,0,0,0.2)' }} />

      <Container maxWidth="xl" sx={{ position: 'relative', zIndex: 2 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr auto' }, gap: { xs: 3, md: 5 }, alignItems: 'end' }}>
          <Stack spacing={2}>
            <Typography
              component="h2"
              sx={{
                fontFamily: homeTokens.fonts.serif, fontWeight: 500,
                fontSize: { xs: '2.25rem', md: '4rem' }, lineHeight: 1.02, letterSpacing: '-0.025em',
                color: t.ink, m: 0, maxWidth: 720,
                '& em': { fontStyle: 'italic', color: t.orange },
              }}
            >
              Перенесите рабочие знания туда, <em>где их можно найти</em>
            </Typography>
            <Typography sx={{ color: t.inkSoft, fontSize: 16, lineHeight: 1.6, maxWidth: 540 }}>
              Регистрация занимает пару минут. Начните с личного пространства и подключите команду позже.
            </Typography>
          </Stack>
          <Button
            href={primaryHref}
            size="large"
            endIcon={<ArrowRightOutlinedIcon />}
            sx={{ bgcolor: t.ink, color: `${t.paperDeep} !important`, borderRadius: 1.5, minHeight: 56, px: 3.5, fontSize: 16, '& .MuiButton-endIcon': { color: 'inherit' }, '&:hover': { bgcolor: t.orange } }}
          >
            {primaryLabel}
          </Button>
        </Box>
      </Container>
    </Box>
  )
}
```

- [ ] **Step 2: Type-check + commit**

```bash
pnpm --filter web check-types
git add apps/web/src/components/public/home/home-final-cta.tsx
git commit -m "feat(public): add HomeFinalCta section"
```

---

### Task 14: Slim down page.tsx composer

**Files:**
- Modify: `apps/web/src/app/page.tsx`

- [ ] **Step 1: Replace the entire file**

```tsx
import type { Metadata } from 'next'

import { PublicFooter } from '@/components/public/public-footer'
import { PublicHeader } from '@/components/public/public-header'
import { getSession } from '@/lib/get-session'

import { HomeHero } from '@/components/public/home/home-hero'
import { HomeMarketFit } from '@/components/public/home/home-market-fit'
import { HomeModes } from '@/components/public/home/home-modes'
import { HomeSearch } from '@/components/public/home/home-search'
import { HomeFeatures } from '@/components/public/home/home-features'
import { HomePricing } from '@/components/public/home/home-pricing'
import { HomeContact } from '@/components/public/home/home-contact'
import { HomeFinalCta } from '@/components/public/home/home-final-cta'

export const metadata: Metadata = {
  title: 'Любые заметки — рабочая память команды',
}

export default async function HomePage() {
  const session = await getSession()
  const primaryHref = session ? '/app' : '/registration'
  const primaryLabel = session ? 'Открыть рабочее пространство' : 'Начать бесплатно'

  return (
    <>
      <PublicHeader session={session} />
      <main>
        <HomeHero primaryHref={primaryHref} primaryLabel={primaryLabel} showSecondary={!session} />
        <HomeMarketFit />
        <HomeModes />
        <HomeSearch />
        <HomeFeatures />
        <HomePricing />
        <HomeContact />
        <HomeFinalCta primaryHref={primaryHref} primaryLabel={primaryLabel} />
      </main>
      <PublicFooter />
    </>
  )
}
```

- [ ] **Step 2: Type-check + dev verify**

Run `pnpm --filter web check-types`. Then `pnpm --filter web dev` and load `http://localhost:3000/`. Walk through every section visually. Resize the window to 360 / 768 / 1024 / 1440 to verify the responsive grids degrade as specified in the spec.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/page.tsx
git commit -m "refactor(web): compose home page from new section components"
```

---

### Task 15: Repaint public footer

**Files:**
- Modify: `apps/web/src/components/public/public-footer.tsx`

- [ ] **Step 1: Replace the file content**

```tsx
import Link from 'next/link'
import { Box, Container, Stack, Typography } from '@repo/ui/components'

import { publicContact, publicFooterSections } from './content'
import { Origami } from './home/origami'
import { homeTokens } from './home/home-tokens'

const t = homeTokens.palette

export function PublicFooter() {
  return (
    <Box component="footer" sx={{ bgcolor: t.ink, color: t.paperDeep, mt: { xs: 8, md: 12 } }}>
      <Container maxWidth="xl" sx={{ position: 'relative', py: { xs: 6, md: 8 } }}>
        <Box
          aria-hidden
          sx={{
            position: 'absolute', right: -50, top: -30, width: 180, height: 180,
            background: 'radial-gradient(circle at 30% 30%, rgba(217,119,87,0.16), transparent 70%)',
            pointerEvents: 'none',
          }}
        />

        <Box
          sx={{
            position: 'relative',
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: '1.4fr 1fr 1fr 1fr' },
            gap: { xs: 4, md: 6 },
            pb: { xs: 4, md: 5 },
            borderBottom: '1px solid rgba(240,238,230,0.12)',
          }}
        >
          <Stack spacing={2}>
            <Stack direction="row" alignItems="center" spacing={1.25}>
              <Box sx={{ position: 'relative', width: 28, height: 28 }}>
                <Origami variant="rhombus" size={28} gradient="warm" style={{ position: 'static' }} />
              </Box>
              <Typography sx={{ fontFamily: homeTokens.fonts.serif, fontSize: 22, fontWeight: 500, letterSpacing: '-0.01em' }}>
                Любые заметки
              </Typography>
            </Stack>
            <Typography sx={{ color: 'rgba(240,238,230,0.6)', fontSize: 14, lineHeight: 1.6, maxWidth: 320 }}>
              Рабочая память команды с ИИ-поиском. Документы, схемы, заметки и файлы — в одном пространстве.
            </Typography>
            <Stack direction="row" spacing={1}>
              <FooterBadge>RU · 2026</FooterBadge>
              <FooterBadge>ИИ-поиск</FooterBadge>
            </Stack>
          </Stack>

          {publicFooterSections.map((section) => (
            <Stack key={section.title} spacing={2}>
              <Typography sx={{ fontFamily: homeTokens.fonts.mono, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(240,238,230,0.55)' }}>
                {section.title}
              </Typography>
              <Stack spacing={1.25}>
                {section.links.map((link) => (
                  <Box
                    key={link.href}
                    component={Link}
                    href={link.href}
                    sx={{ color: t.paperDeep, textDecoration: 'none', fontSize: 14, '&:hover': { color: t.orangeWarm } }}
                  >
                    {link.label}
                  </Box>
                ))}
              </Stack>
            </Stack>
          ))}

          <Stack spacing={2}>
            <Typography sx={{ fontFamily: homeTokens.fonts.mono, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(240,238,230,0.55)' }}>
              Связаться
            </Typography>
            <Stack spacing={1.25}>
              <FooterContact icon="✉" href={`mailto:${publicContact.email}`}>{publicContact.email}</FooterContact>
              <FooterContact icon="📞" href={`tel:${publicContact.phone.replace(/\s|\(|\)|-/g, '')}`}>{publicContact.phone}</FooterContact>
              {publicContact.telegram ? (
                <FooterContact icon="✈" href={`https://t.me/${publicContact.telegram.replace(/^@/, '')}`}>{publicContact.telegram}</FooterContact>
              ) : null}
            </Stack>
          </Stack>
        </Box>

        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          spacing={2}
          sx={{ pt: 3, fontSize: 12, color: 'rgba(240,238,230,0.45)' }}
        >
          <span>© {new Date().getFullYear()} «Любые заметки». Все права защищены.</span>
          <Stack direction="row" spacing={2.25}>
            {[
              { label: 'Политика', href: '/privacy' },
              { label: 'Оферта', href: '/oferta' },
              { label: 'Cookies', href: '/privacy#cookies' },
            ].map((l) => (
              <Box key={l.href} component={Link} href={l.href} sx={{ color: 'inherit', textDecoration: 'none', '&:hover': { color: t.paperDeep } }}>
                {l.label}
              </Box>
            ))}
          </Stack>
        </Stack>
      </Container>
    </Box>
  )
}

function FooterBadge({ children }: { children: React.ReactNode }) {
  return (
    <Box component="span" sx={{ fontFamily: homeTokens.fonts.mono, fontSize: 10, px: 1.125, py: 0.5, borderRadius: 999, border: '1px solid rgba(240,238,230,0.18)', color: 'rgba(240,238,230,0.7)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
      {children}
    </Box>
  )
}

function FooterContact({ icon, href, children }: { icon: string; href: string; children: React.ReactNode }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1}>
      <Box component="span" sx={{ fontSize: 14, opacity: 0.7 }}>{icon}</Box>
      <Box
        component={Link}
        href={href}
        sx={{ color: homeTokens.palette.paperDeep, textDecoration: 'none', fontSize: 14, '&:hover': { color: homeTokens.palette.orangeWarm } }}
      >
        {children}
      </Box>
    </Stack>
  )
}
```

- [ ] **Step 2: Type-check + dev verify**

Run `pnpm --filter web check-types`. Visit any public route in `pnpm --filter web dev` (e.g., `/`, `/pricing`, `/contact`) — footer should now be the new dark Claude version.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/public/public-footer.tsx
git commit -m "feat(public): repaint footer in Claude editorial style"
```

---

### Task 16: Update header brand and rebrand sweep

**Files:**
- Modify: `apps/web/src/components/public/public-header.tsx`
- Modify: `apps/web/src/components/public/public-page-shell.tsx` (if it references "AnyNote")
- Modify: `apps/web/src/app/(about)/contact/page.tsx`, `pricing/page.tsx`, `roadmap/page.tsx`, `docs/page.tsx`, `oferta/page.tsx`, `terms/page.tsx`, `privacy/page.tsx`, `developers/page.tsx`, `offer/page.tsx`
- Modify: `apps/web/src/app/registration/**/*.tsx`, `(auth)/**/*.tsx` (visible copy only)
- Modify: `packages/mail/src/templates/*.tsx` (subjects/bodies referring to "AnyNote")

- [ ] **Step 1: Find every JSX/string occurrence of "AnyNote" on public surfaces**

Run:

```bash
rg -n 'AnyNote' apps/web/src/app apps/web/src/components/public packages/mail/src/templates
```

Expected: a finite list — header logo text, page metadata titles, contact-page intro, footer fallback strings, mail template subjects, brand copy in marketing pages. Save the list to scratch.

- [ ] **Step 2: Replace each visible string**

For each match, replace `AnyNote` with `Любые заметки` in JSX text, `metadata.title`, `metadata.description`, mail template `subject` strings, and any user-facing string literal. **Do not** rename identifiers (`AnyNoteFooter`, `AnyNoteContext`, etc.) — only string values.

For the header file `apps/web/src/components/public/public-header.tsx`, swap the wordmark and aria-label too. If the existing header uses MUI's `Box component={Link}` for the logo, that pattern stays the same; only the visible string changes.

- [ ] **Step 3: Rebrand "AI" → "ИИ" in copy**

Run:

```bash
rg -n '\bAI\b' apps/web/src/app apps/web/src/components/public packages/mail/src/templates
```

For each match in JSX text, attribute values that surface to users, or template body, replace `AI` with `ИИ`. **Do not** touch identifiers (`AiModel`, `useAI`, `AI_*` constants), import paths, or CSS class names. Only user-facing copy.

After the replace, sanity-check: `rg -n 'AI' apps/web/src/components/public/content.ts` should return zero matches in user-facing fields (it may match identifiers if any).

- [ ] **Step 4: Type-check + lint**

```bash
pnpm --filter web check-types
pnpm --filter web lint
```

Expected: zero errors. If lint flags an unused import or stale string, fix before committing.

- [ ] **Step 5: Visual sweep**

Run `pnpm --filter web dev` and click through `/`, `/pricing`, `/contact`, `/roadmap`, `/docs`, `/privacy`, `/oferta`, `/sign-in`, `/registration`. Confirm no "AnyNote" or " AI " remains visible.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(public): rebrand AnyNote→Любые заметки, AI→ИИ across public surfaces"
```

---

### Task 17: Playwright e2e for the home page

**Files:**
- Create: `apps/e2e/home-redesign.spec.ts`

- [ ] **Step 1: Write the test**

```ts
// apps/e2e/home-redesign.spec.ts
import { expect, test } from '@playwright/test'

test.describe('Home page (redesign)', () => {
  test('renders the new hero, pricing, and footer', async ({ page }) => {
    await page.goto('/')

    // Hero — new heading
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Рабочая память команды')

    // Section anchors
    for (const anchor of ['why', 'modes', 'search', 'features', 'pricing', 'contact']) {
      await expect(page.locator(`#${anchor}`)).toBeVisible()
    }

    // Pricing — "Чаты с ИИ" present, no "AI"
    await expect(page.locator('#pricing')).toContainText('Чаты с ИИ')

    // Footer brand
    await expect(page.locator('footer')).toContainText('Любые заметки')

    // No "AnyNote" anywhere
    await expect(page.locator('body')).not.toContainText('AnyNote')
  })

  test('contact form submits and shows success', async ({ page }) => {
    await page.goto('/')
    const contact = page.locator('#contact')
    await contact.scrollIntoViewIfNeeded()

    await contact.getByLabel('Имя').fill('Виктор')
    await contact.getByLabel('Email').fill('victor@example.ru')
    await contact.getByLabel('Телефон').fill('+74951234567')
    await contact.getByLabel('Что нужно').fill('On-prem на 200 пользователей')
    await contact.getByRole('button', { name: 'Отправить запрос' }).click()

    await expect(contact.getByText('Заявка отправлена')).toBeVisible()
  })
})
```

- [ ] **Step 2: Run the test**

Run: `pnpm exec playwright test apps/e2e/home-redesign.spec.ts`

Expected: both tests pass. The Playwright config at the repo root already starts a Next.js server on port 3100 — no additional setup needed beyond `docker compose up -d`.

If a test fails, do **not** edit the test to make it pass. Diagnose the failure: read the trace, identify the missing element or mismatched text in the page, fix the component, rerun.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/home-redesign.spec.ts
git commit -m "test(e2e): cover home page redesign and contact form"
```

---

### Task 18: Final gates

**Files:** none (verification only)

- [ ] **Step 1: Run the merge gate**

Run: `pnpm gates`

Expected: `check-types`, `lint`, `build`, and `test` all pass across the workspace.

If anything fails, diagnose and fix. Do not commit a `--no-verify` bypass.

- [ ] **Step 2: Manual cross-section pass**

Run `pnpm --filter web dev`. Walk the home page at viewport widths 360, 768, 1024, and 1440. Verify:

- Hero collapses to single column below 980px and the workspace preview remains readable.
- Market-fit rows collapse to single column below 880px (no padding-shift on hover).
- Modes grid drops from 2×2 to 1col below 720px.
- Что ещё grid drops 3 → 2 → 1 col at 880 / 560 breakpoints.
- Тарифы grid drops 2×2 → 1col below 700px.
- Контакт form goes full-width below 980px; origami illustration hides below md.
- Final CTA stacks vertically below 880px.
- Footer drops 4-col → 2-col (≤lg) → 1-col (≤sm).

- [ ] **Step 3: Commit (if any fixes were needed)**

If gates needed fixes, commit them with a focused message. If everything passed first try, no commit.

```bash
git status
# if there are changes:
git add -A
git commit -m "fix(public): address gate failures from home redesign"
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Task |
|---|---|
| Visual language (palette, fonts, motif, motion) | Tasks 1, 2, 3 |
| Section 1 Hero | Task 6 |
| Section 2 Market-fit | Task 7 |
| Section 3 Modes | Task 8 |
| Section 4 ИИ-поиск | Task 9 |
| Section 5 Что ещё (new) | Task 10 + content in Task 4 |
| Section 6 Тарифы | Task 11 |
| Section 7 Особое решение (new) | Tasks 5 + 12 |
| Section 8 Final CTA | Task 13 |
| Section 9 Footer (redesigned) | Task 15 |
| Page composer | Task 14 |
| Rebrand pass (header, public pages, mail templates) | Task 16 |
| `homeFeatures`, `publicContact`, restructured `publicFooterSections` | Task 4 |
| ContactForm extension | Task 5 |
| RSC boundaries (Server Components except contact) | Implicit — only `home-contact.tsx` imports a `"use client"` form; the rest are pure RSC |
| Tests (e2e + contact-form unit) | Tasks 5, 17 |
| Final gate | Task 18 |

All sections, all rebrand items, all data-shape changes, and the form extension have a task. No gaps found.

**Placeholder scan:** No "TODO", "TBD", "fill in", or "implement later" inside the task bodies. Code blocks contain real TSX. The font fallback note ("Source Serif 4 if Crimson Pro renders poorly") is informational text in the spec, not a task placeholder — Task 1 commits Crimson Pro deterministically.

**Type consistency:**
- `HomeHero` props: `{ primaryHref, primaryLabel, showSecondary }` — used the same way in Task 14.
- `HomeFinalCta` props: `{ primaryHref, primaryLabel }` — matches Task 14.
- `Origami` props: `{ variant, size, gradient?, rotate?, style?, ariaHidden? }` — consumed identically in Tasks 6, 12, 13, 15.
- `homeTokens.palette` keys (`paper`, `paperDeep`, `ink`, `inkSoft`, `inkMute`, `orange`, `orangeWarm`, `line`) — referenced exactly in every consumer.
- `ContactFormState` keys (`name`, `company`, `email`, `phone`, `message`) — match the test in Task 5 step 1 and the component in step 3.
- `homeFeatures` shape (`icon`, `title`, `body`) — matches the consumer in `home-features.tsx` (Task 10).
- `publicContact` shape (`email`, `phone`, `telegram`) — matches the consumer in `public-footer.tsx` (Task 15).
- `publicFooterSections` shape (`title`, `links: [{ label, href }]`) — matches the consumer in `public-footer.tsx`.

No mismatches found.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-04-30-home-page-claude-redesign.md`.
