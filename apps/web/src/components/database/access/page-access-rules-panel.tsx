'use client'

import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import type { DatabaseSchema } from '../types'
import { AccessRuleRow } from './access-rule-row'
import { ACCESS_LEVEL_OPTIONS } from './access-levels'
import type { DatabaseAccessLevelValue } from './access-levels'

interface PageAccessRulesPanelProps {
  readonly pageId: string
  readonly properties: DatabaseSchema['properties']
  /** Disable every edit affordance (insufficient rights / locked structure). */
  readonly disabled?: boolean
  /** Tooltip / hint shown when controls are disabled. */
  readonly disabledReason?: string
}

// A rule may only target a PERSON or a CREATED_BY property (the resolver matches a
// viewer's userId against the person cell / the row creator).
const RULE_TARGET_TYPES: ReadonlySet<string> = new Set(['PERSON', 'CREATED_BY'])

/**
 * Page-level (row-level) access rules editor. Lists the persisted rules
 * (`database.listAccessRules`) — each row shows the target property's name, an
 * access-level Select, an enabled Switch, and a delete button — plus an
 * "Добавить правило" control that picks a PERSON/CREATED_BY property + a level and
 * calls `createAccessRule`. Every mutation invalidates `getByPage` (so `myAccess`
 * and any row-level filtering refresh) and `listAccessRules`.
 *
 * These rules restrict access to ROWS on the server; this is deliberately NOT the
 * same as column (property) visibility, which is display-only — the helper copy
 * makes that distinction explicit.
 */
export function PageAccessRulesPanel({
  pageId,
  properties,
  disabled = false,
  disabledReason,
}: PageAccessRulesPanelProps) {
  const utils = trpc.useUtils()
  const rulesQuery = trpc.database.listAccessRules.useQuery({ pageId })

  const targetProperties = useMemo(
    () => properties.filter((p) => RULE_TARGET_TYPES.has(p.type)),
    [properties],
  )
  const propertyNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of properties) map.set(p.id, p.name)
    return map
  }, [properties])

  const [newPropertyId, setNewPropertyId] = useState('')
  const [newLevel, setNewLevel] = useState<DatabaseAccessLevelValue>('CAN_VIEW')

  const invalidate = async () => {
    await Promise.all([
      utils.database.listAccessRules.invalidate({ pageId }),
      utils.database.getByPage.invalidate({ pageId }),
      utils.database.listRows.invalidate({ pageId }),
    ])
  }

  const createRule = trpc.database.createAccessRule.useMutation({
    onSuccess: async () => {
      setNewPropertyId('')
      setNewLevel('CAN_VIEW')
      await invalidate()
    },
  })
  const updateRule = trpc.database.updateAccessRule.useMutation({ onSuccess: invalidate })
  const deleteRule = trpc.database.deleteAccessRule.useMutation({ onSuccess: invalidate })

  const busy = createRule.isPending || updateRule.isPending || deleteRule.isPending
  const rules = rulesQuery.data ?? []

  function addRule() {
    if (!newPropertyId) return
    createRule.mutate({ pageId, propertyId: newPropertyId, accessLevel: newLevel })
  }

  return (
    <Stack spacing={1.5} sx={{ minWidth: 360 }}>
      <Alert severity="info" variant="outlined">
        Эти правила ограничивают доступ к строкам на сервере. Это не то же самое, что видимость
        колонок (отображение).
      </Alert>

      {rulesQuery.isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress size={20} />
        </Box>
      ) : rules.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Правил доступа пока нет. Все участники со своими правами видят все строки.
        </Typography>
      ) : (
        <Stack divider={<Divider flexItem />}>
          {rules.map((rule) => (
            <AccessRuleRow
              key={rule.id}
              rule={rule}
              propertyName={propertyNameById.get(rule.propertyId) ?? 'Свойство удалено'}
              disabled={disabled}
              disabledReason={disabledReason}
              busy={busy}
              onChangeLevel={(ruleId, accessLevel) =>
                updateRule.mutate({ pageId, ruleId, accessLevel })
              }
              onToggleEnabled={(ruleId, enabled) => updateRule.mutate({ pageId, ruleId, enabled })}
              onDelete={(ruleId) => deleteRule.mutate({ pageId, ruleId })}
            />
          ))}
        </Stack>
      )}

      <Divider />

      <Stack spacing={1}>
        <Typography variant="subtitle2">Добавить правило</Typography>
        {targetProperties.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            Добавьте свойство «Участник» или «Создатель», чтобы создать правило доступа.
          </Typography>
        ) : (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <FormControl size="small" sx={{ minWidth: 160 }} disabled={disabled}>
              <InputLabel id="access-rule-property-label">Свойство</InputLabel>
              <Select
                labelId="access-rule-property-label"
                label="Свойство"
                value={newPropertyId}
                onChange={(e) => setNewPropertyId(e.target.value)}
              >
                {targetProperties.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 168 }} disabled={disabled}>
              <InputLabel id="access-rule-level-label">Уровень</InputLabel>
              <Select<DatabaseAccessLevelValue>
                labelId="access-rule-level-label"
                label="Уровень"
                value={newLevel}
                onChange={(e) => setNewLevel(e.target.value as DatabaseAccessLevelValue)}
              >
                {ACCESS_LEVEL_OPTIONS.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Button
              size="small"
              variant="contained"
              disabled={disabled || !newPropertyId || createRule.isPending}
              onClick={addRule}
            >
              Добавить
            </Button>
          </Stack>
        )}
      </Stack>
    </Stack>
  )
}
