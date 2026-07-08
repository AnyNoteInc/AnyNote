'use client'

import { useRef, useState, type ChangeEvent } from 'react'

import {
  Box,
  Button,
  CircularProgress,
  Popover,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@repo/ui/components'

import { COVER_PRESET_CSS, COVER_PRESET_KEYS, type CoverPresetKey } from './cover-presets'

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'
// Client-side mirrors of the domain validation (pages.service): https-only
// external links, capped at the column length. The server stays authoritative.
const HTTPS_RE = /^https:\/\/\S+$/
const URL_MAX = 1024
const LINK_ERROR = 'Ссылка должна начинаться с https:// и быть не длиннее 1024 символов'

type TabKey = 'presets' | 'upload' | 'link'

type Props = {
  anchorEl: HTMLElement | null
  open: boolean
  onClose: () => void
  onSelectPreset: (key: CoverPresetKey) => void
  /** An uploaded `/api/files/<id>` path or a validated https URL. */
  onSelectUrl: (url: string) => void
}

export function CoverPicker({ anchorEl, open, onClose, onSelectPreset, onSelectUrl }: Props) {
  const [tab, setTab] = useState<TabKey>('presets')
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const close = () => {
    setUploadError(null)
    setLink('')
    setLinkError(null)
    onClose()
  }

  const onFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploadError(null)
    setIsUploading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch('/api/files/upload?kind=cover', { method: 'POST', body })
      const payload = (await res.json().catch(() => null)) as {
        error?: string
        imageUrl?: string
      } | null
      if (!res.ok || !payload?.imageUrl) {
        throw new Error(payload?.error ?? `Не удалось загрузить файл (${res.status})`)
      }
      onSelectUrl(payload.imageUrl)
      close()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Не удалось загрузить файл')
    } finally {
      setIsUploading(false)
    }
  }

  const submitLink = () => {
    const value = link.trim()
    if (!HTTPS_RE.test(value) || value.length > URL_MAX) {
      setLinkError(LINK_ERROR)
      return
    }
    onSelectUrl(value)
    close()
  }

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={close}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
    >
      <Box sx={{ width: 340 }}>
        <Tabs
          value={tab}
          onChange={(_e, value: TabKey) => setTab(value)}
          variant="fullWidth"
          sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 40 }}
        >
          <Tab value="presets" label="Градиенты" sx={{ minHeight: 40, textTransform: 'none' }} />
          <Tab value="upload" label="Загрузить" sx={{ minHeight: 40, textTransform: 'none' }} />
          <Tab value="link" label="Ссылка" sx={{ minHeight: 40, textTransform: 'none' }} />
        </Tabs>

        {tab === 'presets' ? (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: 1,
              p: 1.5,
            }}
          >
            {COVER_PRESET_KEYS.map((key) => (
              <Box
                key={key}
                component="button"
                type="button"
                aria-label={`Градиент ${key}`}
                data-testid={`cover-preset-${key}`}
                onClick={() => {
                  onSelectPreset(key)
                  close()
                }}
                sx={{
                  height: 40,
                  borderRadius: 1,
                  border: '1px solid',
                  borderColor: 'divider',
                  background: COVER_PRESET_CSS[key],
                  cursor: 'pointer',
                  p: 0,
                  '&:hover': { filter: 'brightness(1.08)' },
                  '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
                }}
              />
            ))}
          </Box>
        ) : null}

        {tab === 'upload' ? (
          <Stack spacing={1} sx={{ p: 1.5, alignItems: 'flex-start' }}>
            <Button
              size="small"
              variant="outlined"
              disabled={isUploading}
              onClick={() => inputRef.current?.click()}
              startIcon={isUploading ? <CircularProgress size={14} /> : undefined}
              sx={{ textTransform: 'none' }}
            >
              {isUploading ? 'Загрузка…' : 'Выбрать файл'}
            </Button>
            <Typography variant="caption" color="text.secondary">
              PNG, JPEG, WebP или GIF до 10 МБ
            </Typography>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              onChange={onFileChange}
              style={{ display: 'none' }}
              data-testid="page-cover-file-input"
            />
            {uploadError ? (
              <Typography variant="caption" color="error">
                {uploadError}
              </Typography>
            ) : null}
          </Stack>
        ) : null}

        {tab === 'link' ? (
          <Stack spacing={1} sx={{ p: 1.5 }}>
            <TextField
              size="small"
              fullWidth
              autoFocus
              placeholder="https://…"
              value={link}
              onChange={(e) => {
                setLink(e.target.value)
                setLinkError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitLink()
                }
              }}
              error={Boolean(linkError)}
              helperText={linkError ?? 'Если картинка перестанет открываться, обложка пропадёт'}
            />
            <Button
              size="small"
              variant="contained"
              onClick={submitLink}
              disabled={!link.trim()}
              sx={{ alignSelf: 'flex-start', textTransform: 'none' }}
            >
              Добавить
            </Button>
          </Stack>
        ) : null}
      </Box>
    </Popover>
  )
}
