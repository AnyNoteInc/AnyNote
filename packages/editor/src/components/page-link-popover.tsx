'use client'

import {
  Box,
  CircularProgress,
  List,
  ListItemButton,
  ListItemText,
  Popover,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { Editor } from '@tiptap/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { PageLookupItem, SlashRange, VirtualAnchor } from '../types'

type Props = {
  open: boolean
  anchorEl: VirtualAnchor | null
  range: SlashRange | null
  editor: Editor
  workspaceId: string
  pageSearch: (query: string) => Promise<PageLookupItem[]>
  onClose: () => void
}

const DEBOUNCE_MS = 200

export function PageLinkPopover({
  open,
  anchorEl,
  range,
  editor,
  workspaceId,
  pageSearch,
  onClose,
}: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PageLookupItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const reqIdRef = useRef(0)

  useEffect(() => {
    if (!open) return
    const id = ++reqIdRef.current
    setLoading(true)
    setError(null)
    const handle = setTimeout(() => {
      pageSearch(query)
        .then((items) => {
          if (reqIdRef.current !== id) return
          setResults(items)
          setActive(0)
          setLoading(false)
        })
        .catch(() => {
          if (reqIdRef.current !== id) return
          setError('Ошибка поиска')
          setLoading(false)
        })
    }, DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [open, pageSearch, query])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults([])
      setActive(0)
    }
  }, [open])

  const insertLink = useCallback(
    (item: PageLookupItem) => {
      if (!range) return
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent([
          {
            type: 'pageLink',
            attrs: {
              pageId: item.id,
              workspaceId,
              title: item.title || 'Без названия',
            },
          },
          { type: 'text', text: ' ' },
        ])
        .run()
      onClose()
    },
    [editor, onClose, range, workspaceId],
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (results.length === 0) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActive((i) => (i + 1) % results.length)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActive((i) => (i - 1 + results.length) % results.length)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        const item = results[active]
        if (item) insertLink(item)
      }
    },
    [active, insertLink, results],
  )

  const content = useMemo(() => {
    if (loading) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress size={20} />
        </Box>
      )
    }
    if (error) {
      return (
        <Typography variant="body2" color="error" sx={{ px: 2, py: 1.5 }}>
          {error}
        </Typography>
      )
    }
    if (results.length === 0) {
      return (
        <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1.5 }}>
          Ничего не найдено
        </Typography>
      )
    }
    return (
      <List dense disablePadding sx={{ maxHeight: 280, overflow: 'auto' }}>
        {results.map((item, idx) => (
          <ListItemButton
            key={item.id}
            selected={idx === active}
            onClick={() => insertLink(item)}
            sx={{ gap: 1 }}
          >
            <Box
              component="span"
              sx={{
                width: 18,
                textAlign: 'center',
                color: 'text.secondary',
                fontSize: 14,
              }}
            >
              {item.icon || '📄'}
            </Box>
            <ListItemText primary={item.title || 'Без названия'} />
          </ListItemButton>
        ))}
      </List>
    )
  }, [active, error, insertLink, loading, results])

  return (
    <Popover
      open={open}
      anchorEl={anchorEl as Element | null}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{ paper: { sx: { width: 340 } } }}
    >
      <Stack>
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}>
          <TextField
            autoFocus
            size="small"
            fullWidth
            placeholder="Найти страницу..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </Box>
        {content}
      </Stack>
    </Popover>
  )
}
