'use client'

import { useState, type MouseEvent } from 'react'

import {
  CheckIcon,
  ChevronRightIcon,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  NotificationsNoneIcon,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

// String-literal levels matching the Prisma `PageNotificationLevel` enum. We
// keep them as literals (not a runtime `@repo/db` import) so the enum never
// leaks into the client bundle; the wire format is the bare string anyway.
type Level = 'ALL_COMMENTS' | 'REPLIES_AND_MENTIONS' | 'ALL_UPDATES' | 'IMPORTANT_UPDATES'

// REPLIES_AND_MENTIONS is the implicit default — choosing it clears the stored
// preference (absence of a row == replies/mentions only).
const DEFAULT_LEVEL: Level = 'REPLIES_AND_MENTIONS'

type Option = { level: Level; label: string }

const TEXT_OPTIONS: Option[] = [
  { level: 'ALL_COMMENTS', label: 'Все комментарии' },
  { level: 'REPLIES_AND_MENTIONS', label: 'Ответы и упоминания' },
]

const DATABASE_OPTIONS: Option[] = [
  { level: 'ALL_UPDATES', label: 'Все обновления' },
  { level: 'IMPORTANT_UPDATES', label: 'Важные обновления' },
  { level: 'REPLIES_AND_MENTIONS', label: 'Ответы и упоминания' },
]

const menuItemSx = { gap: 1, fontSize: 13 } as const

/**
 * "Уведомлять меня" — a nested submenu in the page actions menu. The trpc reads
 * live in the child `NotifyMeOptions`, mounted only while the submenu is open,
 * so the parent actions menu can render without a tRPC provider (unit tests).
 */
export function NotifyMeMenu({
  pageId,
  pageType,
}: {
  readonly pageId: string
  readonly pageType: 'TEXT' | 'DATABASE'
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const open = Boolean(anchor)

  return (
    <>
      <MenuItem onClick={(e: MouseEvent<HTMLElement>) => setAnchor(e.currentTarget)} sx={menuItemSx}>
        <ListItemIcon>
          <NotificationsNoneIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>Уведомлять меня</ListItemText>
        <ChevronRightIcon fontSize="small" sx={{ color: 'text.secondary' }} />
      </MenuItem>

      <Menu
        anchorEl={anchor}
        open={open}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        {open ? <NotifyMeOptions pageId={pageId} pageType={pageType} /> : null}
      </Menu>
    </>
  )
}

function NotifyMeOptions({
  pageId,
  pageType,
}: {
  readonly pageId: string
  readonly pageType: 'TEXT' | 'DATABASE'
}) {
  const utils = trpc.useUtils()
  const prefQ = trpc.notification.getPageNotificationPreference.useQuery({ pageId })

  const invalidate = () => utils.notification.getPageNotificationPreference.invalidate({ pageId })

  const setPref = trpc.notification.setPageNotificationPreference.useMutation({
    onSuccess: invalidate,
  })
  const clearPref = trpc.notification.clearPageNotificationPreference.useMutation({
    onSuccess: invalidate,
  })

  // No stored row == the implicit replies/mentions default.
  const current: Level = (prefQ.data?.level as Level | null | undefined) ?? DEFAULT_LEVEL
  const options = pageType === 'DATABASE' ? DATABASE_OPTIONS : TEXT_OPTIONS
  const pending = setPref.isPending || clearPref.isPending

  const choose = (level: Level) => {
    if (level === DEFAULT_LEVEL) {
      clearPref.mutate({ pageId })
    } else {
      setPref.mutate({ pageId, level })
    }
  }

  return (
    <>
      {options.map((opt) => (
        <MenuItem
          key={opt.level}
          onClick={() => choose(opt.level)}
          disabled={pending}
          selected={opt.level === current}
          sx={menuItemSx}
        >
          <ListItemIcon>
            {opt.level === current ? <CheckIcon fontSize="small" /> : null}
          </ListItemIcon>
          <ListItemText>{opt.label}</ListItemText>
        </MenuItem>
      ))}
    </>
  )
}
