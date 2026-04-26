'use client'

import { useRef, useState } from 'react'

import { useRouter } from 'next/navigation'

import { Avatar, Box, CircularProgress, Typography } from '@repo/ui/components'

type Props = {
  currentImage: string | null
  initials: string
}

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

export default function ProfileAvatarUploader({ currentImage, initials }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const router = useRouter()
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onClick = () => {
    if (isUploading) return
    inputRef.current?.click()
  }

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    setIsUploading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch('/api/files/upload?kind=avatar', {
        method: 'POST',
        body,
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error ?? `Upload failed (${res.status})`)
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
      <Box
        onClick={onClick}
        role="button"
        tabIndex={0}
        aria-label="Сменить аватар"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick()
          }
        }}
        sx={{
          position: 'relative',
          cursor: isUploading ? 'wait' : 'pointer',
          '&:focus-visible': {
            outline: '2px solid',
            outlineColor: 'primary.main',
            outlineOffset: 2,
            borderRadius: '50%',
          },
          '&:hover .overlay': { opacity: 1 },
        }}
      >
        <Avatar
          src={currentImage ?? undefined}
          sx={{
            width: 128,
            height: 128,
            fontSize: 44,
            background: 'linear-gradient(135deg,#0f766e,#155e75)',
            color: '#fff',
          }}
        >
          {initials}
        </Avatar>
        <Box
          className="overlay"
          sx={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            bgcolor: 'rgba(0,0,0,0.4)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: isUploading ? 1 : 0,
            transition: 'opacity 120ms ease',
            fontSize: 12,
          }}
        >
          {isUploading ? <CircularProgress size={28} sx={{ color: '#fff' }} /> : 'Сменить'}
        </Box>
      </Box>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        onChange={onChange}
        style={{ display: 'none' }}
        data-testid="avatar-file-input"
      />
      {error ? (
        <Typography variant="caption" color="error">
          {error}
        </Typography>
      ) : null}
    </Box>
  )
}
