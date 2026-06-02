'use client'

import { useEffect, useMemo, useState } from 'react'

import {
  Alert,
  Box,
  Button,
  InputAdornment,
  SearchIcon,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { FilesDeleteDialog } from './files-delete-dialog'
import { FilesFilters } from './files-filters'
import { FilesTableRow, type RowFile } from './files-table-row'
import { SettingsCard } from './settings-card'

type Props = {
  workspaceId: string
  currentUserId: string
}

const PAGE_SIZE = 20

export function WorkspaceFilesSection({ workspaceId, currentUserId }: Props) {
  const utils = trpc.useUtils()

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [uploaderId, setUploaderId] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [deleteTarget, setDeleteTarget] = useState<RowFile | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    setPage(0)
  }, [search, uploaderId])

  const uploadersQuery = trpc.file.workspaceUploaders.useQuery({ workspaceId })

  const listQuery = trpc.file.listWorkspace.useQuery(
    {
      workspaceId,
      search: search || undefined,
      uploaderId: uploaderId ?? undefined,
      page,
      pageSize: PAGE_SIZE,
    },
    { placeholderData: (prev) => prev },
  )

  useEffect(() => {
    const total = listQuery.data?.total ?? 0
    const lastPage = total === 0 ? 0 : Math.ceil(total / PAGE_SIZE) - 1
    if (page > lastPage) setPage(lastPage)
  }, [listQuery.data?.total, page])

  const resetFilters = () => {
    setSearchInput('')
    setSearch('')
    setUploaderId(null)
  }

  const handleDeleted = () => {
    utils.file.listWorkspace.invalidate({ workspaceId })
    utils.file.workspaceUploaders.invalidate({ workspaceId })
  }

  const filtersActive = search !== '' || uploaderId !== null
  const items = useMemo(() => listQuery.data?.items ?? [], [listQuery.data?.items])
  const total = listQuery.data?.total ?? 0

  const body = useMemo(() => {
    if (listQuery.isLoading && items.length === 0) {
      return (
        <TableRow>
          <TableCell colSpan={5} sx={{ textAlign: 'center', py: 4 }}>
            <Typography variant="body2" color="text.secondary">
              Загрузка…
            </Typography>
          </TableCell>
        </TableRow>
      )
    }

    if (items.length === 0 && filtersActive) {
      return (
        <TableRow>
          <TableCell colSpan={5} sx={{ textAlign: 'center', py: 4 }}>
            <Stack spacing={1} alignItems="center">
              <Typography variant="body2" color="text.secondary">
                По фильтрам ничего не найдено.
              </Typography>
              <Button size="small" onClick={resetFilters}>
                Сбросить фильтры
              </Button>
            </Stack>
          </TableCell>
        </TableRow>
      )
    }

    if (items.length === 0) {
      return (
        <TableRow>
          <TableCell colSpan={5} sx={{ textAlign: 'center', py: 4 }}>
            <Typography variant="body2" color="text.secondary">
              Файлы ещё не загружались.
            </Typography>
          </TableCell>
        </TableRow>
      )
    }

    return items.map((file) => (
      <FilesTableRow
        key={file.id}
        file={file as RowFile}
        currentUserId={currentUserId}
        onRequestDelete={setDeleteTarget}
      />
    ))
  }, [listQuery.isLoading, items, filtersActive, currentUserId])

  return (
    <SettingsCard
      title="Библиотека"
      description="Все файлы, загруженные в этом workspace."
    >
      {listQuery.error ? <Alert severity="error">{listQuery.error.message}</Alert> : null}

        <TextField
          size="small"
          placeholder="Поиск по названию"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
          fullWidth
        />

        <FilesFilters
          uploaderId={uploaderId}
          uploaders={uploadersQuery.data ?? []}
          uploadersLoading={uploadersQuery.isLoading}
          onUploaderChange={setUploaderId}
        />

        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Название</TableCell>
                <TableCell align="right">Размер</TableCell>
                <TableCell align="right">Скачивания</TableCell>
                <TableCell>Загрузил</TableCell>
                <TableCell align="right">Действия</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>{body}</TableBody>
          </Table>
        </Box>

        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={(_, next) => setPage(next)}
          rowsPerPage={PAGE_SIZE}
          rowsPerPageOptions={[PAGE_SIZE]}
          labelDisplayedRows={({ from, to, count }) =>
            `${from}–${to} из ${count !== -1 ? count : `больше ${to}`}`
          }
          labelRowsPerPage="На странице"
        />

      <FilesDeleteDialog
        open={deleteTarget !== null}
        file={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={handleDeleted}
      />
    </SettingsCard>
  )
}
