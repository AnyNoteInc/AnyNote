import { describe, expect, it } from '@jest/globals'
import { getSchema } from '@tiptap/core'
import { generateHTML } from '@tiptap/html'

import { PDF_EXTENSIONS, sanitizeDocForSchema } from './page-pdf.service.js'

const schema = getSchema(PDF_EXTENSIONS)

const render = (content: unknown): string =>
  generateHTML(
    sanitizeDocForSchema(content, schema) as Parameters<typeof generateHTML>[0],
    PDF_EXTENSIONS,
  )

describe('sanitizeDocForSchema', () => {
  it('keeps known nodes and marks untouched', () => {
    const html = render({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Заголовок' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'жирный', marks: [{ type: 'bold' }] }],
        },
      ],
    })
    expect(html).toContain('<h2>Заголовок</h2>')
    expect(html).toContain('<strong>жирный</strong>')
  })

  it('hoists the children of an unknown container (callout) instead of throwing', () => {
    const html = render({
      type: 'doc',
      content: [
        {
          type: 'callout',
          attrs: { emoji: '💡' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'внутри callout' }] }],
        },
      ],
    })
    expect(html).toContain('внутри callout')
  })

  it('unwraps nested unknown containers (columnLayout → column → block)', () => {
    const html = render({
      type: 'doc',
      content: [
        {
          type: 'columnLayout',
          content: [
            {
              type: 'column',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'в колонке' }] }],
            },
          ],
        },
      ],
    })
    expect(html).toContain('в колонке')
  })

  it('degrades an unknown url-bearing leaf (fileAttachment) to a link paragraph', () => {
    const html = render({
      type: 'doc',
      content: [
        {
          type: 'fileAttachment',
          attrs: { url: '/api/files/abc', name: 'договор.pdf', size: 5, mimeType: 'application/pdf' },
        },
      ],
    })
    expect(html).toContain('договор.pdf')
    expect(html).toContain('href="/api/files/abc"')
  })

  it('replaces an unknown inline atom (mention) with its label text', () => {
    const html = render({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Привет, ' },
            { type: 'mention', attrs: { id: 'u1', label: 'Виктор' } },
          ],
        },
      ],
    })
    expect(html).toContain('Привет, ')
    expect(html).toContain('Виктор')
  })

  it('drops unknown marks but keeps the text', () => {
    const html = render({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'цветной', marks: [{ type: 'anynoteTextColor', attrs: { color: 'red' } }] }],
        },
      ],
    })
    expect(html).toContain('цветной')
  })

  it('wraps hoisted inline content in a paragraph at the top level (detailsSummary)', () => {
    const doc = sanitizeDocForSchema(
      {
        type: 'doc',
        content: [
          {
            type: 'details',
            content: [
              { type: 'detailsSummary', content: [{ type: 'text', text: 'Сводка' }] },
              {
                type: 'detailsContent',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Тело' }] }],
              },
            ],
          },
        ],
      },
      schema,
    )
    const html = generateHTML(doc as Parameters<typeof generateHTML>[0], PDF_EXTENSIONS)
    expect(html).toContain('Сводка')
    expect(html).toContain('Тело')
  })

  it('returns a single empty paragraph for an empty / malformed doc', () => {
    expect(sanitizeDocForSchema(null, schema)).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    })
    expect(sanitizeDocForSchema({ type: 'doc' }, schema).content).toHaveLength(1)
  })

  it('renders tables and task lists (known extensions)', () => {
    const html = render({
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'сделано' }] }],
            },
          ],
        },
      ],
    })
    expect(html).toContain('сделано')
    expect(html).toContain('data-checked="true"')
  })
})
