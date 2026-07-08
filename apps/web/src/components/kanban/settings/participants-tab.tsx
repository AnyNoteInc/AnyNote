'use client'

import { useState } from 'react'
import {
  Avatar,
  Box,
  Button,
  DeleteIcon,
  Divider,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import type { BoardData, BoardMember } from '../types'
import { participantInitials, participantName } from '../components/participant-display'

// A workspace member viewed as a participant-like value, so the shared
// name/initials helpers (which prefer the linked user) render it consistently.
function memberAsParticipant(m: BoardMember) {
  return { fullName: '', company: null, user: m.user }
}

interface ParticipantsTabProps {
  readonly pageId: string
  readonly board: BoardData
}

export function ParticipantsTab({ pageId, board }: ParticipantsTabProps) {
  const utils = trpc.useUtils()
  const invalidate = () => utils.kanban.board.getBoard.invalidate({ pageId })
  const create = trpc.kanban.participant.create.useMutation({ onSuccess: invalidate })
  const update = trpc.kanban.participant.update.useMutation({ onSuccess: invalidate })
  const remove = trpc.kanban.participant.delete.useMutation({ onSuccess: invalidate })

  const [fullName, setFullName] = useState('')
  const [company, setCompany] = useState('')

  const guests = board.participants.filter((p) => !p.userId)

  function addGuest() {
    const name = fullName.trim().slice(0, 64)
    if (!name) return
    create.mutate({
      workspaceId: board.workspaceId,
      fullName: name,
      company: company.trim().slice(0, 64) || undefined,
    })
    setFullName('')
    setCompany('')
  }

  function deleteGuest(id: string) {
    const assignedCount = board.tasks.filter((t) =>
      t.assignees.some((a) => a.participantId === id),
    ).length
    const msg =
      assignedCount > 0
        ? `Этот участник назначен на ${assignedCount} задач(и). Удалить и снять назначения?`
        : 'Удалить участника?'
    if (typeof globalThis.confirm === 'function' && !globalThis.confirm(msg)) return
    remove.mutate({ workspaceId: board.workspaceId, id })
  }

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          Участники пространства
        </Typography>
        <Stack spacing={0.5} sx={{ mt: 0.5 }}>
          {board.members.map((m) => (
            <Stack key={m.user.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Avatar src={m.user.image ?? undefined} sx={{ width: 28, height: 28, fontSize: 12 }}>
                {participantInitials(memberAsParticipant(m))}
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {participantName(memberAsParticipant(m))}
                </Typography>
              </Box>
              <Box
                component="span"
                sx={{
                  fontSize: 10,
                  color: 'primary.main',
                  border: 1,
                  borderColor: 'primary.light',
                  borderRadius: 0.5,
                  px: 0.5,
                }}
              >
                в пространстве
              </Box>
            </Stack>
          ))}
        </Stack>
      </Box>

      <Divider />

      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          Внешние участники
        </Typography>
        <Stack spacing={0.5} sx={{ mt: 0.5 }}>
          {guests.map((p) => (
            <GuestRow
              key={p.id}
              name={p.fullName}
              company={p.company}
              initials={participantInitials(p)}
              onSave={(name, comp) =>
                update.mutate({
                  workspaceId: board.workspaceId,
                  id: p.id,
                  fullName: name,
                  company: comp || null,
                })
              }
              onDelete={() => deleteGuest(p.id)}
            />
          ))}
          {guests.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Нет внешних участников
            </Typography>
          ) : null}
        </Stack>
      </Box>

      <Divider />

      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <TextField
          size="small"
          label="ФИО"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          slotProps={{ htmlInput: { maxLength: 64 } }}
        />
        <TextField
          size="small"
          label="Компания"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          slotProps={{ htmlInput: { maxLength: 64 } }}
        />
        <Button variant="contained" onClick={addGuest} disabled={create.isPending}>
          Добавить
        </Button>
      </Stack>
    </Stack>
  )
}

interface GuestRowProps {
  readonly name: string
  readonly company: string | null
  readonly initials: string
  readonly onSave: (name: string, company: string) => void
  readonly onDelete: () => void
}

function GuestRow({ name, company, initials, onSave, onDelete }: GuestRowProps) {
  const [editName, setEditName] = useState(name)
  const [editCompany, setEditCompany] = useState(company ?? '')

  function commit() {
    const trimmed = editName.trim().slice(0, 64)
    if (!trimmed || (trimmed === name && editCompany.trim() === (company ?? ''))) return
    onSave(trimmed, editCompany.trim().slice(0, 64))
  }

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Avatar sx={{ width: 28, height: 28, fontSize: 12 }}>{initials}</Avatar>
      <TextField
        size="small"
        value={editName}
        onChange={(e) => setEditName(e.target.value)}
        onBlur={commit}

        sx={{ flex: 1 }}
        slotProps={{ htmlInput: { maxLength: 64 } }}
      />
      <TextField
        size="small"
        value={editCompany}
        onChange={(e) => setEditCompany(e.target.value)}
        onBlur={commit}

        placeholder="Компания"
        sx={{ flex: 1 }}
        slotProps={{ htmlInput: { maxLength: 64 } }}
      />
      <IconButton size="small" color="error" onClick={onDelete} aria-label="Удалить участника">
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Stack>
  )
}
