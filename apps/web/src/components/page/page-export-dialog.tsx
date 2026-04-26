'use client'

import { useCallback } from 'react'

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'
import { editorHtmlToMarkdown } from '@/lib/editor-to-markdown'

import { usePageEditor } from './editor-context'

type Props = {
  open: boolean
  onClose: () => void
  pageId: string
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function PageExportDialog({ open, onClose, pageId }: Props) {
  const pageEditor = usePageEditor()
  const pageQ = trpc.page.getById.useQuery({ id: pageId }, { enabled: open })
  const title = pageQ.data?.title?.trim() || 'Без названия'

  const exportMarkdown = useCallback(() => {
    const editor = pageEditor.getEditor()
    if (!editor) return
    const html = editor.getHTML()
    const md = editorHtmlToMarkdown(html)
    downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), `${title}.md`)
    onClose()
  }, [pageEditor, title, onClose])

  const exportHtml = useCallback(() => {
    const editor = pageEditor.getEditor()
    if (!editor) return
    const body = editor.getHTML()
    const doc = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
body { font-family: -apple-system, system-ui, sans-serif; max-width: 800px; margin: 32px auto; padding: 0 16px; line-height: 1.5; color: #222; }
h1, h2, h3, h4, h5, h6 { margin: 0.6em 0 0.3em; }
p, ul, ol, blockquote, pre { margin: 0.25em 0; }
ul, ol { padding-left: 1.4em; }
li { margin: 0.1em 0; }
pre { background: #f4f4f5; padding: 10px; border-radius: 6px; overflow: auto; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
blockquote { border-left: 3px solid #d4d4d8; padding-left: 12px; color: #555; }
img { max-width: 100%; height: auto; }
table { border-collapse: collapse; }
th, td { border: 1px solid #d4d4d8; padding: 6px 10px; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>`
    downloadBlob(new Blob([doc], { type: 'text/html;charset=utf-8' }), `${title}.html`)
    onClose()
  }, [pageEditor, title, onClose])

  const exportPdf = useCallback(() => {
    const style = document.createElement('style')
    style.setAttribute('data-print-override', 'true')
    style.textContent = `
      @media print {
        nav, aside, .workspace-sidebar, .workspace-toolbar, .tiptap-drag-handle-wrapper,
        .page-actions-toolbar, [class*="SlashMenu"],
        .MuiDialog-root, .MuiBackdrop-root, .MuiPopover-root, .MuiModal-root {
          display: none !important;
        }
        html, body { height: auto !important; overflow: visible !important; padding: 0; margin: 0; background: #fff !important; color: #000 !important; }
        main, [data-full-width] { height: auto !important; overflow: visible !important; }
        .anynote-editor { max-width: none !important; padding: 24px !important; height: auto !important; }
        .anynote-editor .ProseMirror { max-width: none !important; }
        @page { margin: 18mm; }
      }
    `
    document.head.appendChild(style)
    // Close the MUI Dialog first so its focus trap releases and doesn't capture
    // window.print; then fire print on the next tick when the dialog is out of
    // the DOM.
    onClose()
    const cleanup = () => {
      style.remove()
      window.removeEventListener('afterprint', cleanup)
    }
    window.addEventListener('afterprint', cleanup)
    setTimeout(() => window.print(), 100)
  }, [onClose])

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Экспортировать страницу</DialogTitle>
      <DialogContent>
        <DialogContentText>Выберите формат для экспорта.</DialogContentText>
        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          <Button variant="contained" onClick={exportPdf}>
            PDF
          </Button>
          <Button variant="contained" onClick={exportMarkdown}>
            Markdown
          </Button>
          <Button variant="contained" onClick={exportHtml}>
            HTML
          </Button>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  )
}
