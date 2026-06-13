import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it } from 'vitest'

import { AudioSchema } from './audio.schema'
import { VideoSchema } from './video.schema'
import {
  MEDIA_ACCEPT,
  attachmentToMediaNode,
  inferMediaKind,
  mediaToAttachmentNode,
} from './media-mime'

// The schema-only variants are what get registered in the SERVER extension set
// (server.ts → buildServerExtensions). They must round-trip and build without
// throwing — an unregistered custom node crashes the server `generateHTML`.
const schema = getSchema([StarterKit, VideoSchema, AudioSchema])

const mediaAttrs = {
  url: '/api/files/abc',
  name: 'clip.mp4',
  size: 12345,
  mimeType: 'video/mp4',
}

describe('media schema nodes (video / audio)', () => {
  it('registers both nodes in the schema', () => {
    expect(schema.nodes.video).toBeDefined()
    expect(schema.nodes.audio).toBeDefined()
  })

  it('round-trips video attrs through nodeFromJSON', () => {
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'video', attrs: { ...mediaAttrs, width: 480 } }],
    })
    const node = doc.firstChild!
    expect(node.type.name).toBe('video')
    expect(node.attrs.url).toBe('/api/files/abc')
    expect(node.attrs.name).toBe('clip.mp4')
    expect(node.attrs.size).toBe(12345)
    expect(node.attrs.mimeType).toBe('video/mp4')
    expect(node.attrs.width).toBe(480)
  })

  it('round-trips audio attrs through nodeFromJSON', () => {
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'audio', attrs: { ...mediaAttrs, name: 'song.mp3', mimeType: 'audio/mpeg' } }],
    })
    const node = doc.firstChild!
    expect(node.type.name).toBe('audio')
    expect(node.attrs.name).toBe('song.mp3')
    expect(node.attrs.mimeType).toBe('audio/mpeg')
  })

  it('does not render uploadId to the DOM (transient marker)', () => {
    const videoType = schema.nodes.video!
    const node = videoType.create({ ...mediaAttrs, uploadId: 'paste-9' })
    const dom = videoType.spec.toDOM!(node) as [string, Record<string, string>, ...unknown[]]
    expect(JSON.stringify(dom)).not.toContain('paste-9')
    expect(JSON.stringify(dom)).not.toContain('uploadId')
  })

  it('server renders video as a download link (no <video> tag) carrying url/name', () => {
    const videoType = schema.nodes.video!
    const node = videoType.create(mediaAttrs)
    const dom = videoType.spec.toDOM!(node) as [string, Record<string, string>, ...unknown[]]
    // An <a download href> card — NOT a <video> element (no media playback in PDF/HTML export).
    expect(dom[0]).not.toBe('video')
    const flat = JSON.stringify(dom)
    expect(flat).toContain('/api/files/abc')
    expect(flat).toContain('clip.mp4')
  })

  it('server renders audio as a download link (no <audio> tag)', () => {
    const audioType = schema.nodes.audio!
    const node = audioType.create({ ...mediaAttrs, name: 'song.mp3', mimeType: 'audio/mpeg' })
    const dom = audioType.spec.toDOM!(node) as [string, Record<string, string>, ...unknown[]]
    expect(dom[0]).not.toBe('audio')
    expect(JSON.stringify(dom)).toContain('song.mp3')
  })

  it('drops a javascript: url from the export href (no XSS in PDF/HTML)', () => {
    const videoType = schema.nodes.video!
    const node = videoType.create({ ...mediaAttrs, url: 'javascript:alert(1)' })
    const dom = videoType.spec.toDOM!(node) as [string, Record<string, string>, ...unknown[]]
    expect(dom[1].href).toBe('')
    expect(JSON.stringify(dom)).not.toContain('javascript:')
  })

  it('parses a serialized video node back from its DOM attrs', () => {
    const videoType = schema.nodes.video!
    const rule = (videoType.spec.parseDOM ?? [])[0]
    expect(rule).toBeDefined()
    const fakeEl = {
      getAttribute: (key: string) =>
        ({
          'data-url': '/api/files/xyz',
          'data-name': 'movie.webm',
          'data-size': '999',
          'data-mime': 'video/webm',
        })[key] ?? null,
    }
    const parsed = (rule!.getAttrs as (el: unknown) => Record<string, unknown>)(fakeEl)
    expect(parsed.url).toBe('/api/files/xyz')
    expect(parsed.name).toBe('movie.webm')
    expect(parsed.size).toBe(999)
    expect(parsed.mimeType).toBe('video/webm')
  })
})

describe('inferMediaKind (upload routing)', () => {
  it('routes video/* to the video node', () => {
    expect(inferMediaKind('video/mp4')).toBe('video')
    expect(inferMediaKind('video/quicktime')).toBe('video')
  })

  it('routes audio/* to the audio node', () => {
    expect(inferMediaKind('audio/mpeg')).toBe('audio')
    expect(inferMediaKind('audio/wav')).toBe('audio')
  })

  it('keeps image/* on the image path', () => {
    expect(inferMediaKind('image/png')).toBe('image')
  })

  it('everything else is a plain file attachment', () => {
    expect(inferMediaKind('application/pdf')).toBe('file')
    expect(inferMediaKind('')).toBe('file')
  })

  it('MEDIA_ACCEPT covers video and audio for the file picker', () => {
    expect(MEDIA_ACCEPT).toContain('video/')
    expect(MEDIA_ACCEPT).toContain('audio/')
  })
})

describe('attachment ↔ media convert swap (pure node-type swap)', () => {
  const attachment = {
    url: '/api/files/abc',
    name: 'clip.mp4',
    size: 12345,
    mimeType: 'video/mp4',
    ext: 'mp4',
  }

  it('swaps a video-mime fileAttachment to a video node keeping url/name/size/mimeType', () => {
    const swapped = attachmentToMediaNode(attachment)
    expect(swapped).toEqual({
      type: 'video',
      attrs: {
        url: '/api/files/abc',
        name: 'clip.mp4',
        size: 12345,
        mimeType: 'video/mp4',
      },
    })
  })

  it('swaps an audio-mime fileAttachment to an audio node', () => {
    const swapped = attachmentToMediaNode({ ...attachment, name: 'song.mp3', mimeType: 'audio/mpeg' })
    expect(swapped?.type).toBe('audio')
    expect(swapped?.attrs.name).toBe('song.mp3')
  })

  it('returns null for a non-media mime (cannot play a pdf)', () => {
    expect(attachmentToMediaNode({ ...attachment, mimeType: 'application/pdf', ext: 'pdf' })).toBeNull()
  })

  it('reverses a video node back to a fileAttachment keeping url/name/size/mimeType + derived ext', () => {
    const back = mediaToAttachmentNode({
      url: '/api/files/abc',
      name: 'clip.mp4',
      size: 12345,
      mimeType: 'video/mp4',
    })
    expect(back).toEqual({
      type: 'fileAttachment',
      attrs: {
        url: '/api/files/abc',
        name: 'clip.mp4',
        size: 12345,
        mimeType: 'video/mp4',
        ext: 'mp4',
      },
    })
  })
})
