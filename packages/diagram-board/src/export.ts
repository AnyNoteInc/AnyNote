/** Base64 data URL for an SVG markup string (UTF-8 safe). */
export function svgStringToDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return `data:image/svg+xml;base64,${btoa(binary)}`
}

/** `<prefix>-<epoch-ms>.<ext>` */
export function downloadFilename(prefix: string, ext: 'svg' | 'png'): string {
  return `${prefix}-${Date.now()}.${ext}`
}

/** Trigger a browser download of a Blob or data URL. */
export function triggerDownload(href: string, filename: string): void {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/**
 * Rasterize an SVG markup string to a PNG Blob via an offscreen <canvas>.
 * `scale` upsamples for crispness. Browser-only.
 */
export function svgToPngBlob(svg: string, width: number, height: number, scale = 2): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('canvas 2d context unavailable'))
        return
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('canvas toBlob returned null'))
      }, 'image/png')
    }
    img.onerror = () => reject(new Error('failed to load SVG into image'))
    img.src = svgStringToDataUrl(svg)
  })
}
