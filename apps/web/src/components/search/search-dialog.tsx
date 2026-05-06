'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import {
  Box,
  Chip,
  CircularProgress,
  CloseIcon,
  DescriptionIcon,
  Dialog,
  HistoryIcon,
  IconButton,
  InputBase,
  LinearProgress,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  SearchIcon,
  Stack,
  StarBorderIcon,
  StarIcon,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { HighlightMatches } from './highlight-matches'
import { useSearchDialogEscapeGuard } from './use-search-dialog-escape-guard'

const DEBOUNCE_MS = 250
const MIN_QUERY = 2
const MAX_QUERY = 200

type HistoryItem = {
  pageId: string
  title: string
  icon: string | null
  isFavorite: boolean
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timeout)
  }, [delayMs, value])

  return debounced
}

export function SearchDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: string
  onClose: () => void
}) {
  const router = useRouter()
  const [rawQuery, setRawQuery] = useState('')
  const trimmed = rawQuery.trim().slice(0, MAX_QUERY)
  const debounced = useDebouncedValue(trimmed, DEBOUNCE_MS)
  const utils = trpc.useUtils()
  useSearchDialogEscapeGuard(onClose)

  const searchQuery = trpc.search.search.useQuery(
    { workspaceId, query: debounced },
    { enabled: debounced.length >= MIN_QUERY, staleTime: 0 },
  )
  const historyQuery = trpc.search.history.list.useQuery(
    { workspaceId },
    { enabled: trimmed.length === 0 },
  )

  const invalidateHistory = useCallback(() => {
    void utils.search.history.list.invalidate({ workspaceId })
    void utils.page.listFavorites.invalidate({ workspaceId })
  }, [utils, workspaceId])

  const addToHistory = trpc.search.history.add.useMutation({ onSuccess: invalidateHistory })
  const removeFromHistory = trpc.search.history.remove.useMutation({ onSuccess: invalidateHistory })
  const addFavorite = trpc.page.addFavorite.useMutation({ onSuccess: invalidateHistory })
  const removeFavorite = trpc.page.removeFavorite.useMutation({ onSuccess: invalidateHistory })

  const isShowingResults = trimmed.length >= MIN_QUERY
  const showLoading = isShowingResults && searchQuery.isFetching
  const results = searchQuery.data ?? []

  function navigateToPage(pageId: string, blockNumber: number | null) {
    void addToHistory.mutateAsync({ workspaceId, pageId }).catch(() => undefined)
    onClose()
    const hash = blockNumber !== null ? `#${blockNumber}` : ''
    window.setTimeout(() => router.push(`/workspaces/${workspaceId}/pages/${pageId}${hash}`), 0)
    if (hash) {
      for (const delay of [250, 750, 1500, 2500]) {
        window.setTimeout(() => window.dispatchEvent(new HashChangeEvent('hashchange')), delay)
      }
    }
  }

  function renderBody() {
    if (!isShowingResults) {
      return (
        <EmptyState
          isLoading={historyQuery.isLoading}
          items={historyQuery.data ?? []}
          onPick={(item) => navigateToPage(item.pageId, null)}
          onRemove={(pageId) => removeFromHistory.mutate({ workspaceId, pageId })}
          onToggleFavorite={(pageId, isFavorite) =>
            isFavorite ? removeFavorite.mutate({ pageId }) : addFavorite.mutate({ pageId })
          }
        />
      )
    }
    if (searchQuery.isError) {
      return (
        <Box sx={{ p: 3 }}>
          <Typography variant="body2" color="error">
            Не удалось выполнить поиск
          </Typography>
        </Box>
      )
    }
    if (results.length === 0 && !searchQuery.isFetching) {
      return (
        <Box sx={{ p: 3 }}>
          <Typography variant="body2" color="text.secondary">
            Ничего не найдено по запросу «{trimmed}»
          </Typography>
        </Box>
      )
    }
    return (
      <List dense role="listbox" aria-label="Результаты поиска">
        {results.map((item) => (
          <ListItemButton
            key={`${item.pageId}-${item.blockNumber ?? 'title'}`}
            role="option"
            onClick={() => navigateToPage(item.pageId, item.blockNumber)}
            sx={{ alignItems: 'flex-start', gap: 1 }}
          >
            <ListItemIcon sx={{ minWidth: 28, pt: 0.5 }}>
              {item.icon ? (
                <Typography component="span" sx={{ fontSize: 16, lineHeight: 1 }}>
                  {item.icon}
                </Typography>
              ) : (
                <DescriptionIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              )}
            </ListItemIcon>
            <ListItemText
              primary={item.title || 'Без названия'}
              primaryTypographyProps={{ noWrap: true }}
              secondary={
                item.blockNumber !== null && item.excerpt ? (
                  <Box component="span" sx={{ display: 'block' }}>
                    Блок {item.blockNumber + 1}:{' '}
                    <HighlightMatches text={item.excerpt} query={trimmed} />
                  </Box>
                ) : null
              }
            />
          </ListItemButton>
        ))}
      </List>
    )
  }

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      keepMounted={false}
      sx={{
        '& .MuiDialog-container': {
          alignItems: 'flex-start',
        },
        '& .MuiDialog-paper': {
          mt: '10vh',
        },
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1.25 }}>
        <SearchIcon fontSize="small" color="action" />
        <InputBase
          autoFocus
          fullWidth
          placeholder="Поиск по страницам"
          value={rawQuery}
          onChange={(event) => setRawQuery(event.target.value.slice(0, MAX_QUERY))}
          inputProps={{ 'aria-label': 'Поиск по страницам', maxLength: MAX_QUERY }}
        />
        <Chip
          label="Esc"
          size="small"
          onClick={onClose}
          variant="outlined"
          sx={{ cursor: 'pointer' }}
        />
      </Stack>

      {showLoading && <LinearProgress />}

      <Box sx={{ minHeight: 200, maxHeight: 480, overflowY: 'auto' }}>{renderBody()}</Box>
    </Dialog>
  )
}

function EmptyState({
  isLoading,
  items,
  onPick,
  onRemove,
  onToggleFavorite,
}: {
  isLoading: boolean
  items: HistoryItem[]
  onPick: (item: HistoryItem) => void
  onRemove: (pageId: string) => void
  onToggleFavorite: (pageId: string, isFavorite: boolean) => void
}) {
  if (isLoading) {
    return (
      <Box sx={{ p: 3, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress size={20} />
      </Box>
    )
  }

  if (items.length === 0) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="body2" color="text.secondary">
          Здесь появятся страницы, по которым вы перейдёте из поиска
        </Typography>
      </Box>
    )
  }

  return (
    <>
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ display: 'block', px: 2, pt: 1.5 }}
      >
        Ранее искали
      </Typography>
      <List dense>
        {items.map((item) => (
          <ListItemButton key={item.pageId} onClick={() => onPick(item)} sx={{ pr: 1 }}>
            <ListItemIcon sx={{ minWidth: 32 }}>
              <HistoryIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary={item.title || 'Без названия'}
              primaryTypographyProps={{ noWrap: true }}
            />
            <IconButton
              size="small"
              edge="end"
              aria-label={item.isFavorite ? 'Убрать из избранного' : 'Добавить в избранное'}
              onClick={(event) => {
                event.stopPropagation()
                onToggleFavorite(item.pageId, item.isFavorite)
              }}
            >
              {item.isFavorite ? (
                <StarIcon fontSize="small" color="warning" />
              ) : (
                <StarBorderIcon fontSize="small" />
              )}
            </IconButton>
            <IconButton
              size="small"
              edge="end"
              aria-label="Удалить из истории"
              onClick={(event) => {
                event.stopPropagation()
                onRemove(item.pageId)
              }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </ListItemButton>
        ))}
      </List>
    </>
  )
}
