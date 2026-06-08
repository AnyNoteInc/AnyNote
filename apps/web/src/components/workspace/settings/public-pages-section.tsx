'use client'

import { useState } from 'react'

import {
  Box,
  Button,
  Chip,
  CircularProgress,
  ContentCopyIcon,
  PublicIcon,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@repo/ui/components'

import { ShareDialog } from '@/components/page/share-dialog'
import { trpc } from '@/trpc/client'

import { SettingsCard } from './settings-card'

type Props = {
  workspaceId: string
}

function formatDate(value: string | Date | null): string {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function WorkspacePublicPagesSection({ workspaceId }: Props) {
  const utils = trpc.useUtils()
  const listQ = trpc.page.share.listManagedPublicPages.useQuery({ workspaceId })
  const unpublish = trpc.page.share.unpublishSite.useMutation({
    onSuccess: () => utils.page.share.listManagedPublicPages.invalidate({ workspaceId }),
  })

  const [settingsPageId, setSettingsPageId] = useState<string | null>(null)
  const [copiedShareId, setCopiedShareId] = useState<string | null>(null)

  async function copyUrl(shareId: string) {
    const url = `${window.location.origin}/s/${shareId}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedShareId(shareId)
      setTimeout(() => setCopiedShareId(null), 1500)
    } catch {
      // Clipboard may be unavailable (non-secure context / permission denied).
    }
  }

  const rows = listQ.data ?? []

  return (
    <SettingsCard
      title="Публичные страницы"
      description="Страницы этого пространства, опубликованные по ссылке или как сайт. Управляйте доступом, копируйте ссылки и снимайте сайты с публикации."
    >
      {listQ.isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
          <CircularProgress />
        </Box>
      ) : rows.length === 0 ? (
        <Stack alignItems="center" spacing={1} sx={{ py: 4, color: 'text.secondary' }}>
          <PublicIcon />
          <Typography variant="body2">Пока нет публичных страниц.</Typography>
        </Stack>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Страница</TableCell>
              <TableCell>Тип</TableCell>
              <TableCell>Срок</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.shareId}>
                <TableCell>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <span>{row.icon ?? '📄'}</span>
                    <Typography variant="body2" noWrap>
                      {row.title ?? 'Без названия'}
                    </Typography>
                  </Stack>
                </TableCell>
                <TableCell>
                  {row.mode === 'SITE' && row.published ? (
                    <Chip label="Сайт" color="success" size="small" />
                  ) : row.access === 'PUBLIC' ? (
                    <Chip label="Ссылка" color="info" size="small" variant="outlined" />
                  ) : (
                    <Chip label="Ограничен" size="small" variant="outlined" />
                  )}
                </TableCell>
                <TableCell>
                  <Typography variant="caption" color="text.secondary">
                    {row.expiresAt ? `до ${formatDate(row.expiresAt)}` : '—'}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                    <Button
                      size="small"
                      startIcon={<ContentCopyIcon sx={{ fontSize: 15 }} />}
                      onClick={() => copyUrl(row.shareId)}
                    >
                      {copiedShareId === row.shareId ? 'Скопировано' : 'Ссылка'}
                    </Button>
                    <Button size="small" onClick={() => setSettingsPageId(row.pageId)}>
                      Настройки
                    </Button>
                    {row.mode === 'SITE' && row.published ? (
                      <Button
                        size="small"
                        color="error"
                        disabled={unpublish.isPending}
                        onClick={() => unpublish.mutate({ pageId: row.pageId })}
                      >
                        Снять
                      </Button>
                    ) : null}
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {settingsPageId ? (
        <ShareDialog
          open
          pageId={settingsPageId}
          onClose={() => {
            setSettingsPageId(null)
            utils.page.share.listManagedPublicPages.invalidate({ workspaceId })
          }}
        />
      ) : null}
    </SettingsCard>
  )
}
