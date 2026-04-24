import type { ComponentType, SVGProps } from "react"

import {
  AudioFileIcon,
  CodeIcon,
  DescriptionIcon,
  FolderZipIcon,
  ImageIcon,
  InsertDriveFileIcon,
  PictureAsPdfIcon,
  SlideshowIcon,
  TableChartIcon,
  TextSnippetIcon,
  VideoFileIcon,
} from "@repo/ui/components"

type SvgIconComponent = ComponentType<SVGProps<SVGSVGElement> & { fontSize?: "small" | "inherit" | "medium" | "large" }>

const GROUPS: Array<{ exts: readonly string[]; Icon: SvgIconComponent }> = [
  { exts: ["pdf"], Icon: PictureAsPdfIcon as unknown as SvgIconComponent },
  {
    exts: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"],
    Icon: ImageIcon as unknown as SvgIconComponent,
  },
  {
    exts: ["mp4", "mov", "avi", "mkv", "webm"],
    Icon: VideoFileIcon as unknown as SvgIconComponent,
  },
  {
    exts: ["mp3", "wav", "ogg", "flac", "m4a"],
    Icon: AudioFileIcon as unknown as SvgIconComponent,
  },
  {
    exts: ["zip", "rar", "7z", "tar", "gz"],
    Icon: FolderZipIcon as unknown as SvgIconComponent,
  },
  { exts: ["doc", "docx", "odt", "rtf"], Icon: DescriptionIcon as unknown as SvgIconComponent },
  {
    exts: ["xls", "xlsx", "csv", "ods"],
    Icon: TableChartIcon as unknown as SvgIconComponent,
  },
  { exts: ["ppt", "pptx", "odp"], Icon: SlideshowIcon as unknown as SvgIconComponent },
  { exts: ["txt", "md"], Icon: TextSnippetIcon as unknown as SvgIconComponent },
  {
    exts: ["js", "ts", "tsx", "jsx", "json", "xml", "yaml", "yml", "py", "go", "rs", "java"],
    Icon: CodeIcon as unknown as SvgIconComponent,
  },
]

function resolve(ext: string): SvgIconComponent {
  const lower = ext.toLowerCase()
  for (const { exts, Icon } of GROUPS) {
    if (exts.includes(lower)) return Icon
  }
  return InsertDriveFileIcon as unknown as SvgIconComponent
}

type Props = {
  ext: string
  fontSize?: "small" | "inherit" | "medium" | "large"
}

export function FileExtIcon({ ext, fontSize = "small" }: Props) {
  const Icon = resolve(ext)
  return <Icon fontSize={fontSize} />
}
