'use client'

import { Chip, Stack } from '@repo/ui/components'

/** A date as it may arrive from the share view-model: ISO string (over the
 *  wire, no superjson transformer) or a `Date` (server-side / tests). */
type ShareDate = string | Date | null

/** The subset of the `page.share.get` view-model the chip row needs. Pure
 *  presentational — no queries, no mutations. */
export type ShareChipModel = {
  access: 'RESTRICTED' | 'PUBLIC'
  mode: 'LINK' | 'SITE'
  expiresAt: ShareDate
  publishedAt: ShareDate
  unpublishedAt: ShareDate
  allowIndexing: boolean
  allowCopy: boolean
  publishSubpages: boolean
  hasPassword: boolean
  exposesAt: ShareDate
}

function toDate(value: ShareDate): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatDate(value: ShareDate): string {
  const d = toDate(value)
  if (!d) return ''
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** A published site = has a publishedAt that is not superseded by a later
 *  unpublishedAt (mirrors the resolver's "is published" rule). */
function isPublished(share: ShareChipModel): boolean {
  const published = toDate(share.publishedAt)
  if (!published) return false
  const unpublished = toDate(share.unpublishedAt)
  return !unpublished || unpublished.getTime() < published.getTime()
}

type ChipSpec = {
  key: string
  label: string
  color: 'default' | 'success' | 'warning' | 'info'
  variant?: 'filled' | 'outlined'
}

export function ShareStatusChips({ share }: { share: ShareChipModel }) {
  const chips: ChipSpec[] = []

  // --- Link surface (both modes can carry a public link). ---
  if (share.access === 'PUBLIC') {
    chips.push({ key: 'link', label: 'Ссылка включена', color: 'success' })
    if (share.expiresAt) {
      chips.push({
        key: 'expires',
        label: `Срок действия ссылки до ${formatDate(share.expiresAt)}`,
        color: 'warning',
        variant: 'outlined',
      })
    }
  }

  // --- Site surface (only meaningful for a published SITE). ---
  if (share.mode === 'SITE' && isPublished(share)) {
    chips.push({ key: 'published', label: 'Сайт опубликован', color: 'success' })
    chips.push({
      key: 'indexing',
      label: share.allowIndexing ? 'Индексация включена' : 'Индексация выключена',
      color: share.allowIndexing ? 'info' : 'default',
      variant: 'outlined',
    })
    if (share.allowCopy) {
      chips.push({
        key: 'copy',
        label: 'Копирование разрешено',
        color: 'info',
        variant: 'outlined',
      })
    }
    if (share.publishSubpages) {
      chips.push({
        key: 'subpages',
        label: 'Подстраницы публикуются',
        color: 'default',
        variant: 'outlined',
      })
    }
  }

  // --- AnyNote extensions (apply on the publish surface). ---
  if (share.mode === 'SITE') {
    if (share.hasPassword) {
      chips.push({
        key: 'password',
        label: 'Защищено паролем',
        color: 'warning',
        variant: 'outlined',
      })
    }
    if (share.exposesAt && toDate(share.exposesAt)) {
      chips.push({
        key: 'scheduled',
        label: `Запланировано на ${formatDate(share.exposesAt)}`,
        color: 'warning',
        variant: 'outlined',
      })
    }
  }

  if (chips.length === 0) return null

  return (
    <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
      {chips.map((c) => (
        <Chip
          key={c.key}
          label={c.label}
          color={c.color}
          size="small"
          variant={c.variant ?? 'filled'}
        />
      ))}
    </Stack>
  )
}
