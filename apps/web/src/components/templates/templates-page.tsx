'use client'

import { useState } from 'react'

import Link from 'next/link'

import {
  AddIcon,
  Box,
  Button,
  DeleteIcon,
  EditIcon,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { TemplateMetadataDialog } from './template-metadata-dialog'

type Props = { workspaceId: string }

export function TemplatesPage({ workspaceId }: Props) {
  const utils = trpc.useUtils()
  const list = trpc.template.listByWorkspace.useQuery({ workspaceId })
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<{
    templateId: string
    initialTitle: string
    initialDescription: string | null
    initialIcon: string | null
    initialCategory: string | null
  } | null>(null)

  const deleteMut = trpc.template.delete.useMutation({
    onSuccess: () => {
      utils.template.listByWorkspace.invalidate({ workspaceId }).catch(() => undefined)
      utils.template.search.invalidate().catch(() => undefined)
    },
  })

  const templates = list.data ?? []

  return (
    <Box sx={{ maxWidth: 880, mx: 'auto', p: { xs: 2, md: 4 } }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 3 }}>
        <Typography variant="h5" component="h1">
          Шаблоны
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
          Создать шаблон
        </Button>
      </Stack>

      {list.isLoading ? (
        <Typography color="text.secondary">Загрузка…</Typography>
      ) : templates.length === 0 ? (
        <Typography color="text.secondary">
          Пока нет шаблонов. Создайте первый, чтобы быстро начинать новые страницы.
        </Typography>
      ) : (
        <Stack spacing={1}>
          {templates.map((t) => (
            <Stack
              key={t.id}
              direction="row"
              alignItems="center"
              spacing={1.5}
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                p: 1.5,
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Box sx={{ fontSize: 22, width: 32, textAlign: 'center', flexShrink: 0 }}>
                {t.icon ?? '📄'}
              </Box>
              <Box
                component={Link}
                href={`/workspaces/${workspaceId}/templates/${t.id}`}
                sx={{ flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit' }}
              >
                <Typography variant="body1" noWrap>
                  {t.title}
                </Typography>
                {t.description ? (
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {t.description}
                  </Typography>
                ) : null}
              </Box>
              {t.category ? (
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                  {t.category}
                </Typography>
              ) : null}
              <Tooltip title="Изменить">
                <IconButton
                  size="small"
                  onClick={() =>
                    setEditTarget({
                      templateId: t.id,
                      initialTitle: t.title,
                      initialDescription: t.description,
                      initialIcon: t.icon,
                      initialCategory: t.category,
                    })
                  }
                  aria-label={`Изменить шаблон ${t.title}`}
                >
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Удалить">
                <IconButton
                  size="small"
                  onClick={() => {
                    if (window.confirm(`Удалить шаблон «${t.title}»?`)) {
                      deleteMut.mutate({ templateId: t.id, workspaceId })
                    }
                  }}
                  aria-label={`Удалить шаблон ${t.title}`}
                  sx={{ color: 'error.main' }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          ))}
        </Stack>
      )}

      <TemplateMetadataDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        workspaceId={workspaceId}
        mode={{ kind: 'create' }}
      />
      {editTarget ? (
        <TemplateMetadataDialog
          open
          onClose={() => setEditTarget(null)}
          workspaceId={workspaceId}
          mode={{ kind: 'edit', ...editTarget }}
        />
      ) : null}
    </Box>
  )
}
