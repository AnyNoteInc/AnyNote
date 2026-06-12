import { Box } from '@repo/ui/components'

import { pageIconImageUrl } from './page-icon-format'

/*
 * The single page-icon renderer (Phase 9A): parses the `Page.icon` format and
 * renders an emoji span (the historical rendering) or a rounded `object-fit:
 * cover` <img> for `url:`-prefixed image icons. No hooks/handlers, so server
 * components (the public share view) can render it too.
 */

type Props = {
  icon: string | null | undefined
  /** Square side in px — image dimensions / emoji font size. */
  size?: number
  /** Emoji shown when `icon` is empty; omit to render nothing. */
  fallback?: string | null
}

export function PageIcon({ icon, size = 16, fallback = null }: Props) {
  const value = icon || fallback
  if (!value) return null

  const imageUrl = pageIconImageUrl(value)
  if (imageUrl) {
    return (
      <Box
        component="img"
        src={imageUrl}
        alt=""
        sx={{
          width: size,
          height: size,
          borderRadius: size >= 32 ? 1 : 0.5,
          objectFit: 'cover',
          flexShrink: 0,
          display: 'block',
        }}
      />
    )
  }

  return (
    <Box
      component="span"
      sx={{
        fontSize: size,
        lineHeight: 1,
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {value}
    </Box>
  )
}
