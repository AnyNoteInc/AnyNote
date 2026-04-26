'use client'

import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import Chip from '@mui/material/Chip'

type ChatFileChipProps = {
  name: string
  secondaryLabel?: string
  href?: string
  onDelete?: () => void
}

export function ChatFileChip({ name, secondaryLabel, href, onDelete }: ChatFileChipProps) {
  const label = secondaryLabel ? `${name} • ${secondaryLabel}` : name

  return (
    <Chip
      clickable={Boolean(href)}
      component={href ? 'a' : 'div'}
      href={href}
      icon={<DescriptionOutlinedIcon fontSize="small" />}
      label={label}
      onDelete={onDelete}
      rel={href ? 'noreferrer' : undefined}
      size="small"
      sx={{
        maxWidth: '100%',
        '& .MuiChip-label': {
          display: 'block',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        },
      }}
      target={href ? '_blank' : undefined}
      variant="outlined"
    />
  )
}
