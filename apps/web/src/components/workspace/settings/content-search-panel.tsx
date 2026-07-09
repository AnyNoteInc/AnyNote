'use client'

import { useState } from 'react'
import NextLink from 'next/link'

import {
  AdapterDateFns,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  DatePicker,
  dateFnsRu,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LocalizationProvider,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { SettingsCard } from './settings-card'
import { formatDateTime, type ChipColor } from './people-labels'

type Props = {
  workspaceId: string
}

type Audience = 'public' | 'external' | 'internal' | 'private'

const AUDIENCE_CHIPS: Record<Audience, { label: string; color: ChipColor }> = {
  public: { label: 'Публичная', color: 'error' },
  external: { label: 'Внешний доступ', color: 'warning' },
  internal: { label: 'Внутренняя', color: 'info' },
  private: { label: 'Приватная', color: 'default' },
}

const COLLECTION_KIND_LABELS: Record<string, string> = {
  TEAM: 'Командный раздел',
  PERSONAL: 'Личный раздел',
  SITE: 'Сайт',
}

/** The submitted filter snapshot — search runs on submit, never per keystroke (every call is audited). */
type SearchParams = {
  query?: string
  creatorId?: string
  createdFrom?: Date
  createdTo?: Date
  audience?: Audience
}

type ConfirmAction = {
  kind: 'unpublish' | 'restrict'
  pageId: string
  title: string
}

function endOfDay(d: Date): Date {
  const e = new Date(d)
  e.setHours(23, 59, 59, 999)
  return e
}

function memberName(u: { firstName: string | null; lastName: string | null; email: string }) {
  return [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email
}

/** «N участников · M гостей · публичная» (spec §6). */
function accessSummaryLabel(s: {
  memberGrantCount: number
  guestCount: number
  publicMode: 'LINK' | 'SITE' | null
}): string {
  const parts = [`${s.memberGrantCount} участников`, `${s.guestCount} гостей`]
  if (s.publicMode) parts.push('публичная')
  return parts.join(' · ')
}

/**
 * «Поиск по содержимому» (8C spec §6) — the OWNER-only audited admin content
 * search. Gated behind the one-time privacy acknowledgment; every query writes
 * a `content_search.performed` audit row (refetches re-audit — correct).
 *
 * Per-row actions are deliberately limited to открыть / снять публикацию /
 * закрыть доступ: revoking individual GUEST grants is the members-settings
 * job («Участники» → «Гости»), not the search table's.
 */
export function ContentSearchPanel({ workspaceId }: Props) {
  const utils = trpc.useUtils()
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null)
  const [actionPending, setActionPending] = useState(false)

  // Form state (live) vs `params` (the submitted snapshot the query runs on).
  const [queryInput, setQueryInput] = useState('')
  const [creatorId, setCreatorId] = useState('')
  const [createdFrom, setCreatedFrom] = useState<Date | null>(null)
  const [createdTo, setCreatedTo] = useState<Date | null>(null)
  const [audience, setAudience] = useState<'' | Audience>('')
  const [params, setParams] = useState<SearchParams | null>(null)

  const policyQ = trpc.security.getPolicy.useQuery({ workspaceId })
  const membersQ = trpc.workspace.listMembers.useQuery({ workspaceId })
  const acknowledge = trpc.security.acknowledgeContentSearch.useMutation({
    onSuccess: () => {
      setError(null)
      void utils.security.getPolicy.invalidate({ workspaceId })
    },
    onError: (e: { message: string }) => setError(e.message),
  })

  const resultsQ = trpc.security.contentSearch.useInfiniteQuery(
    { workspaceId, ...(params ?? {}) },
    {
      enabled: params !== null,
      getNextPageParam: (page) => page.nextCursor ?? undefined,
      // Every fetch is an audited search — never refetch behind the owner's back.
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: false,
    },
  )

  const unpublishSite = trpc.page.share.unpublishSite.useMutation()
  const setAccess = trpc.page.share.setAccess.useMutation()

  const submit = () => {
    const query = queryInput.trim()
    const next: SearchParams = {
      query: query.length > 0 ? query : undefined,
      creatorId: creatorId || undefined,
      createdFrom: createdFrom ?? undefined,
      createdTo: createdTo ? endOfDay(createdTo) : undefined,
      audience: audience || undefined,
    }
    // Same snapshot twice = the same query key — refetch explicitly (re-audits).
    if (params !== null && JSON.stringify(params) === JSON.stringify(next)) {
      void resultsQ.refetch()
    } else {
      setParams(next)
    }
  }

  const runConfirmedAction = async () => {
    if (!confirm) return
    setActionPending(true)
    try {
      if (confirm.kind === 'unpublish') {
        await unpublishSite.mutateAsync({ pageId: confirm.pageId })
      }
      // Both actions close the public link; RESTRICTED never hits the policy
      // gate (closing down is always allowed). linkRole is inert when restricted,
      // but the hardcoded READER overwrites a configured EDITOR link role for
      // future re-opens — the row's accessSummary doesn't carry linkRole, so
      // preserving it would need the share row (deferred). The confirm dialog
      // states the reset honestly instead.
      await setAccess.mutateAsync({
        pageId: confirm.pageId,
        access: 'RESTRICTED',
        linkRole: 'READER',
      })
      setError(null)
      setConfirm(null)
      await utils.security.contentSearch.invalidate()
    } catch (e) {
      setConfirm(null)
      setError(e instanceof Error ? e.message : 'Не удалось выполнить действие')
    } finally {
      setActionPending(false)
    }
  }

  const policy = policyQ.data
  const acknowledged = Boolean(policy?.adminContentSearchAcknowledgedAt)

  const pages = resultsQ.data?.pages ?? []
  const rows = pages.flatMap((page) => page.rows)
  const lastPage = pages.at(-1)
  const mode = lastPage?.mode ?? null

  return (
    <SettingsCard
      title="Поиск по содержимому"
      description="Аудируемый поиск владельца по всем страницам пространства."
    >
      {error ? (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      {policyQ.isPending ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
          <CircularProgress size={20} />
        </Box>
      ) : policyQ.isError ? (
        <Alert severity="error">{policyQ.error.message}</Alert>
      ) : !acknowledged ? (
        // The one-time privacy-warning gate (spec §3.1/§6).
        <Stack spacing={2}>
          <Alert severity="warning">
            Поиск по содержимому откроет вам, как владельцу, содержимое всех страниц пространства —
            включая личные разделы участников. Это подтверждение и каждый поисковый запрос
            фиксируются в журнале действий пространства.
          </Alert>
          <Box>
            <Button
              variant="contained"
              data-testid="security-search-ack"
              loading={acknowledge.isPending}
              onClick={() => acknowledge.mutate({ workspaceId })}
            >
              Подтвердить
            </Button>
          </Box>
        </Stack>
      ) : (
        <Stack spacing={2}>
          {/* ── query + filters; runs only on submit ─────────────────────── */}
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
            <TextField
              size="small"
              fullWidth
              placeholder="Поиск по названию и содержимому (пустой запрос — просмотр по фильтрам)"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
              slotProps={{ htmlInput: { 'data-testid': 'security-search-input' } }}
            />
            <Button onClick={submit} loading={resultsQ.isFetching && !resultsQ.isFetchingNextPage}>
              Найти
            </Button>
          </Stack>

          <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={dateFnsRu}>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <Select
                size="small"
                value={creatorId}
                onChange={(e) => setCreatorId(e.target.value)}
                sx={{ minWidth: 200 }}
              >
                <MenuItem value="">Все авторы</MenuItem>
                {(membersQ.data ?? []).map((m) => (
                  <MenuItem key={m.userId} value={m.userId}>
                    {memberName(m.user)}
                  </MenuItem>
                ))}
              </Select>
              <DatePicker
                label="Создана с"
                value={createdFrom}
                onChange={(d: Date | null) => setCreatedFrom(d)}
                slotProps={{
                  textField: { size: 'small', sx: { width: 180 } },
                  actionBar: { actions: ['clear', 'cancel', 'accept'] },
                }}
              />
              <DatePicker
                label="Создана по"
                value={createdTo}
                onChange={(d: Date | null) => setCreatedTo(d)}
                slotProps={{
                  textField: { size: 'small', sx: { width: 180 } },
                  actionBar: { actions: ['clear', 'cancel', 'accept'] },
                }}
              />
              <Select
                size="small"
                value={audience}
                onChange={(e) => setAudience(e.target.value as '' | Audience)}
                sx={{ minWidth: 180 }}
              >
                <MenuItem value="">Любая аудитория</MenuItem>
                {(Object.keys(AUDIENCE_CHIPS) as Audience[]).map((a) => (
                  <MenuItem key={a} value={a}>
                    {AUDIENCE_CHIPS[a].label}
                  </MenuItem>
                ))}
              </Select>
            </Stack>
          </LocalizationProvider>

          {/* ── results ──────────────────────────────────────────────────── */}
          {params === null ? (
            <Typography variant="body2" color="text.secondary">
              Введите запрос или нажмите «Найти» с фильтрами, чтобы просмотреть страницы.
            </Typography>
          ) : resultsQ.isPending ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
              <CircularProgress size={20} />
            </Box>
          ) : resultsQ.isError ? (
            <Alert severity="error">{resultsQ.error.message}</Alert>
          ) : rows.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Ничего не найдено.
            </Typography>
          ) : (
            <>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Страница</TableCell>
                      <TableCell>Раздел</TableCell>
                      <TableCell>Аудитория</TableCell>
                      <TableCell>Автор</TableCell>
                      <TableCell>Изменил</TableCell>
                      <TableCell>Обновлена</TableCell>
                      <TableCell>Доступ</TableCell>
                      <TableCell align="right" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => {
                      const chip = AUDIENCE_CHIPS[row.audienceState]
                      const title = row.title?.trim() || 'Без названия'
                      return (
                        <TableRow key={row.pageId} data-testid="security-search-row">
                          <TableCell sx={{ maxWidth: 260 }}>
                            <Typography
                              component={NextLink}
                              href={`/pages/${row.pageId}`}
                              target="_blank"
                              variant="body2"
                              noWrap
                              sx={{
                                display: 'block',
                                color: 'primary.main',
                                textDecoration: 'none',
                                '&:hover': { textDecoration: 'underline' },
                              }}
                            >
                              {title}
                            </Typography>
                            {row.excerpt ? (
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                }}
                              >
                                {row.excerpt}
                              </Typography>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            {row.location.collectionTitle ??
                              (row.location.collectionKind
                                ? COLLECTION_KIND_LABELS[row.location.collectionKind]
                                : '—')}
                          </TableCell>
                          <TableCell>
                            <Chip size="small" color={chip.color} label={chip.label} />
                          </TableCell>
                          <TableCell>{row.createdBy?.name ?? '—'}</TableCell>
                          {/* lastEditor is the updatedById approximation — yjs
                              typing bumps updatedAt anonymously, hence «—». */}
                          <TableCell>{row.lastEditor?.name ?? '—'}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>
                            {formatDateTime(row.updatedAt)}
                          </TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>
                            {accessSummaryLabel(row.accessSummary)}
                          </TableCell>
                          <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                            {row.accessSummary.publicMode === 'SITE' ? (
                              <Button
                                size="small"
                                color="error"
                                disabled={actionPending}
                                onClick={() =>
                                  setConfirm({ kind: 'unpublish', pageId: row.pageId, title })
                                }
                              >
                                Снять публикацию
                              </Button>
                            ) : row.accessSummary.publicMode === 'LINK' ? (
                              <Button
                                size="small"
                                color="error"
                                disabled={actionPending}
                                onClick={() =>
                                  setConfirm({ kind: 'restrict', pageId: row.pageId, title })
                                }
                              >
                                Закрыть доступ
                              </Button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </TableContainer>

              {/* The pinned cursor asymmetry: FTS = top-N without a cursor;
                  browse = keyset «Показать ещё». */}
              {mode === 'fts' && lastPage?.hasMore ? (
                <Typography variant="body2" color="text.secondary">
                  Показаны первые {rows.length} результатов — уточните запрос.
                </Typography>
              ) : null}
              {mode === 'browse' && resultsQ.hasNextPage ? (
                <Box>
                  <Button
                    size="small"
                    onClick={() => resultsQ.fetchNextPage()}
                    loading={resultsQ.isFetchingNextPage}
                  >
                    Показать ещё
                  </Button>
                </Box>
              ) : null}
            </>
          )}
        </Stack>
      )}
      {confirm ? (
        <Dialog open onClose={() => setConfirm(null)} maxWidth="xs" fullWidth>
          <DialogTitle>
            {confirm.kind === 'unpublish' ? 'Снять публикацию?' : 'Закрыть доступ?'}
          </DialogTitle>
          <DialogContent>
            <DialogContentText>
              {confirm.kind === 'unpublish'
                ? `Сайт «${confirm.title}» перестанет быть опубликованным, а публичная ссылка будет закрыта. Роль для доступа по ссылке будет сброшена до «Читатель». Точечные доступы участников и гостей сохранятся.`
                : `Публичная ссылка на «${confirm.title}» перестанет открываться. Роль для доступа по ссылке будет сброшена до «Читатель». Точечные доступы участников и гостей сохранятся.`}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirm(null)}>Отмена</Button>
            <Button
              variant="contained"
              color="error"
              loading={actionPending}
              onClick={() => void runConfirmedAction()}
            >
              {confirm.kind === 'unpublish' ? 'Снять публикацию' : 'Закрыть доступ'}
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}
    </SettingsCard>
  )
}
