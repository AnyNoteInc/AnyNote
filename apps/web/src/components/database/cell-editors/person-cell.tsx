'use client'

import { useState } from 'react'
import {
  Avatar,
  Box,
  Chip,
  ListItemAvatar,
  Menu,
  MenuItem,
  ListItemText,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { useCellUpdate, useDatabaseWorkspaceId } from './use-optimistic-cell'

interface PersonCellProps {
  readonly pageId: string
  readonly rowId: string
  readonly propertyId: string
  readonly value: unknown
  readonly editable?: boolean
}

interface MemberUser {
  id: string
  firstName: string | null
  lastName: string | null
  email: string
  image: string | null
}

function displayName(user: MemberUser): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
  return full || user.email
}

function initials(user: MemberUser): string {
  const a = user.firstName?.[0] ?? ''
  const b = user.lastName?.[0] ?? ''
  const combined = `${a}${b}`.trim()
  return combined || (user.email[0]?.toUpperCase() ?? '?')
}

/**
 * Person cell. The stored value is a single workspace-member userId. Renders an
 * avatar + name chip; clicking opens a member picker (`workspace.listMembers`).
 * The workspace id is threaded via `useDatabaseWorkspaceId()` context (set by the
 * renderer/embed from `schema.source.workspaceId`).
 */
export function PersonCell({ pageId, rowId, propertyId, value, editable = true }: PersonCellProps) {
  const { commit } = useCellUpdate(pageId)
  const workspaceId = useDatabaseWorkspaceId()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)

  const { data: members } = trpc.workspace.listMembers.useQuery(
    { workspaceId },
    { enabled: Boolean(workspaceId) },
  )

  const selectedId = typeof value === 'string' ? value : null
  const selected = members?.find((m) => m.user.id === selectedId)?.user ?? null

  function pick(userId: string | null) {
    setAnchorEl(null)
    commit(rowId, propertyId, userId)
  }

  const chip = selected ? (
    <Chip
      size="small"
      avatar={
        <Avatar src={selected.image ?? undefined} sx={{ width: 20, height: 20, fontSize: 11 }}>
          {initials(selected)}
        </Avatar>
      }
      label={displayName(selected)}
    />
  ) : (
    <span style={{ color: 'rgba(0,0,0,0.4)', fontSize: 13 }}>—</span>
  )

  if (!editable) {
    return <Box sx={{ display: 'flex', alignItems: 'center' }}>{chip}</Box>
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center' }}>
      <Box
        role="button"
        tabIndex={0}
        onClick={(e) => setAnchorEl(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setAnchorEl(e.currentTarget)
          }
        }}
        sx={{ cursor: 'pointer', display: 'flex', alignItems: 'center', minHeight: 28 }}
      >
        {chip}
      </Box>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        <MenuItem onClick={() => pick(null)} dense>
          <ListItemText primary={<em>Не назначен</em>} />
        </MenuItem>
        {(members ?? []).map((m) => (
          <MenuItem key={m.user.id} onClick={() => pick(m.user.id)} dense selected={m.user.id === selectedId}>
            <ListItemAvatar sx={{ minWidth: 36 }}>
              <Avatar src={m.user.image ?? undefined} sx={{ width: 24, height: 24, fontSize: 12 }}>
                {initials(m.user)}
              </Avatar>
            </ListItemAvatar>
            <ListItemText primary={displayName(m.user)} />
          </MenuItem>
        ))}
      </Menu>
    </Box>
  )
}
