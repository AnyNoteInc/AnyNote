'use client'

import {
  Avatar,
  Box,
  DeleteIcon,
  DownloadIcon,
  IconButton,
  Stack,
  TableCell,
  TableRow,
  Tooltip,
  Typography,
} from '@repo/ui/components'

import { FileExtIcon } from './file-ext-icon'

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
  if (!Number.isFinite(num)) return '—'
  return `${(num / (1024 * 1024)).toFixed(2)} МБ`
}

const fullName = (user: RowUser) => {
  const joined = [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
  return joined || user.email
}

const initials = (user: RowUser) => fullName(user).slice(0, 1).toUpperCase()

export function FilesTableRow({ file, currentUserId, onRequestDelete }: Props) {
  const downloadUrl = `/api/files/${file.id}`
  const owned = file.userId === currentUserId

  return (
    <TableRow hover>
      <TableCell sx={{ maxWidth: 320 }}>
        <Stack direction="row" spacing={1} sx={{ minWidth: 0, alignItems: 'center' }}>
          <FileExtIcon ext={file.ext} />
          <Tooltip title={file.name}>
            <Typography
              component="a"
              href={downloadUrl}
              target="_blank"
              rel="noreferrer"
              variant="body2"
              sx={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
                color: 'text.primary',
                textDecoration: 'none',
                '&:hover': { textDecoration: 'underline' },
              }}
            >
              {file.name}
            </Typography>
          </Tooltip>
        </Stack>
      </TableCell>
      <TableCell align="right">{formatMb(file.fileSize)}</TableCell>
      <TableCell align="right">{file.downloadCount}</TableCell>
      <TableCell>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Avatar src={file.user.image ?? undefined} sx={{ width: 24, height: 24, fontSize: 12 }}>
            {initials(file.user)}
          </Avatar>
          <Typography variant="body2" noWrap>
            {fullName(file.user)}
          </Typography>
        </Box>
      </TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
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
