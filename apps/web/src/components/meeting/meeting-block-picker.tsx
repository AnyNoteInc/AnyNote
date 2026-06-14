'use client'

import { useState } from 'react'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  Typography,
  UploadFileIcon,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { MeetingUploadDialog } from './MeetingUploadDialog'

export type MeetingNotesBlockPick = { meetingArtifactId: string }

const STATUS_LABEL: Record<string, string> = {
  UPLOADED: 'В очереди',
  TRANSCRIBING: 'Расшифровка',
  SUMMARIZING: 'Резюме',
  READY: 'Готово',
  FAILED: 'Ошибка',
}

interface MeetingBlockPickerProps {
  readonly open: boolean
  readonly workspaceId: string
  readonly onCancel: () => void
  readonly onPick: (pick: MeetingNotesBlockPick) => void
}

/**
 * Picker for the `/запись встречи` slash command. Two paths (the synced-block
 * picker mold):
 *  - «Вставить существующую» → `meeting.list` (workspace-scoped, member-gated) →
 *    insert a `meetingNotesBlock` node referencing the chosen artifact id.
 *  - «Загрузить новую запись» → opens the MeetingUploadDialog (Task 5), which on
 *    success NAVIGATES to the fresh MEETING page (so nothing is inserted here; the
 *    picker resolves null). The author can later embed that meeting via this picker.
 */
export function MeetingBlockPicker({
  open,
  workspaceId,
  onCancel,
  onPick,
}: MeetingBlockPickerProps) {
  const listQuery = trpc.meeting.list.useQuery({ workspaceId }, { enabled: open })
  const [uploadOpen, setUploadOpen] = useState(false)

  const meetings = listQuery.data?.meetings ?? []

  return (
    <>
      <Dialog open={open} onClose={onCancel} fullWidth maxWidth="xs">
        <DialogTitle>Запись встречи</DialogTitle>
        <DialogContent dividers>
          <Button
            fullWidth
            variant="outlined"
            startIcon={<UploadFileIcon />}
            onClick={() => setUploadOpen(true)}
            sx={{ mb: 1.5, justifyContent: 'flex-start' }}
          >
            Загрузить новую запись
          </Button>
          <Divider sx={{ mb: 1 }} />
          <Typography variant="caption" color="text.secondary" sx={{ px: 0.5 }}>
            Вставить существующую
          </Typography>
          {listQuery.isPending ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress size={20} />
            </Box>
          ) : meetings.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2, px: 0.5 }}>
              В этом воркспейсе пока нет встреч
            </Typography>
          ) : (
            <List dense disablePadding>
              {meetings.map((meeting) => (
                <ListItemButton
                  key={meeting.id}
                  onClick={() => onPick({ meetingArtifactId: meeting.id })}
                >
                  <ListItemText primary={meeting.title} />
                  <Chip
                    size="small"
                    variant="outlined"
                    label={STATUS_LABEL[meeting.status] ?? meeting.status}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onCancel}>Отмена</Button>
        </DialogActions>
      </Dialog>

      <MeetingUploadDialog
        open={uploadOpen}
        workspaceId={workspaceId}
        onClose={() => {
          // The upload dialog navigates to the new MEETING page on success; either
          // way, close it and resolve the picker as cancelled (no node inserted).
          setUploadOpen(false)
          onCancel()
        }}
      />
    </>
  )
}
