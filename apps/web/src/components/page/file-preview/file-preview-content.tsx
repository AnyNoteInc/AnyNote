// apps/web/src/components/page/file-preview/file-preview-content.tsx
'use client'

import type { FilePreviewPayload } from '@repo/editor'

import { extFromFileName, resolvePreviewType } from '@/lib/preview-kind'

import {
  DownloadPrompt,
  ImageViewer,
  MediaViewer,
  OfficeViewer,
  PdfViewer,
  SvgViewer,
  TextViewer,
} from './viewers'

/** Смена файла обязана пересоздавать просмотрщик (см. key в сайдбаре/диалоге) —
 *  иначе залипают error/text-состояния и zoom/pan-трансформация прошлого файла. */
export const previewContentKey = (payload: FilePreviewPayload): string =>
  payload.kind === 'file' ? payload.url : payload.svg

/** Общий контент сплит-панели и фуллскрин-диалога (спека §5). */
export function FilePreviewContent({ payload }: { payload: FilePreviewPayload }) {
  if (payload.kind === 'diagram') {
    return <SvgViewer source={{ kind: 'inline', value: payload.svg }} name={payload.title} />
  }
  const type = resolvePreviewType(payload.mimeType, extFromFileName(payload.name))
  switch (type) {
    case 'image':
      return <ImageViewer url={payload.url} name={payload.name} />
    case 'svg':
      return <SvgViewer source={{ kind: 'url', value: payload.url }} name={payload.name} />
    case 'pdf':
      return <PdfViewer url={payload.url} name={payload.name} />
    case 'office':
      return <OfficeViewer url={payload.url} name={payload.name} />
    case 'video':
    case 'audio':
      return <MediaViewer url={payload.url} name={payload.name} media={type} />
    case 'text':
      return <TextViewer url={payload.url} name={payload.name} size={payload.size} />
    default:
      // open() гейтит null-типы в download, сюда попадать не должны — но
      // рендерим честный фолбэк на случай прямого вызова.
      return (
        <DownloadPrompt
          url={payload.url}
          name={payload.name}
          reason="Предпросмотр не поддерживается"
        />
      )
  }
}
