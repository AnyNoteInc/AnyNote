"use client"

import { useRef, useState } from "react"

import { Avatar, Box, Chip, Menu, MenuItem, Stack, Typography } from "@repo/ui/components"

type Uploader = {
  id: string
  firstName: string | null
  lastName: string | null
  email: string
  image: string | null
}

type Props = {
  uploaderId: string | null
  uploaders: Uploader[]
  uploadersLoading: boolean
  onUploaderChange: (value: string | null) => void
}

function fullName(user: Uploader) {
  const joined = [user.firstName, user.lastName].filter(Boolean).join(" ").trim()
  return joined || user.email
}

function initials(user: Uploader) {
  const src = fullName(user)
  return src.slice(0, 1).toUpperCase()
}

function shortName(user: Uploader) {
  const first = user.firstName?.trim() ?? ""
  const last = user.lastName?.trim() ?? ""
  if (first && last) return `${first} ${last.slice(0, 1)}.`
  return first || last || user.email
}

export function FilesFilters({
  uploaderId,
  uploaders,
  uploadersLoading,
  onUploaderChange,
}: Props) {
  const uploaderChipRef = useRef<HTMLDivElement>(null)
  const [uploaderOpen, setUploaderOpen] = useState(false)

  const activeUploader = uploaderId ? (uploaders.find((u) => u.id === uploaderId) ?? null) : null

  const uploaderLabel = activeUploader
    ? `Пользователь: ${shortName(activeUploader)}`
    : "Пользователь"

  return (
    <>
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
        <Chip
          ref={uploaderChipRef}
          label={uploaderLabel}
          variant={activeUploader ? "filled" : "outlined"}
          color={activeUploader ? "primary" : "default"}
          onClick={() => setUploaderOpen(true)}
          onDelete={activeUploader ? () => onUploaderChange(null) : undefined}
        />
      </Stack>

      <Menu
        open={uploaderOpen}
        anchorEl={uploaderChipRef.current}
        onClose={() => setUploaderOpen(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{ paper: { sx: { maxHeight: 360, minWidth: 260 } } }}
      >
        {uploadersLoading ? (
          <MenuItem disabled>Загрузка…</MenuItem>
        ) : uploaders.length === 0 ? (
          <MenuItem disabled>Нет пользователей</MenuItem>
        ) : (
          uploaders.map((user) => (
            <MenuItem
              key={user.id}
              selected={user.id === uploaderId}
              onClick={() => {
                onUploaderChange(user.id)
                setUploaderOpen(false)
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
                <Avatar src={user.image ?? undefined} sx={{ width: 24, height: 24, fontSize: 12 }}>
                  {initials(user)}
                </Avatar>
                <Typography variant="body2" noWrap>
                  {fullName(user)}
                </Typography>
              </Box>
            </MenuItem>
          ))
        )}
      </Menu>
    </>
  )
}
