// Pure-unit tests for the image ↔ fileAttachment swap converters (the
// «вставка как файла или изображения» pair). The video/audio pair is pinned
// implicitly by file-upload.routing.test.tsx; these pin the new direction.

import { describe, expect, it } from 'vitest'

import {
  attachmentToImageNode,
  attachmentToMediaNode,
  imageToAttachmentNode,
  inferMediaKind,
} from './media-mime'

describe('imageToAttachmentNode', () => {
  it('keeps the uploaded metadata and derives ext from the name', () => {
    const swap = imageToAttachmentNode({
      src: '/api/files/abc',
      name: 'фото.png',
      size: 1234,
      mimeType: 'image/png',
    })
    expect(swap).toEqual({
      type: 'fileAttachment',
      attrs: {
        url: '/api/files/abc',
        name: 'фото.png',
        size: 1234,
        mimeType: 'image/png',
        ext: 'png',
      },
    })
  })

  it('falls back to a generic name with the mime subtype for legacy images', () => {
    const swap = imageToAttachmentNode({ src: '/api/files/abc', mimeType: 'image/jpeg' })
    expect(swap?.attrs.name).toBe('изображение.jpeg')
    expect(swap?.attrs.ext).toBe('jpeg')
    expect(swap?.attrs.size).toBe(0)
  })

  it('falls back to a bare generic name without any mime', () => {
    const swap = imageToAttachmentNode({ src: '/api/files/abc' })
    expect(swap?.attrs.name).toBe('изображение')
    // The synthetic mime still reads as an image so the reverse swap stays offered.
    expect(inferMediaKind(swap!.attrs.mimeType)).toBe('image')
  })

  it('returns null for a placeholder without a src', () => {
    expect(imageToAttachmentNode({ src: null, mimeType: 'image/png' })).toBeNull()
  })
})

describe('attachmentToImageNode', () => {
  it('swaps an image/* attachment to an image node keeping metadata', () => {
    const swap = attachmentToImageNode({
      url: '/api/files/abc',
      name: 'фото.png',
      size: 1234,
      mimeType: 'image/png',
      ext: 'png',
    })
    expect(swap).toEqual({
      type: 'image',
      attrs: { src: '/api/files/abc', name: 'фото.png', size: 1234, mimeType: 'image/png' },
    })
  })

  it('returns null for non-image attachments (the action stays hidden)', () => {
    const pdf = { url: '/f', name: 'doc.pdf', size: 1, mimeType: 'application/pdf', ext: 'pdf' }
    expect(attachmentToImageNode(pdf)).toBeNull()
    // video/* keeps routing to the media swap instead.
    const vid = { url: '/f', name: 'v.mp4', size: 1, mimeType: 'video/mp4', ext: 'mp4' }
    expect(attachmentToImageNode(vid)).toBeNull()
    expect(attachmentToMediaNode(vid)?.type).toBe('video')
  })

  it('round-trips image → attachment → image', () => {
    const attachment = imageToAttachmentNode({
      src: '/api/files/abc',
      name: 'фото.png',
      size: 5,
      mimeType: 'image/png',
    })!
    const image = attachmentToImageNode(attachment.attrs)
    expect(image?.attrs.src).toBe('/api/files/abc')
    expect(image?.attrs.name).toBe('фото.png')
    expect(image?.attrs.mimeType).toBe('image/png')
  })
})
