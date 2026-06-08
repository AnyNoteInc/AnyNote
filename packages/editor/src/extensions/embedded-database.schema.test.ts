import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'

import { EmbeddedDatabaseSchema, type EmbeddedDatabaseAttrs } from './embedded-database.schema'

// The schema-only node is what gets registered in the SERVER extension set
// (server.ts → buildServerExtensions). The load-bearing guarantee is that a
// document containing an `embeddedDatabase` node can be built and rendered with
// that extension set WITHOUT throwing (an unregistered custom node makes the
// server `generateHTML` crash — it did for columnLayout before; see memory).
const schema = getSchema([StarterKit, EmbeddedDatabaseSchema])

const docWithEmbed = (attrs?: Partial<EmbeddedDatabaseAttrs>) => ({
  type: 'doc',
  content: [
    {
      type: 'embeddedDatabase',
      attrs: {
        sourceId: 'src-1',
        viewId: 'view-1',
        displayMode: 'table',
        readonly: false,
        ...attrs,
      },
    },
  ],
})

describe('embeddedDatabase schema node', () => {
  it('is registered in the schema (server extension set can resolve it)', () => {
    expect(schema.nodes.embeddedDatabase).toBeDefined()
  })

  it('builds a doc containing the node without throwing', () => {
    expect(() => schema.nodeFromJSON(docWithEmbed())).not.toThrow()
  })

  it('round-trips attrs through nodeFromJSON', () => {
    const node = schema.nodeFromJSON(docWithEmbed({ readonly: true }))
    const embed = node.firstChild!
    expect(embed.type.name).toBe('embeddedDatabase')
    expect(embed.attrs.sourceId).toBe('src-1')
    expect(embed.attrs.viewId).toBe('view-1')
    expect(embed.attrs.displayMode).toBe('table')
    expect(embed.attrs.readonly).toBe(true)
  })

  it('defaults attrs when absent', () => {
    const node = schema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'embeddedDatabase' }],
    })
    const embed = node.firstChild!
    expect(embed.attrs.sourceId).toBeNull()
    expect(embed.attrs.viewId).toBeNull()
    expect(embed.attrs.displayMode).toBe('table')
    expect(embed.attrs.readonly).toBe(false)
  })

  it('serializes to a div[data-type="embedded-database"] carrying source/view ids', () => {
    const node = schema.nodeFromJSON(docWithEmbed()).firstChild!
    const dom = EmbeddedDatabaseSchema.config.renderHTML!.call(
      // The extension's renderHTML reads node.attrs; only that is needed here.
      {} as never,
      { HTMLAttributes: {}, node } as never,
    ) as [string, Record<string, string>, ...unknown[]]
    expect(dom[0]).toBe('div')
    expect(dom[1]['data-type']).toBe('embedded-database')
    expect(dom[1]['data-source-id']).toBe('src-1')
    expect(dom[1]['data-view-id']).toBe('view-1')
  })
})
