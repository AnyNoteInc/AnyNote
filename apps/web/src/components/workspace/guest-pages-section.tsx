'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { Box, GroupIcon, Stack, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

type GrantedPage = { id: string; title: string | null; icon: string | null; role: string }

function GuestPageRow({ page }: { page: GrantedPage }) {
  const pathname = usePathname()
  const isActive = pathname === `/pages/${page.id}`

  return (
    <Box
      component={Link}
      href={`/pages/${page.id}`}
      data-testid="guest-page-row"
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
        <span style={{ fontSize: 14, marginRight: 8, flexShrink: 0 }}>{page.icon}</span>
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

/**
 * The ONLY sidebar section a guest sees (people spec §5): a flat list of the
 * pages explicitly shared with them in this workspace. Children of a granted
 * page are reachable by navigating into it, not listed here.
 */
export function GuestPagesSection({ workspaceId }: { workspaceId: string }) {
  const granted = trpc.people.myGrantedPages.useQuery({ workspaceId })
  const grantedPages = granted.data ?? []

  return (
    <Box data-testid="guest-pages-section">
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1,
          py: 0.75,
          color: 'text.secondary',
        }}
      >
        <GroupIcon sx={{ fontSize: 16 }} />
        <Typography
          variant="overline"
          sx={{ color: 'inherit', flex: 1, letterSpacing: '0.06em', lineHeight: 1.4 }}
        >
          ДОСТУПНЫЕ МНЕ
        </Typography>
      </Box>
      {granted.isFetched && grantedPages.length === 0 ? (
        <Typography variant="caption" color="text.disabled" sx={{ px: 1 }}>
          Вам пока не открыли доступ ни к одной странице
        </Typography>
      ) : (
        <Stack spacing={0.25} sx={{ overflow: 'auto' }}>
          {grantedPages.map((page) => (
            <GuestPageRow key={page.id} page={page} />
          ))}
        </Stack>
      )}
    </Box>
  )
}
