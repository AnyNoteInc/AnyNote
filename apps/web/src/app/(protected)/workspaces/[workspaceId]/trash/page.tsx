"use client"

import { use, useState } from "react"

import {
  Box,
  Button,
  DeleteForeverIcon,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  RestoreIcon,
  Stack,
  Tooltip,
  Typography,
} from "@repo/ui/components"

import { trpc } from "@/trpc/client"

type Props = {
  params: Promise<{ workspaceId: string }>
}

export default function TrashPage({ params }: Props) {
  const { workspaceId } = use(params)
  const utils = trpc.useUtils()
  const trashed = trpc.page.listTrashed.useQuery({ workspaceId })

  const restore = trpc.page.restore.useMutation({
    onSuccess: async () => {
      await utils.page.listTrashed.invalidate({ workspaceId })
      await utils.page.listByWorkspace.invalidate({ workspaceId })
    },
  })

  const hardDelete = trpc.page.hardDelete.useMutation({
    onSuccess: async () => {
      await utils.page.listTrashed.invalidate({ workspaceId })
    },
  })

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const confirmPage = trashed.data?.find((p) => p.id === confirmDeleteId)

  return (
    <Box sx={{ p: 4, maxWidth: 710, mx: "auto" }}>
      <Typography variant="h5" sx={{ mb: 3 }}>
        Корзина
      </Typography>

      {trashed.data?.length === 0 && (
        <Typography color="text.secondary">Корзина пуста</Typography>
      )}

      <Stack spacing={0.5}>
        {trashed.data?.map((page) => (
          <Box
            key={page.id}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              px: 2,
              py: 1,
              borderRadius: 1,
              "&:hover": { bgcolor: "action.hover" },
            }}
          >
            <span style={{ fontSize: 16 }}>{page.icon ?? "📄"}</span>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {page.title ?? "Без названия"}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Удалено{" "}
                {page.deletedAt ? new Date(page.deletedAt).toLocaleDateString("ru-RU") : ""}
              </Typography>
            </Box>
            <Tooltip title="Восстановить">
              <IconButton
                size="small"
                onClick={() => restore.mutate({ id: page.id, workspaceId })}
                disabled={restore.isPending}
              >
                <RestoreIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Удалить навсегда">
              <IconButton
                size="small"
                onClick={() => setConfirmDeleteId(page.id)}
                sx={{ color: "error.main" }}
              >
                <DeleteForeverIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          </Box>
        ))}
      </Stack>

      <Dialog
        open={Boolean(confirmDeleteId)}
        onClose={() => setConfirmDeleteId(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Удалить навсегда?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Страница «{confirmPage?.title ?? "Без названия"}» будет удалена безвозвратно.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setConfirmDeleteId(null)}>
            Отмена
          </Button>
          <Button
            onClick={() => {
              if (confirmDeleteId) {
                hardDelete.mutate({ id: confirmDeleteId, workspaceId })
                setConfirmDeleteId(null)
              }
            }}
            disabled={hardDelete.isPending}
          >
            Удалить навсегда
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
