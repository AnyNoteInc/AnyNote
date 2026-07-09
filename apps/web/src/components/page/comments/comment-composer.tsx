'use client'

import {
  createContext,
  useCallback,
  useContext,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import {
  Avatar,
  Box,
  IconButton,
  Paper,
  SendRoundedIcon,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@repo/ui/components'

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

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const selectedMentionIdsInText = (text: string, mentions: CommentMentionItem[]) => {
  const seen = new Set<string>()

  return mentions
    .filter((mention) => {
      if (seen.has(mention.id)) return false
      const token = new RegExp(`(^|\\s)@${escapeRegExp(mention.label)}(?=$|\\s|[.,!?;:)\\]])`)
      const isVisible = token.test(text)
      if (isVisible) seen.add(mention.id)
      return isVisible
    })
    .map((mention) => mention.id)
}

export function CommentComposer({ onSubmit, autoFocus, pending, mentionSearch }: Props) {
  const contextMentionSearch = useContext(CommentMentionSearchContext)
  const resolvedMentionSearch = mentionSearch ?? contextMentionSearch
  const listboxId = useId()
  const [text, setText] = useState('')
  const [selectedMentions, setSelectedMentions] = useState<CommentMentionItem[]>([])
  const [results, setResults] = useState<CommentMentionItem[]>([])
  const [activeResultIndex, setActiveResultIndex] = useState(0)
  const [mentionRange, setMentionRange] = useState<{ from: number; to: number } | null>(null)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const requestIdRef = useRef(0)
  const mentionListboxId = `${listboxId}-mention-results`
  const activeOptionId =
    mentionRange && results[activeResultIndex]
      ? `${mentionListboxId}-${results[activeResultIndex].id}`
      : undefined

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
          if (requestIdRef.current === requestId) {
            setResults(items)
            setActiveResultIndex(0)
          }
        })
        .catch(() => {
          if (requestIdRef.current === requestId) {
            setResults([])
            setActiveResultIndex(0)
          }
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

  const closeMentionResults = () => {
    requestIdRef.current += 1
    setMentionRange(null)
    setResults([])
    setActiveResultIndex(0)
  }

  const pick = (item: CommentMentionItem) => {
    if (!mentionRange) return
    const nextText = `${text.slice(0, mentionRange.from)}@${item.label} ${text.slice(mentionRange.to)}`
    setText(nextText)
    setSelectedMentions((prev) =>
      prev.some((mention) => mention.id === item.id) ? prev : [...prev, item],
    )
    closeMentionResults()
  }

  const reset = () => {
    setText('')
    setSelectedMentions([])
    closeMentionResults()
  }

  const submit = () => {
    if (pending) return
    const t = text.trim()
    if (!t) return
    onSubmit({ text: t, mentions: selectedMentionIdsInText(t, selectedMentions) })
    reset()
  }

  const hasMentionResults = Boolean(mentionRange && results.length > 0)

  return (
    <Box sx={{ position: 'relative' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-end' }}>
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
          onKeyUp={(e) => {
            if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(e.key)) return
            refreshTokenFromInput()
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              submit()
              return
            }

            if (!hasMentionResults) return

            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActiveResultIndex((index) => (index + 1) % results.length)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActiveResultIndex((index) => (index - 1 + results.length) % results.length)
            } else if (e.key === 'Enter') {
              e.preventDefault()
              const activeResult = results[activeResultIndex] ?? results[0]
              if (activeResult) pick(activeResult)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              closeMentionResults()
            }
          }}
          slotProps={{
            htmlInput: {
              'aria-activedescendant': activeOptionId,
              'aria-autocomplete': 'list',
              'aria-controls': hasMentionResults ? mentionListboxId : undefined,
              'aria-expanded': hasMentionResults,
            },
          }}
        />
        <Tooltip title="Отправить">
          <span>
            <IconButton
              color="primary"
              onClick={submit}
              disabled={pending || !text.trim()}
              aria-label="Отправить комментарий"
              sx={{
                width: 36,
                height: 36,
                bgcolor: text.trim() && !pending ? 'primary.main' : 'action.disabledBackground',
                color: text.trim() && !pending ? 'primary.contrastText' : 'action.disabled',
                '&:hover': {
                  bgcolor: text.trim() && !pending ? 'primary.dark' : 'action.disabledBackground',
                },
              }}
            >
              <SendRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      {hasMentionResults && (
        <Paper
          id={mentionListboxId}
          role="listbox"
          aria-label="Упоминания"
          aria-activedescendant={activeOptionId}
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
          {results.map((r, index) => (
            <Box
              key={r.id}
              id={`${mentionListboxId}-${r.id}`}
              role="option"
              aria-label={r.label}
              aria-selected={index === activeResultIndex}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(r)}
              onMouseEnter={() => setActiveResultIndex(index)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1.5,
                py: 0.75,
                cursor: 'pointer',
                bgcolor: index === activeResultIndex ? 'action.selected' : undefined,
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
