'use client'

import { useMemo } from 'react'

import type { MeetingActionItem, MeetingReadResult, MeetingSegment } from '@repo/trpc'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Divider,
  Markdown,
  Stack,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { TranscriptSearchPanel } from './TranscriptSearchPanel'
import { formatTimestamp, segmentDomId } from './segment-utils'

interface Props {
  readonly pageId: string
  readonly editable?: boolean
}

const STAGE_LABELS: Record<string, string> = {
  UPLOADED: 'Запись загружена, ожидает обработки…',
  TRANSCRIBING: 'Расшифровка записи…',
  SUMMARIZING: 'Подготовка резюме и задач…',
}

function CenteredSpinner() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
      <CircularProgress />
    </Box>
  )
}

/**
 * Full-page renderer for a MEETING page. Loads the artifact via
 * `meeting.getByPage` and, while the pipeline is in progress (status
 * `processing`), polls with a `refetchInterval` until it reaches `ok`/`failed`.
 * Renders the typed read union (the synced-block-precedent object-hiding shape):
 * `no_access`/`not_found` → a placeholder; `processing` → a stage banner;
 * `failed` → the sanitized error + a «Повторить» retry (edit-gated); `ok` → the
 * summary (markdown), the action-item checklist, the transcript, and the search.
 */
export function MeetingTranscriptPage({ pageId, editable = true }: Props) {
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.meeting.getByPage.useQuery(
    { pageId },
    {
      retry: false,
      // Poll only while the pipeline is in progress; stop once ok/failed/hidden.
      refetchInterval: (query) =>
        (query.state.data as MeetingReadResult | undefined)?.status === 'processing' ? 3000 : false,
    },
  )

  const retry = trpc.meeting.retry.useMutation({
    onSuccess: () => utils.meeting.getByPage.invalidate({ pageId }),
  })

  if (isLoading || !data) return <CenteredSpinner />

  if (data.status === 'no_access') {
    return <CenteredMessage>У вас нет доступа к этой встрече.</CenteredMessage>
  }
  if (data.status === 'not_found') {
    return <CenteredMessage>Встреча не найдена.</CenteredMessage>
  }

  if (data.status === 'processing') {
    return (
      <Box sx={{ maxWidth: 760, mx: 'auto', width: '100%', p: { xs: 2, sm: 4 } }}>
        <Typography variant="h5" sx={{ mb: 2 }}>
          {data.title}
        </Typography>
        <Stack
          direction="row"
          spacing={2}
          alignItems="center"
          sx={{
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
            p: 3,
            bgcolor: 'background.paper',
          }}
        >
          <CircularProgress size={24} />
          <Typography color="text.secondary">
            {STAGE_LABELS[data.stage] ?? 'Обработка записи…'}
          </Typography>
        </Stack>
      </Box>
    )
  }

  if (data.status === 'failed') {
    return (
      <Box sx={{ maxWidth: 760, mx: 'auto', width: '100%', p: { xs: 2, sm: 4 } }}>
        <Typography variant="h5" sx={{ mb: 2 }}>
          {data.title}
        </Typography>
        <Alert
          severity="error"
          action={
            editable ? (
              <Button
                color="inherit"
                size="small"
                data-testid="meeting-retry"
                disabled={retry.isPending}
                onClick={() => retry.mutate({ id: data.id })}
              >
                Повторить
              </Button>
            ) : undefined
          }
        >
          Не удалось обработать запись{data.error ? `: ${data.error}` : '.'}
        </Alert>
      </Box>
    )
  }

  // status === 'ok'
  return <MeetingReadyView data={data} pageId={pageId} editable={editable} />
}

function CenteredMessage({ children }: { readonly children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
      <Typography color="text.secondary" sx={{ p: 4 }}>
        {children}
      </Typography>
    </Box>
  )
}

function MeetingReadyView({
  data,
  pageId,
  editable,
}: {
  readonly data: Extract<MeetingReadResult, { status: 'ok' }>
  readonly pageId: string
  readonly editable: boolean
}) {
  const utils = trpc.useUtils()
  const canEdit = editable && !data.readOnly

  const toggle = trpc.meeting.toggleActionItem.useMutation({
    onSuccess: () => utils.meeting.getByPage.invalidate({ pageId }),
  })

  const sortedSegments = useMemo<MeetingSegment[]>(
    () => [...data.segments].sort((a, b) => a.idx - b.idx),
    [data.segments],
  )

  return (
    <Box
      sx={{ height: '100%', overflow: 'auto', bgcolor: 'background.paper' }}
      data-testid="meeting-page"
    >
      <Box sx={{ maxWidth: 820, mx: 'auto', width: '100%', p: { xs: 2, sm: 4 } }}>
        <Typography variant="h5" sx={{ mb: 3 }}>
          {data.title}
        </Typography>

        {data.summary ? (
          <Box sx={{ mb: 4 }} data-testid="meeting-summary">
            <Typography variant="overline" color="text.secondary">
              Резюме
            </Typography>
            <Box sx={{ mt: 1 }}>
              <Markdown>{data.summary}</Markdown>
            </Box>
          </Box>
        ) : null}

        {data.actionItems.length > 0 ? (
          <Box sx={{ mb: 4 }} data-testid="meeting-action-items">
            <Typography variant="overline" color="text.secondary">
              Задачи
            </Typography>
            <Stack sx={{ mt: 0.5 }}>
              {data.actionItems.map((item: MeetingActionItem) => (
                <Box key={item.id} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                  <Checkbox
                    size="small"
                    checked={item.done}
                    disabled={!canEdit || toggle.isPending}
                    onChange={(e) => toggle.mutate({ id: item.id, done: e.target.checked })}
                    sx={{ p: 0.5, mt: 0.25 }}
                    inputProps={
                      { 'aria-label': item.text } as React.InputHTMLAttributes<HTMLInputElement>
                    }
                  />
                  <Typography
                    variant="body2"
                    sx={{
                      pt: 0.75,
                      textDecoration: item.done ? 'line-through' : 'none',
                      color: item.done ? 'text.secondary' : 'text.primary',
                    }}
                  >
                    {item.text}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </Box>
        ) : null}

        <Divider sx={{ mb: 2 }} />

        <Typography variant="overline" color="text.secondary">
          Расшифровка
        </Typography>
        <Box sx={{ mt: 1, mb: 2 }}>
          <TranscriptSearchPanel segments={sortedSegments} />
        </Box>

        {sortedSegments.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Расшифровка пуста.
          </Typography>
        ) : (
          <Stack spacing={1.25}>
            {sortedSegments.map((s) => (
              <Box
                key={s.id}
                id={segmentDomId(s.id)}
                sx={{
                  display: 'flex',
                  gap: 1.5,
                  borderRadius: 1,
                  p: 0.5,
                  transition: 'background-color 0.3s',
                  '&.transcript-segment-flash': { bgcolor: 'action.selected' },
                }}
              >
                <Typography
                  variant="caption"
                  sx={{
                    color: 'text.secondary',
                    fontVariantNumeric: 'tabular-nums',
                    pt: 0.25,
                    flexShrink: 0,
                    width: 56,
                  }}
                >
                  {formatTimestamp(s.startMs)}
                </Typography>
                <Box sx={{ minWidth: 0 }}>
                  {s.speaker ? (
                    <Typography variant="caption" sx={{ fontWeight: 600, display: 'block' }}>
                      {s.speaker}
                    </Typography>
                  ) : null}
                  <Typography variant="body2">{s.text}</Typography>
                </Box>
              </Box>
            ))}
          </Stack>
        )}
      </Box>
    </Box>
  )
}
