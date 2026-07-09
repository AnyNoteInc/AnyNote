'use client'

import { useState } from 'react'

import { useRouter } from 'next/navigation'

import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

/** Joinable-by-domain workspace (identity.domainJoin.listAvailable row). */
export type DomainJoinTarget = {
  workspaceId: string
  name: string
  seatAvailable: boolean
}

// «Once per session-ish»: the list only changes when an OWNER edits allowed
// domains or the user joins — we invalidate explicitly on join, so a long
// staleTime keeps the surface cheap (banner + switcher share the cache entry).
// A plain options object (not a hook wrapper) so the exported symbol carries
// no non-portable inferred tRPC type (TS2742).
export const DOMAIN_JOIN_LIST_QUERY_OPTS = {
  staleTime: 15 * 60 * 1000,
  refetchOnWindowFocus: false,
} as const

/**
 * The persistent domain-join prompt (spec §6): rendered on the protected
 * workspace surface whenever the caller's e-mail domain unlocks workspaces
 * they are not yet a member of. Covers SSO-JIT users too — they land on
 * `(protected)` with a session and no membership, and this banner is their
 * only membership path (no silent joins, packages/auth/src/sso.md).
 */
export function DomainJoinBanner() {
  const q = trpc.identity.domainJoin.listAvailable.useQuery(undefined, DOMAIN_JOIN_LIST_QUERY_OPTS)
  const [dismissed, setDismissed] = useState(false)
  const [target, setTarget] = useState<DomainJoinTarget | null>(null)

  const available = q.data ?? []
  if (dismissed || available.length === 0) return null

  return (
    <>
      <Alert
        severity="info"
        data-testid="domain-join-banner"
        onClose={() => setDismissed(true)}
        sx={{ borderRadius: 0, '& .MuiAlert-message': { flex: 1, minWidth: 0 } }}
      >
        <Stack spacing={0.75}>
          {available.map((workspace) => (
            <Stack
              key={workspace.workspaceId}
              direction="row"

              spacing={1.5}
              sx={{ flexWrap: 'wrap', alignItems: 'center' }}
            >
              <Typography variant="body2" sx={{ minWidth: 0 }}>
                Вам доступно пространство «{workspace.name}» по домену вашей почты.
              </Typography>
              <Button
                size="small"
                data-testid="domain-join-button"
                onClick={() => setTarget(workspace)}
                sx={{ flexShrink: 0 }}
              >
                Присоединиться (платное место)
              </Button>
            </Stack>
          ))}
        </Stack>
      </Alert>
      {target ? <DomainJoinConfirmDialog target={target} onClose={() => setTarget(null)} /> : null}
    </>
  )
}

/**
 * The explicit-join confirm (shared by the banner and the workspace-switcher
 * «По домену» entries): join → setActive → land on the joined workspace.
 * Joining is always a billable EDITOR member seat — never a guest.
 */
export function DomainJoinConfirmDialog({
  target,
  onClose,
}: {
  target: DomainJoinTarget
  onClose: () => void
}) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const [error, setError] = useState<string | null>(null)

  const setActive = trpc.workspace.setActive.useMutation({
    onSuccess: async () => {
      // The sidebar-switcher invalidation set: the active workspace changed.
      await Promise.all([
        utils.page.listByWorkspace.invalidate(),
        utils.page.listFavorites.invalidate(),
        utils.chat.listChats.invalidate(),
        utils.workspace.getActive.invalidate(),
      ])
      onClose()
      router.push('/app')
      router.refresh()
    },
    onError: (e: { message: string }) => setError(e.message),
  })

  const join = trpc.identity.domainJoin.join.useMutation({
    onSuccess: () => {
      void Promise.all([
        utils.identity.domainJoin.listAvailable.invalidate(),
        utils.workspace.listMine.invalidate(),
      ])
      setActive.mutate({ workspaceId: target.workspaceId })
    },
    onError: (e: { message: string }) => setError(e.message),
  })

  const pending = join.isPending || setActive.isPending

  return (
    <Dialog open onClose={pending ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Присоединиться к «{target.name}»?</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          {error ? (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          ) : null}
          <DialogContentText>
            Вы присоединитесь как участник с ролью «Редактор» и займёте платное место в тарифе
            пространства.
          </DialogContentText>
          {!target.seatAvailable ? (
            <Alert severity="warning">
              В пространстве нет свободных мест — попросите владельца расширить тариф.
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={pending}>
          Отмена
        </Button>
        <Button
          variant="contained"
          data-testid="domain-join-confirm"
          loading={pending}
          disabled={!target.seatAvailable}
          onClick={() => {
            setError(null)
            join.mutate({ workspaceId: target.workspaceId })
          }}
        >
          Присоединиться
        </Button>
      </DialogActions>
    </Dialog>
  )
}
