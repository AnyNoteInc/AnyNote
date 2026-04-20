"use client"

import { Box, Typography } from "@mui/material"
import AttachFileIcon from "@mui/icons-material/AttachFile"
import ImageIcon from "@mui/icons-material/Image"
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf"
import AudiotrackIcon from "@mui/icons-material/Audiotrack"
import type { ReactElement } from "react"
import type { ChatAttachment } from "../types/index"

export interface AttachmentRowProps {
  attachment: ChatAttachment
}

const kindIcon: Record<ChatAttachment["kind"], ReactElement> = {
  image: <ImageIcon fontSize="small" />,
  file: <AttachFileIcon fontSize="small" />,
  pdf: <PictureAsPdfIcon fontSize="small" />,
  audio: <AudiotrackIcon fontSize="small" />,
}

function formatSize(bytes?: number): string {
  if (bytes === undefined) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function AttachmentRow({ attachment }: AttachmentRowProps): ReactElement {
  const inner = (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        my: 0.5,
        px: 1.25,
        py: 0.75,
        borderRadius: 1,
        bgcolor: "action.hover",
      }}
    >
      {kindIcon[attachment.kind]}
      <Typography variant="body2" sx={{ flexGrow: 1 }} noWrap>
        {attachment.name}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {formatSize(attachment.sizeBytes)}
      </Typography>
    </Box>
  )
  return attachment.url ? (
    <Box component="a" href={attachment.url} target="_blank" rel="noopener noreferrer" sx={{ textDecoration: "none", color: "inherit" }}>
      {inner}
    </Box>
  ) : (
    inner
  )
}
