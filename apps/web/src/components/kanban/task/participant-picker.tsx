'use client'

import { useMemo, useState } from 'react'
import {
  Avatar,
  Box,
  Button,
  Chip,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

import type { BoardMember, BoardParticipant } from '../types'
import { participantInitials, participantName } from '../components/participant-display'
import { buildCandidates } from './participant-picker-model'

interface ParticipantPickerProps {
  readonly members: BoardMember[]
  readonly participants: BoardParticipant[]
  readonly selectedParticipantIds: string[]
  readonly onAssignParticipant: (participantId: string) => void
  readonly onMirrorMember: (userId: string) => void
  readonly onUnassign: (participantId: string) => void
  readonly onCreateGuest: (input: { fullName: string; company: string | null }) => void
}

export function ParticipantPicker({
  members,
  participants,
  selectedParticipantIds,
  onAssignParticipant,
  onMirrorMember,
  onUnassign,
  onCreateGuest,
}: ParticipantPickerProps) {
  const [query, setQuery] = useState('')
  const [guestName, setGuestName] = useState('')
  const [guestCompany, setGuestCompany] = useState('')
  const [creating, setCreating] = useState(false)

  const selected = useMemo(
    () =>
      selectedParticipantIds
        .map((id) => participants.find((p) => p.id === id))
        .filter((p): p is BoardParticipant => Boolean(p)),
    [selectedParticipantIds, participants],
  )

  const candidates = useMemo(
    () => buildCandidates(members, participants, query),
    [members, participants, query],
  )

  function handleCandidateClick(participantId: string | null, userId: string | null) {
    if (participantId) {
      if (selectedParticipantIds.includes(participantId)) onUnassign(participantId)
      else onAssignParticipant(participantId)
      return
    }
    if (userId) onMirrorMember(userId)
  }

  function submitGuest() {
    const name = guestName.trim().slice(0, 64)
    if (!name) return
    onCreateGuest({ fullName: name, company: guestCompany.trim().slice(0, 64) || null })
    setGuestName('')
    setGuestCompany('')
    setCreating(false)
    setQuery('')
  }

  return (
    <Box sx={{ p: 1.5, minWidth: 300, maxWidth: 340 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, fontWeight: 600 }}>
        Участники
      </Typography>

      {selected.length > 0 ? (
        <Stack direction="row" flexWrap="wrap" useFlexGap sx={{ gap: 0.5, mb: 1 }}>
          {selected.map((p) => (
            <Chip
              key={p.id}
              size="small"
              avatar={<Avatar src={p.user?.image ?? undefined}>{participantInitials(p)}</Avatar>}
              label={participantName(p)}
              onDelete={() => onUnassign(p.id)}
            />
          ))}
        </Stack>
      ) : null}

      <TextField
        size="small"
        fullWidth
        autoFocus
        placeholder="Поиск или новое имя…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        sx={{ mb: 1 }}
      />

      <Stack spacing={0.25} sx={{ maxHeight: 280, overflowY: 'auto' }}>
        {candidates.map((c) => {
          const checked = c.participantId ? selectedParticipantIds.includes(c.participantId) : false
          return (
            <Stack
              key={c.key}
              direction="row"
              alignItems="center"
              spacing={1}
              onClick={() => handleCandidateClick(c.participantId, c.userId)}
              sx={{
                px: 0.5, py: 0.5, borderRadius: 1, cursor: 'pointer',
                bgcolor: checked ? 'action.selected' : 'transparent',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Avatar src={c.image ?? undefined} sx={{ width: 24, height: 24, fontSize: 11 }}>
                {participantInitials(c.initialsSource)}
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {c.label}
                  {c.inWorkspace ? (
                    <Box component="span" sx={{ ml: 0.75, fontSize: 10, color: 'primary.main', border: 1, borderColor: 'primary.light', borderRadius: 0.5, px: 0.5 }}>
                      в пространстве
                    </Box>
                  ) : null}
                </Typography>
                {c.sublabel ? (
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                    {c.sublabel}
                  </Typography>
                ) : null}
              </Box>
            </Stack>
          )
        })}
      </Stack>

      {creating ? (
        <Stack spacing={1} sx={{ mt: 1 }}>
          <TextField
            size="small" fullWidth autoFocus label="ФИО" inputProps={{ maxLength: 64 }}
            value={guestName} onChange={(e) => setGuestName(e.target.value)}
          />
          <TextField
            size="small" fullWidth label="Компания" inputProps={{ maxLength: 64 }}
            value={guestCompany} onChange={(e) => setGuestCompany(e.target.value)}
          />
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="contained" onClick={submitGuest}>Создать</Button>
            <Button size="small" onClick={() => setCreating(false)}>Отмена</Button>
          </Stack>
        </Stack>
      ) : (
        <Box
          onClick={() => { setGuestName(query.trim()); setCreating(true) }}
          sx={{ mt: 1, p: 1, border: '1px dashed', borderColor: 'primary.light', borderRadius: 1, fontSize: 13, color: 'primary.main', cursor: 'pointer' }}
        >
          ＋ Создать гостя{query.trim() ? ` «${query.trim()}»` : ''}…
        </Box>
      )}
    </Box>
  )
}
