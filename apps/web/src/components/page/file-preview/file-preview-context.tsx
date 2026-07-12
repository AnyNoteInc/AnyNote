'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import type { FilePreviewPayload } from '@repo/editor'
import { useMediaQuery, useTheme } from '@repo/ui/components'

import { extFromFileName, resolvePreviewType } from '@/lib/preview-kind'

export const FILE_PREVIEW_MIN_WIDTH = 360

/** split — правая докованная колонка; full — Dialog fullScreen. */
export type FilePreviewMode = 'split' | 'full'

const MODE_KEY = 'filePreview.displayMode'
const WIDTH_KEY = 'filePreview.sidebar.width'

// --- Pure helpers (unit-tested in test/file-preview-context.test.ts) --------

export const clampPreviewWidth = (value: number, viewportWidth: number): number => {
  const max = Math.max(FILE_PREVIEW_MIN_WIDTH, Math.round(viewportWidth * 0.7))
  return Math.min(max, Math.max(FILE_PREVIEW_MIN_WIDTH, value))
}

/** Спека §4: при первом открытии панель занимает половину вьюпорта. */
export const defaultPreviewWidth = (viewportWidth: number): number =>
  clampPreviewWidth(Math.round(viewportWidth / 2), viewportWidth)

export type FilePreviewOpenAction = 'panel' | 'download'

/** null-тип из resolvePreviewType = не просматриваемый → скачивание (спека §3). */
export const resolveOpenAction = (payload: FilePreviewPayload): FilePreviewOpenAction => {
  if (payload.kind === 'diagram') return 'panel'
  return resolvePreviewType(payload.mimeType, extFromFileName(payload.name)) ? 'panel' : 'download'
}

const triggerDownload = (url: string, name: string | null) => {
  const a = document.createElement('a')
  a.href = url
  a.download = name ?? ''
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

// --- Context -----------------------------------------------------------------

type FilePreviewContextValue = {
  payload: FilePreviewPayload | null
  open: (payload: FilePreviewPayload) => void
  close: () => void
  mode: FilePreviewMode
  setMode: (mode: FilePreviewMode) => void
  /** 'full' принудительно на < md — сплит там не помещается (спека §4). */
  effectiveMode: FilePreviewMode
  isMobile: boolean
  sidebarWidth: number
  commitSidebarWidth: (width: number) => void
}

const FilePreviewContext = createContext<FilePreviewContextValue | null>(null)

/** Non-throwing — page-renderer/FAB рендерятся и там, где провайдера нет
 *  (PageView/template editor) и должны деградировать к текущему поведению. */
export function useFilePreview(): FilePreviewContextValue | null {
  return useContext(FilePreviewContext)
}

export function FilePreviewProvider({ pageId, children }: { pageId: string; children: ReactNode }) {
  const [payload, setPayload] = useState<FilePreviewPayload | null>(null)

  // Режим переживает навигацию и перезагрузки (паттерн pageChat.displayMode):
  // дефолт split, гидратация из localStorage после маунта.
  const [mode, setModeState] = useState<FilePreviewMode>('split')
  useEffect(() => {
    const stored = window.localStorage.getItem(MODE_KEY)
    if (stored === 'split' || stored === 'full') setModeState(stored)
  }, [])
  const setMode = useCallback((next: FilePreviewMode) => {
    setModeState(next)
    window.localStorage.setItem(MODE_KEY, next)
  }, [])

  // Ширина: дефолт — половина вьюпорта при гидратации, персист по коммиту.
  const [sidebarWidth, setSidebarWidthState] = useState(FILE_PREVIEW_MIN_WIDTH)
  useEffect(() => {
    const stored = Number.parseInt(window.localStorage.getItem(WIDTH_KEY) ?? '', 10)
    setSidebarWidthState(
      Number.isNaN(stored)
        ? defaultPreviewWidth(window.innerWidth)
        : clampPreviewWidth(stored, window.innerWidth),
    )
  }, [])
  const commitSidebarWidth = useCallback((width: number) => {
    const clamped = clampPreviewWidth(width, window.innerWidth)
    setSidebarWidthState(clamped)
    window.localStorage.setItem(WIDTH_KEY, String(clamped))
  }, [])

  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const effectiveMode: FilePreviewMode = isMobile ? 'full' : mode

  const open = useCallback((next: FilePreviewPayload) => {
    if (resolveOpenAction(next) === 'download') {
      if (next.kind === 'file') triggerDownload(next.url, next.name)
      return
    }
    setPayload(next)
  }, [])
  const close = useCallback(() => setPayload(null), [])

  // Сброс при смене страницы без перемонтирования провайдера (паттерн
  // prevPageId из page-chat-context).
  const [prevPageId, setPrevPageId] = useState(pageId)
  if (pageId !== prevPageId) {
    setPrevPageId(pageId)
    setPayload(null)
  }

  const value = useMemo(
    () => ({
      payload,
      open,
      close,
      mode,
      setMode,
      effectiveMode,
      isMobile,
      sidebarWidth,
      commitSidebarWidth,
    }),
    [
      payload,
      open,
      close,
      mode,
      setMode,
      effectiveMode,
      isMobile,
      sidebarWidth,
      commitSidebarWidth,
    ],
  )

  return <FilePreviewContext.Provider value={value}>{children}</FilePreviewContext.Provider>
}
