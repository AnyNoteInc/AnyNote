import { describe, expect, it } from 'vitest'

import { kindFor } from '../../src/lib/upload-handler'

describe('kindFor — routes a blob MIME to an upload kind', () => {
  it.each(['video/mp4', 'video/webm', 'video/quicktime', 'video/ogg'])(
    'routes %s to media',
    (mime) => {
      expect(kindFor(mime)).toBe('media')
    },
  )

  it.each(['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4'])(
    'routes %s to media',
    (mime) => {
      expect(kindFor(mime)).toBe('media')
    },
  )

  it.each(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])(
    'keeps %s as attachment (images go through the image-paste/attachment path)',
    (mime) => {
      expect(kindFor(mime)).toBe('attachment')
    },
  )

  it.each(['application/pdf', 'application/zip', 'text/plain', '', 'application/octet-stream'])(
    'falls back to attachment for %s',
    (mime) => {
      expect(kindFor(mime)).toBe('attachment')
    },
  )
})
