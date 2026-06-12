'use client'

import { Box, IconButton, RestoreIcon, Stack, Tooltip, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'
import { PageIcon } from '@/components/page/page-icon'

export function ArchivePageBody({ workspaceId }: { workspaceId: string }) {
  const utils = trpc.useUtils()
  const archived = trpc.page.listArchived.useQuery({ workspaceId })

  const unarchive = trpc.page.unarchive.useMutation({
    onSuccess: async () => {
      await utils.page.listArchived.invalidate({ workspaceId })
      await utils.page.listByWorkspace.invalidate({ workspaceId })
    },
  })

  return (
    <Box sx={{ p: 4, maxWidth: 710, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" sx={{ flex: 1 }}>
          Архив
        </Typography>
      </Box>

      {archived.data?.length === 0 && <Typography color="text.secondary">Архив пуст</Typography>}

      <Stack spacing={0.5}>
        {archived.data?.map((page) => (
          <Box
            key={page.id}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              px: 2,
              py: 1,
              borderRadius: 1,
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <PageIcon icon={page.icon} size={16} fallback="📄" />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {page.title ?? 'Без названия'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Архивировано{' '}
                {page.archivedAt ? new Date(page.archivedAt).toLocaleDateString('ru-RU') : ''}
              </Typography>
            </Box>
            <Tooltip title="Восстановить">
              <IconButton
                size="small"
                onClick={() => unarchive.mutate({ id: page.id, workspaceId })}
                disabled={unarchive.isPending}
              >
                <RestoreIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          </Box>
        ))}
      </Stack>
    </Box>
  )
}
