'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ArrowDropDownIcon,
  ArrowDropUpIcon,
  Box,
  GroupIcon,
  Stack,
  Typography,
} from '@repo/ui/components'
import { trpc } from '@/trpc/client'
import { PageIcon } from '@/components/page/page-icon'

type Props = {
  workspaceId: string
}

function SharedRow({ page }: { page: { id: string; title: string | null; icon: string | null } }) {
  const pathname = usePathname()
  const isActive = pathname === `/pages/${page.id}`

  return (
    <Box
      component={Link}
      href={`/pages/${page.id}`}
      sx={{
        display: 'flex',
        alignItems: 'center',
        pr: 0.5,
        pl: 1,
        py: 0.5,
        borderRadius: 0.75,
        textDecoration: 'none',
        color: 'text.secondary',
        bgcolor: isActive ? 'action.selected' : 'transparent',
        '&:hover': { bgcolor: isActive ? 'action.selected' : 'action.hover' },
        fontSize: 13,
      }}
    >
      {page.icon ? (
        <span style={{ marginRight: 8, flexShrink: 0, display: 'inline-flex' }}>
          <PageIcon icon={page.icon} size={14} />
        </span>
      ) : null}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {page.title ?? 'Новая страница'}
      </span>
    </Box>
  )
}

export function SharedPagesSection({ workspaceId }: Props) {
  const [open, setOpen] = useState(true)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const shared = trpc.page.listShared.useQuery({ workspaceId }, { enabled: mounted })
  const sharedPages = shared.data ?? []

  if (shared.isFetched && sharedPages.length === 0) return null

  return (
    <Box>
      <Box
        onClick={() => setOpen((prev) => !prev)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1,
          py: 0.75,
          cursor: 'pointer',
          color: 'text.secondary',
          '&:hover': { color: 'text.primary' },
        }}
      >
        <GroupIcon sx={{ fontSize: 16 }} />
        <Typography
          variant="overline"
          sx={{ color: 'inherit', flex: 1, letterSpacing: '0.06em', lineHeight: 1.4 }}
        >
          ПОДЕЛИЛИСЬ
        </Typography>
        {open ? (
          <ArrowDropUpIcon sx={{ fontSize: 16 }} />
        ) : (
          <ArrowDropDownIcon sx={{ fontSize: 16 }} />
        )}
      </Box>

      {open ? (
        <Stack spacing={0.25} sx={{ maxHeight: 200, overflow: 'auto' }}>
          {sharedPages.map((page) => (
            <SharedRow key={page.id} page={page} />
          ))}
        </Stack>
      ) : null}
    </Box>
  )
}
