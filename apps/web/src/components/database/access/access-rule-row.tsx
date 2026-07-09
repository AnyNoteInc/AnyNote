'use client'

import {
  Box,
  DeleteIcon,
  FormControl,
  IconButton,
  MenuItem,
  Select,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@repo/ui/components'

import type { AccessRuleView, DatabaseAccessLevelValue } from './access-levels'
import { ACCESS_LEVEL_OPTIONS } from './access-levels'

interface AccessRuleRowProps {
  readonly rule: AccessRuleView
  /** Display name of the rule's target property (resolved from the schema). */
  readonly propertyName: string
  /** Disable all edit affordances (insufficient rights / locked structure). */
  readonly disabled?: boolean
  /** Tooltip shown over the disabled controls (locked vs. insufficient rights). */
  readonly disabledReason?: string
  readonly busy?: boolean
  readonly onChangeLevel: (ruleId: string, accessLevel: DatabaseAccessLevelValue) => void
  readonly onToggleEnabled: (ruleId: string, enabled: boolean) => void
  readonly onDelete: (ruleId: string) => void
}

/**
 * One page-level access rule: the target property's name + an access-level Select
 * + an "enabled" Switch + a delete button. The level Select / Switch / delete map
 * straight to `updateAccessRule` / `deleteAccessRule`. All controls disable (with a
 * tooltip) when the viewer can't edit the structure (insufficient rights or a
 * locked structure) — the authoritative gate is server-side, this is affordance only.
 */
export function AccessRuleRow({
  rule,
  propertyName,
  disabled = false,
  disabledReason,
  busy = false,
  onChangeLevel,
  onToggleEnabled,
  onDelete,
}: AccessRuleRowProps) {
  const controlsDisabled = disabled || busy

  const deleteButton = (
    <span>
      <IconButton
        size="small"
        aria-label="Удалить правило"
        disabled={controlsDisabled}
        onClick={() => onDelete(rule.id)}
      >
        <DeleteIcon fontSize="small" />
      </IconButton>
    </span>
  )

  return (
    <Stack direction="row" spacing={1} sx={{ py: 0.5, alignItems: 'center' }}>
      <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
        <Typography variant="body2" noWrap title={propertyName}>
          {propertyName}
        </Typography>
      </Box>

      <FormControl size="small" sx={{ minWidth: 168 }}>
        <Select<DatabaseAccessLevelValue>
          value={rule.accessLevel}
          disabled={controlsDisabled}
          aria-label="Уровень доступа"
          onChange={(e) => onChangeLevel(rule.id, e.target.value as DatabaseAccessLevelValue)}
        >
          {ACCESS_LEVEL_OPTIONS.map((opt) => (
            <MenuItem key={opt.value} value={opt.value}>
              {opt.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <Tooltip title={disabled && disabledReason ? disabledReason : 'Включено'}>
        <span>
          <Switch
            size="small"
            checked={rule.enabled}
            disabled={controlsDisabled}

            onChange={(e) => onToggleEnabled(rule.id, e.target.checked)}
            slotProps={{ input: { 'aria-label': 'Правило включено' } }}
          />
        </span>
      </Tooltip>

      {disabled && disabledReason ? (
        <Tooltip title={disabledReason}>{deleteButton}</Tooltip>
      ) : (
        deleteButton
      )}
    </Stack>
  )
}
