'use client'

import {
  Box,
  Button,
  Chip,
  CircularProgress,
  ErrorOutlineIcon,
  GraphicEqIcon,
  OpenInNewIcon,
  Stack,
  Typography,
} from '@repo/ui/components'
import type { MeetingNotesBlockRenderArgs } from '@repo/editor'

import type { MeetingReadResult } from '@repo/trpc'

import { trpc } from '@/trpc/client'

import { formatTimestamp } from './segment-utils'

const STAGE_LABEL: Record<string, string> = {
  UPLOADED: 'Запись загружена, ожидает обработки…',
  TRANSCRIBING: 'Идёт расшифровка записи…',
  SUMMARIZING: 'Готовим резюме и список задач…',
}

function Placeholder({ text }: { readonly text: string }) {
  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="body2" color="text.secondary">
        {text}
      </Typography>
    </Box>
  )
}

/**
 * The apps/web half of the `meetingNotesBlock` Tiptap node — the consumer the
 * editor's injected `renderMeetingBlock` mounts (mirrors `synced-block-embed.tsx`).
 * It runs the access-checked `meeting.getById` and switches on the typed union
 * (spec §6/§7.2) — OBJECT-HIDING: a non-member / blocked user / non-page-viewer
 * gets `no_access` (the query never throws on no-access), NEVER any transcript or
 * summary content the caller can't reach:
 *
 *  - `processing` → a spinner card with the current pipeline stage.
 *  - `ok`         → a compact summary card + «Открыть встречу» (routes to the
 *    MEETING page the artifact owns, via the node's onOpenMeeting → onNavigateToPage).
 *  - `failed`     → an error card.
 *  - `no_access`  → «Нет доступа к встрече».
 *  - `not_found`  → «Встреча удалена или не найдена».
 */
export function MeetingBlockEmbed({
  meetingArtifactId,
  onOpenMeeting,
}: MeetingNotesBlockRenderArgs) {
  const query = trpc.meeting.getById.useQuery(
    { id: meetingArtifactId ?? '' },
    { enabled: Boolean(meetingArtifactId), retry: false },
  )

  // Cast the React-Query payload to the canonical router result type. The tRPC
  // inferred shape trips TS2589 (excessively deep) on discriminated-union
  // narrowing; the explicit type decouples us from that inference (the
  // synced-block-embed precedent).
  const data = query.data as MeetingReadResult | undefined

  if (!meetingArtifactId) {
    return <Placeholder text="Встреча не выбрана" />
  }

  if (query.isPending) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
        <CircularProgress size={20} />
      </Box>
    )
  }

  if (query.isError || !data) {
    // An UNAUTHORIZED error is the anonymous public-share viewer: `getById` is a
    // protectedProcedure, so a logged-out visitor can't read it. Fail CLOSED with
    // an honest message (no retry — retry:false keeps this off the console hot
    // path). Authenticated viewers without access get `no_access` below.
    if (query.error?.data?.code === 'UNAUTHORIZED') {
      return <Placeholder text="Войдите, чтобы увидеть запись встречи" />
    }
    return <Placeholder text="Нет доступа к встрече" />
  }

  if (data.status === 'no_access') {
    return <Placeholder text="Нет доступа к встрече" />
  }

  if (data.status === 'not_found') {
    return <Placeholder text="Встреча удалена или не найдена" />
  }

  if (data.status === 'failed') {
    return (
      <Box sx={{ p: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <ErrorOutlineIcon fontSize="small" color="error" />
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {data.title}
          </Typography>
        </Stack>
        <Typography variant="body2" color="error" sx={{ mt: 0.5 }}>
          {data.error ?? 'Не удалось обработать запись встречи'}
        </Typography>
      </Box>
    )
  }

  if (data.status === 'processing') {
    return (
      <Box sx={{ p: 2 }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <CircularProgress size={18} />
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {data.title}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {STAGE_LABEL[data.stage] ?? 'Обработка записи…'}
            </Typography>
          </Box>
        </Stack>
      </Box>
    )
  }

  // status === 'ok'
  const actionCount = data.actionItems.length
  const summaryPreview = data.summary?.trim() ?? ''

  return (
    <Box sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
        <GraphicEqIcon fontSize="small" color="secondary" />
        <Typography variant="body2" sx={{ fontWeight: 600, flexGrow: 1 }}>
          {data.title}
        </Typography>
        {data.durationMs != null ? (
          <Chip size="small" label={formatTimestamp(data.durationMs)} variant="outlined" />
        ) : null}
      </Stack>

      {summaryPreview ? (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {summaryPreview}
        </Typography>
      ) : (
        <Typography variant="body2" color="text.secondary">
          Резюме пока недоступно
        </Typography>
      )}

      <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 1 }}>
        {actionCount > 0 ? (
          <Typography variant="caption" color="text.secondary">
            Задач: {actionCount}
          </Typography>
        ) : null}
        {data.pageId ? (
          <Button
            size="small"
            startIcon={<OpenInNewIcon fontSize="small" />}
            onClick={() => onOpenMeeting(data.pageId as string)}
          >
            Открыть встречу
          </Button>
        ) : null}
      </Stack>
    </Box>
  )
}
