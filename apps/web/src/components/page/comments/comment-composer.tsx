'use client'

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

import { Avatar, Box, Button, Paper, Stack, TextField, Typography } from '@repo/ui/components'

export type CommentMentionItem = { id: string; label: string; email: string | null }
type CommentMentionSearch = (query: string) => Promise<CommentMentionItem[]>

const CommentMentionSearchContext = createContext<CommentMentionSearch | null>(null)

export function CommentMentionSearchProvider({
  value,
  children,
}: {
  value: CommentMentionSearch | null
  children: ReactNode
}) {
  return (
    <CommentMentionSearchContext.Provider value={value}>
      {children}
    </CommentMentionSearchContext.Provider>
  )
}

type Props = {
  onSubmit: (c: { text: string; mentions: string[] }) => void
  autoFocus?: boolean
  pending?: boolean
  mentionSearch?: CommentMentionSearch
}

const TOKEN_RE = /@([^\s@]*)$/

export function CommentComposer({ onSubmit, autoFocus, pending, mentionSearch }: Props) {
  const contextMentionSearch = useContext(CommentMentionSearchContext)
  const resolvedMentionSearch = mentionSearch ?? contextMentionSearch
  const [text, setText] = useState('')
  const [mentions, setMentions] = useState<string[]>([])
  const [results, setResults] = useState<CommentMentionItem[]>([])
  const [mentionRange, setMentionRange] = useState<{ from: number; to: number } | null>(null)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const requestIdRef = useRef(0)

  const updateMentionToken = useCallback(
    (value: string, caret: number | null) => {
      const beforeCaret = value.slice(0, caret ?? value.length)
      const match = TOKEN_RE.exec(beforeCaret)

      if (!match || !resolvedMentionSearch) {
        requestIdRef.current += 1
        setMentionRange(null)
        setResults([])
        return
      }

      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      setMentionRange({ from: beforeCaret.length - match[0].length, to: beforeCaret.length })
      void resolvedMentionSearch(match[1] ?? '')
        .then((items) => {
          if (requestIdRef.current === requestId) setResults(items)
        })
        .catch(() => {
          if (requestIdRef.current === requestId) setResults([])
        })
    },
    [resolvedMentionSearch],
  )

  const handleChange = (value: string, caret: number | null) => {
    setText(value)
    updateMentionToken(value, caret)
  }

  const refreshTokenFromInput = () => {
    const input = inputRef.current
    if (text && input) updateMentionToken(input.value, input.selectionStart)
  }

  const pick = (item: CommentMentionItem) => {
    if (!mentionRange) return
    const nextText = `${text.slice(0, mentionRange.from)}@${item.label} ${text.slice(mentionRange.to)}`
    setText(nextText)
    setMentions((prev) => (prev.includes(item.id) ? prev : [...prev, item.id]))
    requestIdRef.current += 1
    setMentionRange(null)
    setResults([])
  }

  const reset = () => {
    setText('')
    setMentions([])
    requestIdRef.current += 1
    setMentionRange(null)
    setResults([])
  }

  const submit = () => {
    if (pending) return
    const t = text.trim()
    if (!t) return
    onSubmit({ text: t, mentions })
    reset()
  }

  return (
    <Box sx={{ position: 'relative' }}>
      <Stack direction="row" spacing={1} alignItems="flex-end">
        <TextField
          fullWidth
          size="small"
          multiline
          maxRows={6}
          placeholder="Комментарий…"
          value={text}
          autoFocus={autoFocus}
          inputRef={inputRef}
          onChange={(e) => handleChange(e.target.value, e.target.selectionStart)}
          onClick={refreshTokenFromInput}
          onKeyUp={refreshTokenFromInput}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
        />
        <Button
          variant="contained"
          size="small"
          onClick={submit}
          disabled={pending || !text.trim()}
        >
          Отпр.
        </Button>
      </Stack>
      {mentionRange && results.length > 0 && (
        <Paper
          sx={{
            position: 'absolute',
            zIndex: 20,
            left: 0,
            right: 56,
            mt: 0.5,
            maxHeight: 200,
            overflow: 'auto',
          }}
        >
          {results.map((r) => (
            <Box
              key={r.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(r)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1.5,
                py: 0.75,
                cursor: 'pointer',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Avatar sx={{ width: 22, height: 22, fontSize: 11 }}>
                {r.label[0]?.toUpperCase() ?? '?'}
              </Avatar>
              <Typography variant="body2" noWrap>
                {r.label}
              </Typography>
            </Box>
          ))}
        </Paper>
      )}
    </Box>
  )
}
