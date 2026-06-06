'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  CloseIcon,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { PageTypeGrid } from './page-type-grid'
import { TemplatePreviewPane } from './template-preview-pane'
import { TemplateResultsList } from './template-results-list'
import { TemplateSearchInput } from './template-search-input'
import type { CreatablePageType } from './page-type-registry'
import type { TemplateSummary } from './types'

const DEBOUNCE_MS = 200
const MAX_QUERY = 100
const TITLE_ID = 'create-page-dialog-title'

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timeout = globalThis.setTimeout(() => setDebounced(value), delayMs)
    return () => globalThis.clearTimeout(timeout)
  }, [delayMs, value])
  return debounced
}

interface Props {
  open: boolean
  onClose: () => void
  workspaceId: string
  /** Create a blank page of the given type. */
  onCreatePage: (type: CreatablePageType) => void
  /** Create a page from a template (optionally with an overridden title). */
  onCreateFromTemplate: (templateId: string) => void
  /** Disables actions while a create mutation is in flight. */
  isCreating?: boolean
}

/**
 * Notion-style "Создание страницы" dialog. Empty search → page-type grid;
 * typing → live template search across the workspace and global templates,
 * with a preview pane on the right. The parent owns the actual create calls.
 */
export function CreatePageDialog({
  open,
  onClose,
  workspaceId,
  onCreatePage,
  onCreateFromTemplate,
  isCreating = false,
}: Props) {
  const [rawQuery, setRawQuery] = useState('')
  const [selected, setSelected] = useState<TemplateSummary | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const trimmed = rawQuery.trim().slice(0, MAX_QUERY)
  const debounced = useDebouncedValue(trimmed, DEBOUNCE_MS)
  const isSearching = trimmed.length > 0

  // Reset transient state and focus the search field whenever the dialog is
  // (re)opened. A microtask defer lets MUI mount the input first.
  useEffect(() => {
    if (open) {
      setRawQuery('')
      setSelected(null)
      const id = globalThis.setTimeout(() => searchRef.current?.focus(), 0)
      return () => globalThis.clearTimeout(id)
    }
    return undefined
  }, [open])

  const searchQuery = trpc.template.search.useQuery(
    { workspaceId, query: debounced },
    { enabled: open && debounced.length > 0, staleTime: 0 },
  )

  const workspaceTemplates = (searchQuery.data?.workspaceTemplates ?? []) as TemplateSummary[]
  const globalTemplates = (searchQuery.data?.globalTemplates ?? []) as TemplateSummary[]

  const handleActivateTemplate = (t: TemplateSummary) => {
    if (isCreating) return
    onCreateFromTemplate(t.id)
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      aria-labelledby={TITLE_ID}
    >
      <DialogTitle
        id={TITLE_ID}
        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}
      >
        Создание страницы
        <IconButton aria-label="Закрыть" size="small" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 0 }}>
        <Box sx={{ p: 2, pb: 1 }}>
          <TemplateSearchInput ref={searchRef} value={rawQuery} onChange={setRawQuery} />
        </Box>

        {isSearching ? (
          <Box sx={{ display: 'flex', minHeight: 320 }}>
            <Box sx={{ flex: 1, minWidth: 0, p: 2, pt: 1, overflow: 'auto', maxHeight: 480 }}>
              <TemplateResultsList
                query={trimmed}
                isLoading={searchQuery.isFetching}
                isError={searchQuery.isError}
                workspaceTemplates={workspaceTemplates}
                globalTemplates={globalTemplates}
                selectedId={selected?.id ?? null}
                onSelect={setSelected}
                onActivate={handleActivateTemplate}
              />
            </Box>
            <Box
              sx={{
                width: 280,
                flexShrink: 0,
                borderLeft: '1px solid',
                borderColor: 'divider',
                display: { xs: 'none', sm: 'block' },
              }}
            >
              <TemplatePreviewPane
                template={selected}
                isCreating={isCreating}
                onUse={handleActivateTemplate}
              />
            </Box>
          </Box>
        ) : (
          <Box sx={{ p: 2, pt: 1 }}>
            <PageTypeGrid
              onSelect={(type) => {
                if (!isCreating) onCreatePage(type)
              }}
            />
          </Box>
        )}
      </DialogContent>
    </Dialog>
  )
}
