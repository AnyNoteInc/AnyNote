'use client'

import { useState } from 'react'

import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'

import type { JSONContent } from '@repo/editor'
import {
  Alert,
  ArrowBackIcon,
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

const AnyNotePlainEditor = dynamic(() => import('@repo/editor').then((m) => m.AnyNotePlainEditor), {
  ssr: false,
})

type Props = { workspaceId: string; templateId: string }

// The tRPC query types `content` as the deeply-recursive Prisma.JsonValue.
// Re-viewing the row through this narrow shape (content widened to `unknown`)
// avoids member access on that recursive type, which blows the TS
// instantiation-depth limit (TS2589).
type TemplateDetailView = {
  title: string
  icon: string | null
  content: unknown
}

// Reading `content` through an `unknown`-typed param avoids the inline
// `as JSONContent` relation check (also a TS2589 source).
function readTemplateContent(value: unknown): JSONContent | null {
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  if (obj.type === 'doc' && Array.isArray(obj.content)) return obj as JSONContent
  return null
}

export function TemplateEditor({ workspaceId, templateId }: Props) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const detail = trpc.template.getById.useQuery({ templateId, workspaceId })
  const [draft, setDraft] = useState<JSONContent | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const updateMut = trpc.template.updateContent.useMutation({
    onSuccess: () => {
      utils.template.getById.invalidate({ templateId, workspaceId }).catch(() => undefined)
      setSavedAt(Date.now())
    },
  })

  const handleEditorChange = (value: JSONContent) => {
    setDraft(value)
    setSavedAt(null)
  }

  const data = detail.data as TemplateDetailView | undefined
  const initialContent = readTemplateContent(data?.content)

  if (detail.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
        <CircularProgress />
      </Box>
    )
  }
  if (detail.isError || !data) {
    return (
      <Box sx={{ p: 4 }}>
        <Typography color="error">Шаблон не найден.</Typography>
      </Box>
    )
  }

  const handleSave = () => {
    const content = draft ?? initialContent ?? { type: 'doc', content: [] }
    updateMut.mutate({ templateId, workspaceId, content })
  }

  return (
    <Box sx={{ maxWidth: 820, mx: 'auto', p: { xs: 2, md: 4 } }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon />}
          onClick={() => router.push(`/workspaces/${workspaceId}/templates`)}
        >
          К шаблонам
        </Button>
        <Box sx={{ fontSize: 24 }}>{data.icon ?? '📄'}</Box>
        <Typography variant="h6" component="h1" sx={{ flex: 1, minWidth: 0 }} noWrap>
          {data.title}
        </Typography>
        {savedAt && !updateMut.isPending ? (
          <Typography variant="caption" color="text.secondary">
            Сохранено
          </Typography>
        ) : null}
        <Button variant="contained" onClick={handleSave} disabled={updateMut.isPending}>
          Сохранить
        </Button>
      </Stack>

      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2 }}>
        <AnyNotePlainEditor
          value={initialContent}
          editable
          onChange={handleEditorChange}
          onBlurSave={handleEditorChange}
        />
      </Box>

      {updateMut.isError ? (
        <Alert severity="error" sx={{ mt: 2 }}>
          Не удалось сохранить шаблон. Попробуйте ещё раз.
        </Alert>
      ) : null}
    </Box>
  )
}
