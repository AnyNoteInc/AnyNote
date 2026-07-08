'use client'

import { useRef, useState, type ChangeEvent } from 'react'

import {
  Box,
  Button,
  CircularProgress,
  DeleteIcon,
  EmojiPicker,
  Popover,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@repo/ui/components'

import { pageIconValue } from './page-icon-format'

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

type TabKey = 'emoji' | 'upload'

type Props = {
  anchorEl: HTMLElement | null
  open: boolean
  onClose: () => void
  /** An emoji string, or `url:/api/files/<id>` for an uploaded image icon. */
  onSelect: (icon: string) => void
  /** When provided, a remove row is shown above the tabs. */
  onRemove?: () => void
}

/**
 * The two-tab page-icon picker (Phase 9A, spec §3): «Эмодзи» keeps the
 * existing EmojiPicker; «Загрузить» uploads via `kind=icon` and selects
 * `url:<imageUrl>`. Square-crop is deferred — images render `object-fit:
 * cover` in PageIcon's rounded square.
 */
export function IconPickerPopover({ anchorEl, open, onClose, onSelect, onRemove }: Props) {
  const [tab, setTab] = useState<TabKey>('emoji')
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const close = () => {
    setUploadError(null)
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
      const res = await fetch('/api/files/upload?kind=icon', { method: 'POST', body })
      const payload = (await res.json().catch(() => null)) as {
        error?: string
        imageUrl?: string
      } | null
      if (!res.ok || !payload?.imageUrl) {
        throw new Error(payload?.error ?? `Не удалось загрузить файл (${res.status})`)
      }
      onSelect(pageIconValue(payload.imageUrl))
      close()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Не удалось загрузить файл')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={close}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
    >
      <Stack sx={{ width: 320 }}>
        {onRemove ? (
          <Box sx={{ p: 1, borderBottom: 1, borderColor: 'divider' }}>
            <Button
              size="small"
              fullWidth
              color="inherit"
              startIcon={<DeleteIcon fontSize="small" />}
              onClick={() => {
                close()
                onRemove()
              }}
              sx={{ justifyContent: 'flex-start', color: 'text.secondary', textTransform: 'none' }}
            >
              Удалить иконку
            </Button>
          </Box>
        ) : null}
        <Tabs
          value={tab}
          onChange={(_e, value: TabKey) => setTab(value)}
          variant="fullWidth"
          sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 40 }}
        >
          <Tab value="emoji" label="Эмодзи" sx={{ minHeight: 40, textTransform: 'none' }} />
          <Tab value="upload" label="Загрузить" sx={{ minHeight: 40, textTransform: 'none' }} />
        </Tabs>

        {tab === 'emoji' ? (
          <EmojiPicker
            onSelect={(emoji) => {
              close()
              onSelect(emoji)
            }}
          />
        ) : (
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
              PNG, JPEG, WebP или GIF до 1 МБ — квадратные смотрятся лучше всего
            </Typography>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              onChange={onFileChange}
              style={{ display: 'none' }}
              data-testid="page-icon-file-input"
            />
            {uploadError ? (
              <Typography variant="caption" color="error">
                {uploadError}
              </Typography>
            ) : null}
          </Stack>
        )}
      </Stack>
    </Popover>
  )
}
