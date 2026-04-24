"use client"

import {
  Avatar,
  Box,
  Chip,
  DeleteIcon,
  DownloadIcon,
  IconButton,
  Stack,
  TableCell,
  TableRow,
  Tooltip,
  Typography,
} from "@repo/ui/components"

import { FileExtIcon } from "./file-ext-icon"

type RowUser = {
  id: string
  firstName: string | null
  lastName: string | null
  email: string
  image: string | null
}

export type RowFile = {
  id: string
  name: string
  ext: string
  fileSize: string
  status: string
  downloadCount: number
  userId: string
  user: RowUser
}

type Props = {
  file: RowFile
  currentUserId: string
  onRequestDelete: (file: RowFile) => void
}

const formatMb = (bytes: string) => {
  const num = Number(bytes)
  if (!Number.isFinite(num)) return "—"
  return `${(num / (1024 * 1024)).toFixed(2)} МБ`
}

const fullName = (user: RowUser) => {
  const joined = [user.firstName, user.lastName].filter(Boolean).join(" ").trim()
  return joined || user.email
}

const initials = (user: RowUser) => fullName(user).slice(0, 1).toUpperCase()

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Активен",
  ARCHIVED: "В архиве",
  PENDING: "Обработка",
  DELETED: "Удалён",
}

export function FilesTableRow({ file, currentUserId, onRequestDelete }: Props) {
  const displayName = file.ext ? `${file.name}.${file.ext}` : file.name
  const downloadUrl = `/api/files/${file.id}`
  const owned = file.userId === currentUserId

  return (
    <TableRow hover>
      <TableCell sx={{ maxWidth: 320 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          <FileExtIcon ext={file.ext} />
          <Tooltip title={displayName}>
            <Typography
              variant="body2"
              sx={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
              }}
            >
              {displayName}
            </Typography>
          </Tooltip>
        </Stack>
      </TableCell>
      <TableCell>{file.ext ? file.ext.toUpperCase() : "—"}</TableCell>
      <TableCell align="right">{formatMb(file.fileSize)}</TableCell>
      <TableCell>
        <Chip size="small" label={STATUS_LABEL[file.status] ?? file.status} />
      </TableCell>
      <TableCell align="right">{file.downloadCount}</TableCell>
      <TableCell>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
          <Avatar
            src={file.user.image ?? undefined}
            sx={{ width: 24, height: 24, fontSize: 12 }}
          >
            {initials(file.user)}
          </Avatar>
          <Typography variant="body2" noWrap>
            {fullName(file.user)}
          </Typography>
        </Box>
      </TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
          <Tooltip title="Скачать файл">
            <IconButton
              size="small"
              component="a"
              href={downloadUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Скачать файл"
            >
              <DownloadIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {owned ? (
            <Tooltip title="Удалить файл">
              <IconButton
                size="small"
                color="error"
                aria-label="Удалить файл"
                onClick={() => onRequestDelete(file)}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : null}
        </Stack>
      </TableCell>
    </TableRow>
  )
}
