import { ImageResponse } from 'next/og'

import { renderBrandIconArt } from '@/lib/brand-icon'

export const size = {
  width: 512,
  height: 512,
}

export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(renderBrandIconArt(size.width), size)
}
