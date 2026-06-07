'use client'

import {
  BookmarkIcon,
  CampaignIcon,
  DashboardIcon,
  LaptopIcon,
  MenuBookIcon,
  WorkOutlineIcon,
} from '@repo/ui/components'

const ICONS: Record<
  string,
  React.ComponentType<{ sx?: object; fontSize?: 'small' | 'inherit' }>
> = {
  WorkOutlineIcon,
  LaptopIcon,
  DashboardIcon,
  MenuBookIcon,
  CampaignIcon,
  BookmarkIcon,
}

export function TagIcon({
  name,
  ...rest
}: {
  name: string
  sx?: object
  fontSize?: 'small' | 'inherit'
}) {
  const Cmp = ICONS[name]
  return Cmp ? <Cmp {...rest} /> : null
}
