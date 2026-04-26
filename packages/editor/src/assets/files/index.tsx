import { createElement, type FC, type SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>
export type FileIconComponent = FC<IconProps>

const COLORS = {
  text: '#64748B',
  pdf: '#DC2626',
  doc: '#2563EB',
  xls: '#16A34A',
  ppt: '#EA580C',
  image: '#9333EA',
  audio: '#DB2777',
  video: '#E11D48',
  archive: '#CA8A04',
  code: '#0D9488',
  default: '#475569',
} as const

const EXT_TO_COLOR: Record<string, string> = {
  txt: COLORS.text,
  pdf: COLORS.pdf,
  doc: COLORS.doc,
  docx: COLORS.doc,
  xls: COLORS.xls,
  xlsx: COLORS.xls,
  csv: COLORS.xls,
  ppt: COLORS.ppt,
  pptx: COLORS.ppt,
  jpg: COLORS.image,
  png: COLORS.image,
  gif: COLORS.image,
  mp3: COLORS.audio,
  wav: COLORS.audio,
  mp4: COLORS.video,
  zip: COLORS.archive,
  rar: COLORS.archive,
  html: COLORS.code,
}

const makeFileIcon = (label: string, color: string, displayName: string): FileIconComponent => {
  const Component: FileIconComponent = (props) =>
    createElement(
      'svg',
      {
        viewBox: '0 0 32 32',
        width: 32,
        height: 32,
        fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg',
        ...props,
      },
      createElement('path', {
        key: 'body',
        d: 'M8 2h12l6 6v20a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z',
        fill: '#FFFFFF',
        stroke: '#94A3B8',
        strokeWidth: 1.5,
      }),
      createElement('path', {
        key: 'fold',
        d: 'M20 2v6h6',
        fill: 'none',
        stroke: '#94A3B8',
        strokeWidth: 1.5,
      }),
      createElement('rect', {
        key: 'label-bg',
        x: 4,
        y: 18,
        width: 22,
        height: 9,
        rx: 1.5,
        fill: color,
      }),
      createElement(
        'text',
        {
          key: 'label',
          x: 15,
          y: 24.5,
          textAnchor: 'middle',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          fontSize: label.length > 3 ? 5 : 6,
          fontWeight: 700,
          fill: '#FFFFFF',
          letterSpacing: 0.5,
        },
        label.toUpperCase(),
      ),
    )
  Component.displayName = displayName
  return Component
}

export const TxtIcon = makeFileIcon('txt', COLORS.text, 'TxtIcon')
export const PdfIcon = makeFileIcon('pdf', COLORS.pdf, 'PdfIcon')
export const DocIcon = makeFileIcon('doc', COLORS.doc, 'DocIcon')
export const DocxIcon = makeFileIcon('docx', COLORS.doc, 'DocxIcon')
export const XlsIcon = makeFileIcon('xls', COLORS.xls, 'XlsIcon')
export const XlsxIcon = makeFileIcon('xlsx', COLORS.xls, 'XlsxIcon')
export const PptIcon = makeFileIcon('ppt', COLORS.ppt, 'PptIcon')
export const PptxIcon = makeFileIcon('pptx', COLORS.ppt, 'PptxIcon')
export const JpgIcon = makeFileIcon('jpg', COLORS.image, 'JpgIcon')
export const PngIcon = makeFileIcon('png', COLORS.image, 'PngIcon')
export const GifIcon = makeFileIcon('gif', COLORS.image, 'GifIcon')
export const Mp3Icon = makeFileIcon('mp3', COLORS.audio, 'Mp3Icon')
export const WavIcon = makeFileIcon('wav', COLORS.audio, 'WavIcon')
export const Mp4Icon = makeFileIcon('mp4', COLORS.video, 'Mp4Icon')
export const ZipIcon = makeFileIcon('zip', COLORS.archive, 'ZipIcon')
export const RarIcon = makeFileIcon('rar', COLORS.archive, 'RarIcon')
export const HtmlIcon = makeFileIcon('html', COLORS.code, 'HtmlIcon')
export const CsvIcon = makeFileIcon('csv', COLORS.xls, 'CsvIcon')
export const DefaultFileIcon = makeFileIcon('file', COLORS.default, 'DefaultFileIcon')

const ICON_BY_EXT: Record<string, FileIconComponent> = {
  txt: TxtIcon,
  pdf: PdfIcon,
  doc: DocIcon,
  docx: DocxIcon,
  xls: XlsIcon,
  xlsx: XlsxIcon,
  csv: CsvIcon,
  ppt: PptIcon,
  pptx: PptxIcon,
  jpg: JpgIcon,
  jpeg: JpgIcon,
  png: PngIcon,
  gif: GifIcon,
  mp3: Mp3Icon,
  wav: WavIcon,
  mp4: Mp4Icon,
  zip: ZipIcon,
  rar: RarIcon,
  html: HtmlIcon,
}

export const getFileIcon = (ext: string): FileIconComponent => {
  const key = ext.toLowerCase().replace(/^\./, '')
  return ICON_BY_EXT[key] ?? DefaultFileIcon
}

export const getFileColor = (ext: string): string =>
  EXT_TO_COLOR[ext.toLowerCase().replace(/^\./, '')] ?? COLORS.default
