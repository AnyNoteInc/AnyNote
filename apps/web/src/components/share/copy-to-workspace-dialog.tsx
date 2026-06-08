'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import {
  Alert,
  Box,
  Button,
  ContentCopyIcon,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

type Props = {
  shareId: string
  // The currently-viewed page (share root or a published subpage). The copy is
  // rooted here, so a deep-linked subpage copies that subtree.
  pageId: string
  // Whether the viewer is authenticated; anonymous visitors are sent to
  // sign-in with a return URL instead of opening the dialog.
  isAuthed: boolean
  // The path to return to after sign-in (root or nested share URL).
  returnUrl: string
  // Password from the public route's gate (?pw=), threaded so copying a
  // password-protected site works after the visitor has unlocked it.
  password?: string
}

/**
 * Duplicate-as-template entry point. Only rendered when the share permits
 * copying (`allowCopy`). Anonymous → sign-in. Authenticated → a dialog choosing
 * the destination workspace + collection, then `copyToWorkspace`, then navigate
 * to the new page.
 */
export function CopyToWorkspaceButton({ shareId, pageId, isAuthed, returnUrl, password }: Props) {
  const [open, setOpen] = useState(false)

  if (!isAuthed) {
    return (
      <Button
        size="small"
        startIcon={<ContentCopyIcon sx={{ fontSize: 16 }} />}
        href={`/sign-in?redirect=${encodeURIComponent(returnUrl)}`}
      >
        Сохранить себе
      </Button>
    )
  }

  return (
    <>
      <Button
        size="small"
        startIcon={<ContentCopyIcon sx={{ fontSize: 16 }} />}
        onClick={() => setOpen(true)}
      >
        Сохранить себе
      </Button>
      {open ? (
        <CopyDialog
          shareId={shareId}
          pageId={pageId}
          password={password}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}

function CopyDialog({
  shareId,
  pageId,
  password,
  onClose,
}: {
  shareId: string
  pageId: string
  password?: string
  onClose: () => void
}) {
  const router = useRouter()
  const workspaces = trpc.workspace.listMine.useQuery()
  const [workspaceId, setWorkspaceId] = useState('')
  const [collectionId, setCollectionId] = useState('')
  const [includeSubtree, setIncludeSubtree] = useState(true)

  // Default the workspace to the first membership once loaded.
  useEffect(() => {
    if (!workspaceId && workspaces.data && workspaces.data.length > 0) {
      setWorkspaceId(workspaces.data[0]!.id)
    }
  }, [workspaces.data, workspaceId])

  const collections = trpc.collection.list.useQuery(
    { workspaceId },
    { enabled: Boolean(workspaceId) },
  )

  // Default the collection to the caller's PERSONAL collection (or leave blank
  // so the server defaults it). Reset when the workspace changes.
  const personalId = useMemo(
    () => collections.data?.find((c) => c.kind === 'PERSONAL')?.id ?? '',
    [collections.data],
  )
  useEffect(() => {
    setCollectionId(personalId)
  }, [personalId])

  const copy = trpc.page.share.copyToWorkspace.useMutation({
    onSuccess: (res) => {
      router.push(`/pages/${res.pageId}`)
    },
  })

  function submit() {
    if (!workspaceId) return
    copy.mutate({
      shareId,
      rootPageId: pageId,
      targetWorkspaceId: workspaceId,
      targetCollectionId: collectionId || undefined,
      includeSubtree,
      password,
    })
  }

  return (
    <Dialog open onClose={copy.isPending ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Сохранить в пространство</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Создаст вашу копию этой страницы в выбранном пространстве. Оригинал останется без
            изменений.
          </Typography>

          {copy.error ? <Alert severity="error">{copy.error.message}</Alert> : null}

          <FormControl size="small" fullWidth>
            <InputLabel id="copy-workspace-label">Пространство</InputLabel>
            <Select
              labelId="copy-workspace-label"
              label="Пространство"
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
            >
              {(workspaces.data ?? []).map((ws) => (
                <MenuItem key={ws.id} value={ws.id}>
                  {ws.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" fullWidth disabled={!workspaceId || collections.isLoading}>
            <InputLabel id="copy-collection-label">Коллекция</InputLabel>
            <Select
              labelId="copy-collection-label"
              label="Коллекция"
              value={collectionId}
              onChange={(e) => setCollectionId(e.target.value)}
            >
              {(collections.data ?? []).map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.title || (c.kind === 'PERSONAL' ? 'Личное' : 'Без названия')}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControlLabel
            control={
              <Switch
                checked={includeSubtree}
                onChange={(e) => setIncludeSubtree(e.target.checked)}
              />
            }
            label="Включить подстраницы"
          />
        </Stack>
        <Box sx={{ height: 4 }} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={copy.isPending}>
          Отмена
        </Button>
        <Button variant="contained" onClick={submit} disabled={!workspaceId || copy.isPending}>
          {copy.isPending ? 'Сохранение…' : 'Сохранить'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
