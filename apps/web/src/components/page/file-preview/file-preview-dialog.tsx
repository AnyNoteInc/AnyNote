// apps/web/src/components/page/file-preview/file-preview-dialog.tsx
'use client'

import { Box, Dialog } from '@repo/ui/components'

import { useFilePreview } from './file-preview-context'
import { FilePreviewContent, previewContentKey } from './file-preview-content'
import { FilePreviewHeader } from './file-preview-header'

/** Полноэкранный режим (спека §4). Esc/backdrop: на десктопе возвращает в
 *  сплит, на мобильном (сплит недоступен) закрывает просмотр. */
export function FilePreviewDialog() {
  const ctx = useFilePreview()
  if (!ctx) return null
  const open = Boolean(ctx.payload) && ctx.effectiveMode === 'full'
  const handleClose = () => {
    if (ctx.isMobile) ctx.close()
    else ctx.setMode('split')
  }

  return (
    <Dialog open={open} onClose={handleClose} fullScreen>
      {ctx.payload ? (
        <Box
          data-testid="file-preview-dialog"
          sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}
        >
          <FilePreviewHeader payload={ctx.payload} />
          <FilePreviewContent key={previewContentKey(ctx.payload)} payload={ctx.payload} />
        </Box>
      ) : null}
    </Dialog>
  )
}
