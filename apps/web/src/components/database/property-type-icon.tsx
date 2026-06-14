'use client'

import {
  AccountTreeIcon,
  AttachFileIcon,
  CalculateIcon,
  CalendarTodayIcon,
  CheckBoxIcon,
  EmailIcon,
  FilterListIcon,
  LabelIcon,
  LinkIcon,
  LocalPhoneIcon,
  NumbersIcon,
  PersonIcon,
  TextFieldsIcon,
  TocIcon,
  UpdateIcon,
} from '@repo/ui/components'
import type { SvgIconProps } from '@repo/ui/components'
import type { DatabasePropertyType } from '@repo/db'

import type { ComponentType } from 'react'

/**
 * Single source of truth for the property-type → MUI icon mapping used across the
 * database UI (the "+ Свойство" menu in `database-toolbar`, the visibility panel,
 * filter/sort builders…). Keeping it here means the same `STATUS → LabelIcon`,
 * `DATE → CalendarTodayIcon`… vocabulary can't drift between surfaces.
 */
const ICON_BY_TYPE: Record<DatabasePropertyType, ComponentType<SvgIconProps>> = {
  TEXT: TextFieldsIcon,
  NUMBER: NumbersIcon,
  STATUS: LabelIcon,
  SELECT: LabelIcon,
  MULTI_SELECT: LabelIcon,
  CHECKBOX: CheckBoxIcon,
  DATE: CalendarTodayIcon,
  PERSON: PersonIcon,
  FILE: AttachFileIcon,
  URL: LinkIcon,
  EMAIL: EmailIcon,
  PHONE: LocalPhoneIcon,
  PAGE_LINK: TocIcon,
  FORMULA: CalculateIcon,
  RELATION: AccountTreeIcon,
  ROLLUP: FilterListIcon,
  CREATED_TIME: CalendarTodayIcon,
  CREATED_BY: PersonIcon,
  LAST_EDITED_TIME: UpdateIcon,
  LAST_EDITED_BY: PersonIcon,
}

interface PropertyTypeIconProps extends SvgIconProps {
  readonly type: DatabasePropertyType
}

/**
 * Renders the icon for a property type. The icon is decorative — the property name
 * always accompanies it — so it is marked `aria-hidden` by default; callers may
 * override via props (e.g. `fontSize`, `sx`, `color`).
 */
export function PropertyTypeIcon({ type, ...props }: PropertyTypeIconProps) {
  const Icon = ICON_BY_TYPE[type] ?? TextFieldsIcon
  return <Icon fontSize="small" aria-hidden {...props} />
}
