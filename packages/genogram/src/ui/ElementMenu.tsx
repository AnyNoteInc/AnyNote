import { Menu, MenuItem } from '@mui/material'
import type { BloodRelation, PersonRole, PersonSize } from '../types/domain'
import { RU } from '../i18n/ru'

export type ElementAction = 'edit-data' | 'edit-owner' | 'add-partner' | 'add-parents'

interface Props {
  open: boolean
  anchorEl: HTMLElement | null
  personSize: PersonSize
  personRole: PersonRole
  /**
   * Determines whether the person is a "predecessor" (blood-related parent
   * of the owner — bloodRelation='direct') or a "partner" (married into the
   * family — bloodRelation='partner'). Drives both the edit-data label and
   * the available menu items.
   */
  bloodRelation: BloodRelation
  hasParents: boolean
  onClose: () => void
  onAction: (action: ElementAction) => void
}

export function ElementMenu({
  open,
  anchorEl,
  personSize,
  personRole,
  bloodRelation,
  hasParents,
  onClose,
  onAction,
}: Readonly<Props>) {
  const items = buildMenuItems({ personSize, personRole, bloodRelation, hasParents })

  return (
    <Menu open={open} anchorEl={anchorEl} onClose={onClose}>
      {items.map((it) => (
        <MenuItem
          key={it.action}
          onClick={() => {
            onAction(it.action)
            onClose()
          }}
        >
          {it.label}
        </MenuItem>
      ))}
    </Menu>
  )
}

type MenuItemSpec = { action: ElementAction; label: string }

function buildMenuItems({
  personSize,
  personRole,
  bloodRelation,
  hasParents,
}: {
  personSize: PersonSize
  personRole: PersonRole
  bloodRelation: BloodRelation
  hasParents: boolean
}): MenuItemSpec[] {
  if (personSize === 'small') {
    return [{ action: 'edit-data', label: RU.menu.editData }]
  }
  if (personRole === 'owner') {
    return [
      { action: 'edit-owner', label: RU.menu.editOwnerData },
      { action: 'add-partner', label: RU.menu.addPartner },
    ]
  }
  if (bloodRelation === 'partner') {
    // Partners (married-in, not blood-related) only get the data form —
    // they live under their base, so adding new unions / parents from here
    // would be confusing.
    return [{ action: 'edit-data', label: RU.menu.editPartnerData }]
  }
  if (bloodRelation === 'direct') {
    // Predecessors — direct ancestors of the owner — keep the full set of
    // family-tree actions with predecessor-specific edit label.
    const items: MenuItemSpec[] = [
      { action: 'edit-data', label: RU.menu.editPredecessorData },
      { action: 'add-partner', label: RU.menu.addPartner },
    ]
    if (!hasParents) items.push({ action: 'add-parents', label: RU.menu.addParents })
    return items
  }
  // sibling / unknown — fallback to the generic action set.
  const items: MenuItemSpec[] = [
    { action: 'edit-data', label: RU.menu.editData },
    { action: 'add-partner', label: RU.menu.addPartner },
  ]
  if (!hasParents) items.push({ action: 'add-parents', label: RU.menu.addParents })
  return items
}
