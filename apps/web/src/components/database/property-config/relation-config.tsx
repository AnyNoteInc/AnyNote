'use client'

import { useMemo } from 'react'
import {
  Box,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

// Type-only mirror of the dto `RelationSettings` shape (importing the dto runtime
// drags the @repo/db/pg adapter into the client bundle).
export interface RelationSettings {
  targetSourceId: string
  backRelationPropertyId?: string
}

interface RelationConfigProps {
  readonly workspaceId: string
  /** This property's own source id, excluded from the target picker. */
  readonly selfSourceId: string | undefined
  readonly value: RelationSettings | undefined
  readonly onChange: (next: RelationSettings | undefined) => void
  readonly disabled?: boolean
}

const NONE = '__none__'

/**
 * Configure a RELATION property: pick the target database SOURCE (another DATABASE
 * page's source in the same workspace, via `database.listSources`) and optionally
 * mirror it onto an existing RELATION property of the target ("обратная связь").
 *
 * Limitation: the backend does NOT auto-create a mirror property, so the
 * back-relation toggle only links to an EXISTING RELATION property on the target
 * source — if the target has none, the toggle is disabled with a hint. Creating a
 * fresh mirror property is deferred (see the 4B plan note).
 */
export function RelationConfig({
  workspaceId,
  selfSourceId,
  value,
  onChange,
  disabled,
}: RelationConfigProps) {
  const sources = trpc.database.listSources.useQuery(
    { workspaceId },
    { enabled: Boolean(workspaceId), retry: false },
  )

  const candidates = useMemo(
    () => (sources.data ?? []).filter((s) => s.sourceId !== selfSourceId),
    [sources.data, selfSourceId],
  )

  const targetSourceId = value?.targetSourceId ?? ''

  // The target source's RELATION properties are the only valid mirror targets.
  const targetSchema = trpc.database.getBySourceId.useQuery(
    { sourceId: targetSourceId },
    { enabled: Boolean(targetSourceId), retry: false },
  )
  const targetRelationProps = useMemo(
    () => (targetSchema.data?.view.properties ?? []).filter((p) => p.type === 'RELATION'),
    [targetSchema.data],
  )

  function pickTarget(next: string) {
    if (next === NONE) {
      onChange(undefined)
      return
    }
    // Reset the mirror when the target changes — the old property id is invalid.
    onChange({ targetSourceId: next })
  }

  function toggleBackRelation(enabled: boolean) {
    if (!value) return
    if (enabled) {
      const first = targetRelationProps[0]
      onChange({ ...value, backRelationPropertyId: first?.id })
    } else {
      onChange({ targetSourceId: value.targetSourceId })
    }
  }

  function pickMirror(propertyId: string) {
    if (!value) return
    onChange({
      ...value,
      backRelationPropertyId: propertyId === NONE ? undefined : propertyId,
    })
  }

  const backOn = Boolean(value?.backRelationPropertyId)

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Связь
      </Typography>
      <FormControl size="small" fullWidth disabled={disabled || sources.isLoading}>
        <InputLabel id="relation-target-label">Целевая база данных</InputLabel>
        <Select
          labelId="relation-target-label"
          label="Целевая база данных"
          value={targetSourceId || NONE}
          onChange={(e) => pickTarget(String(e.target.value))}
        >
          <MenuItem value={NONE}>
            <em>Не выбрано</em>
          </MenuItem>
          {candidates.map((s) => (
            <MenuItem key={s.sourceId} value={s.sourceId}>
              {s.title || 'Без названия'}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {sources.data && candidates.length === 0 ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          В пространстве нет других баз данных для связи.
        </Typography>
      ) : null}

      {targetSourceId ? (
        <Box sx={{ mt: 1.5 }}>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={backOn}
                disabled={disabled || targetRelationProps.length === 0}
                onChange={(e) => toggleBackRelation(e.target.checked)}
              />
            }
            label="Создать обратную связь"
          />
          {targetRelationProps.length === 0 ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              В целевой базе нет свойства-связи для зеркала. Создайте RELATION-свойство в
              целевой базе, чтобы включить обратную связь.
            </Typography>
          ) : null}
          {backOn ? (
            <FormControl size="small" fullWidth sx={{ mt: 1 }} disabled={disabled}>
              <InputLabel id="relation-mirror-label">Зеркальное свойство</InputLabel>
              <Select
                labelId="relation-mirror-label"
                label="Зеркальное свойство"
                value={value?.backRelationPropertyId ?? NONE}
                onChange={(e) => pickMirror(String(e.target.value))}
              >
                <MenuItem value={NONE}>
                  <em>Не выбрано</em>
                </MenuItem>
                {targetRelationProps.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : null}
        </Box>
      ) : null}
    </Box>
  )
}
