import fs from 'node:fs/promises'
import path from 'node:path'

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'qa-pages')

export type SeededPage = { id: string; title: string; blocks: string[] }

export async function seedQaPages(workspaceId: string, userId: string): Promise<SeededPage[]> {
  const { prisma } = await import('../../../packages/db/src/index')
  const manifestRaw = await fs.readFile(path.join(FIXTURE_DIR, 'manifest.json'), 'utf8')
  const manifest = JSON.parse(manifestRaw) as { title_to_file: Record<string, string> }
  const created: SeededPage[] = []
  for (const [title, file] of Object.entries(manifest.title_to_file)) {
    const md = await fs.readFile(path.join(FIXTURE_DIR, file), 'utf8')
    const blocks = md.split('\n\n').filter(Boolean)
    const page = await prisma.page.create({
      data: {
        workspaceId,
        title,
        type: 'TEXT',
        ownership: 'TEXT',
        content: {
          type: 'doc',
          content: blocks.map((b) => ({
            type: 'paragraph',
            content: [{ type: 'text', text: b }],
          })),
        } as object,
        contentYjs: Buffer.from(''), // empty; Yjs not needed for fixtures
        createdById: userId,
      },
    })
    created.push({ id: page.id, title, blocks })
  }
  return created
}
