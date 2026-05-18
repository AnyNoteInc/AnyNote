# Create Page From Chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the `createPage` MCP tool with an optional `markdown` parameter so the agent can summarise a chat conversation and persist it as a populated TEXT page in a single confirmed call, then verify the flow end-to-end with Playwright.

**Architecture:** Add an inverse-of-`MarkdownRenderer` parser in `apps/engines` that converts markdown → Tiptap doc JSON. Thread an optional `content` through `PageWriter.createPage` so the page is created with body in one transaction. Update the MCP tool's Zod schema, intent-first description, and response shape (`{ pageId, url }`). UI requires zero changes — `chat-link-renderer.tsx` already turns `/workspaces/.../pages/...` markdown links into in-app `<Link>`s.

**Tech Stack:** NestJS 11 / `@rekog/mcp-nest` / Zod / Prisma 7 / `marked@^14` (matches `@repo/editor`) / Jest (engines) / Playwright (E2E).

**Spec:** [docs/superpowers/specs/2026-05-18-create-page-from-chat-design.md](../specs/2026-05-18-create-page-from-chat-design.md)

---

## File Structure

**Create:**
- `apps/engines/src/apps/mcp/services/markdown-parser.service.ts` — `MarkdownParser` (markdown string → Tiptap doc)
- `apps/engines/src/apps/mcp/services/markdown-parser.service.spec.ts` — unit tests
- `apps/e2e/create-page-from-chat.spec.ts` — full-stack happy-path E2E

**Modify:**
- `apps/engines/package.json` — add `marked` dependency
- `apps/engines/src/apps/mcp/services/page-writer.service.ts` — `CreatePageInput.content?` + persist on initial create
- `apps/engines/src/apps/mcp/services/page-writer.service.spec.ts` — cover the new branch
- `apps/engines/src/apps/mcp/tools/page.tools.ts` — add `markdown` to `CreatePageInput`, parse + persist, return `url`, intent-first description rewrite
- `apps/engines/src/apps/mcp/tools/page.tools.spec.ts` — cover markdown branch + URL response
- `apps/engines/src/apps/mcp/mcp.module.ts` — register `MarkdownParser` as provider

---

## Task 1: Add `marked` to engines dependencies

**Files:**
- Modify: `apps/engines/package.json`

- [ ] **Step 1: Add the dep**

Add `"marked": "^14.1.3"` to the `dependencies` section of `apps/engines/package.json` (matches `packages/editor/package.json`). Sort the key alphabetically with neighbours.

- [ ] **Step 2: Install**

Run:
```bash
pnpm install
```
Expected: lockfile updates, no version conflicts (the editor already uses the same major).

- [ ] **Step 3: Verify the import resolves**

Run:
```bash
pnpm --filter engines exec node -e "import('marked').then((m) => console.log(typeof m.marked.lexer))"
```
Expected output: `function`.

- [ ] **Step 4: Commit**

```bash
git add apps/engines/package.json pnpm-lock.yaml
git commit -m "chore(engines): add marked dependency for markdown parsing"
```

---

## Task 2: `MarkdownParser` — empty input + paragraph + heading

**Files:**
- Create: `apps/engines/src/apps/mcp/services/markdown-parser.service.ts`
- Create: `apps/engines/src/apps/mcp/services/markdown-parser.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/engines/src/apps/mcp/services/markdown-parser.service.spec.ts`:

```ts
import { describe, expect, it } from '@jest/globals'

import { MarkdownParser } from './markdown-parser.service.js'

describe('MarkdownParser', () => {
  const parser = new MarkdownParser()

  it('returns an empty doc for empty / whitespace input', () => {
    expect(parser.parse('')).toEqual({ type: 'doc', content: [] })
    expect(parser.parse('   \n  ')).toEqual({ type: 'doc', content: [] })
  })

  it('parses a single paragraph', () => {
    expect(parser.parse('Hello world')).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }],
    })
  })

  it('parses headings 1–6 with level attrs', () => {
    const doc = parser.parse('# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6')
    expect(doc.content).toHaveLength(6)
    doc.content.forEach((node, idx) => {
      expect(node).toMatchObject({
        type: 'heading',
        attrs: { level: idx + 1 },
        content: [{ type: 'text', text: `H${idx + 1}` }],
      })
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
pnpm --filter engines test src/apps/mcp/services/markdown-parser.service.spec.ts
```
Expected: FAIL with "Cannot find module './markdown-parser.service.js'".

- [ ] **Step 3: Implement the parser skeleton**

Create `apps/engines/src/apps/mcp/services/markdown-parser.service.ts`:

```ts
import { Injectable } from '@nestjs/common'
import { marked, type Token, type Tokens } from 'marked'

type Mark = { type: string; attrs?: Record<string, unknown> }

type TiptapNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  text?: string
  marks?: Mark[]
}

export type TiptapDoc = { type: 'doc'; content: TiptapNode[] }

@Injectable()
export class MarkdownParser {
  parse(markdown: string): TiptapDoc {
    if (!markdown || !markdown.trim()) return { type: 'doc', content: [] }
    const tokens = marked.lexer(markdown, { gfm: true })
    return { type: 'doc', content: tokens.flatMap((t) => this.parseBlock(t)) }
  }

  private parseBlock(token: Token): TiptapNode[] {
    switch (token.type) {
      case 'paragraph': {
        const t = token as Tokens.Paragraph
        return [{ type: 'paragraph', content: this.parseInline(t.tokens) }]
      }
      case 'heading': {
        const t = token as Tokens.Heading
        return [
          {
            type: 'heading',
            attrs: { level: Math.max(1, Math.min(6, t.depth)) },
            content: this.parseInline(t.tokens),
          },
        ]
      }
      case 'space':
        return []
      default: {
        const raw = (token as { text?: string }).text ?? ''
        if (!raw) return []
        return [{ type: 'paragraph', content: [{ type: 'text', text: raw }] }]
      }
    }
  }

  private parseInline(tokens: Token[]): TiptapNode[] {
    const out: TiptapNode[] = []
    for (const token of tokens) out.push(...this.parseInlineToken(token, []))
    return out
  }

  private parseInlineToken(token: Token, marks: Mark[]): TiptapNode[] {
    switch (token.type) {
      case 'text': {
        const t = token as Tokens.Text
        if (t.tokens) return t.tokens.flatMap((nested) => this.parseInlineToken(nested, marks))
        return [{ type: 'text', text: t.text, ...(marks.length ? { marks } : {}) }]
      }
      default: {
        const text = (token as { text?: string }).text ?? ''
        if (!text) return []
        return [{ type: 'text', text, ...(marks.length ? { marks } : {}) }]
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
pnpm --filter engines test src/apps/mcp/services/markdown-parser.service.spec.ts
```
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/mcp/services/markdown-parser.service.ts \
        apps/engines/src/apps/mcp/services/markdown-parser.service.spec.ts
git commit -m "feat(engines): MarkdownParser handles paragraphs and headings"
```

---

## Task 3: `MarkdownParser` — bullet list, ordered list, blockquote, code block, hr

**Files:**
- Modify: `apps/engines/src/apps/mcp/services/markdown-parser.service.ts`
- Modify: `apps/engines/src/apps/mcp/services/markdown-parser.service.spec.ts`

- [ ] **Step 1: Add the failing tests**

Append to the existing `describe('MarkdownParser', ...)` block in `markdown-parser.service.spec.ts`:

```ts
  it('parses bullet lists', () => {
    const doc = parser.parse('- one\n- two')
    expect(doc.content).toEqual([
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] },
        ],
      },
    ])
  })

  it('parses ordered lists', () => {
    const doc = parser.parse('1. first\n2. second')
    expect(doc.content[0]).toMatchObject({
      type: 'orderedList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }] },
      ],
    })
  })

  it('parses blockquotes', () => {
    const doc = parser.parse('> quoted line')
    expect(doc.content).toEqual([
      {
        type: 'blockquote',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quoted line' }] }],
      },
    ])
  })

  it('parses fenced code blocks with language', () => {
    const doc = parser.parse('```ts\nconst x = 1\n```')
    expect(doc.content).toEqual([
      {
        type: 'codeBlock',
        attrs: { language: 'ts' },
        content: [{ type: 'text', text: 'const x = 1' }],
      },
    ])
  })

  it('parses fenced code blocks without language', () => {
    const doc = parser.parse('```\nplain\n```')
    expect(doc.content).toEqual([
      {
        type: 'codeBlock',
        attrs: {},
        content: [{ type: 'text', text: 'plain' }],
      },
    ])
  })

  it('parses horizontal rules', () => {
    const doc = parser.parse('---')
    expect(doc.content).toEqual([{ type: 'horizontalRule' }])
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
pnpm --filter engines test src/apps/mcp/services/markdown-parser.service.spec.ts
```
Expected: 6 new failures (the new node types fall through to the default-paragraph branch).

- [ ] **Step 3: Extend the parser**

In `apps/engines/src/apps/mcp/services/markdown-parser.service.ts`, replace the `parseBlock` switch with the full version:

```ts
  private parseBlock(token: Token): TiptapNode[] {
    switch (token.type) {
      case 'paragraph': {
        const t = token as Tokens.Paragraph
        return [{ type: 'paragraph', content: this.parseInline(t.tokens) }]
      }
      case 'heading': {
        const t = token as Tokens.Heading
        return [
          {
            type: 'heading',
            attrs: { level: Math.max(1, Math.min(6, t.depth)) },
            content: this.parseInline(t.tokens),
          },
        ]
      }
      case 'list':
        return [this.parseList(token as Tokens.List)]
      case 'blockquote': {
        const t = token as Tokens.Blockquote
        return [
          {
            type: 'blockquote',
            content: t.tokens.flatMap((child) => this.parseBlock(child)),
          },
        ]
      }
      case 'code': {
        const t = token as Tokens.Code
        return [
          {
            type: 'codeBlock',
            attrs: t.lang ? { language: t.lang } : {},
            content: [{ type: 'text', text: t.text }],
          },
        ]
      }
      case 'hr':
        return [{ type: 'horizontalRule' }]
      case 'space':
        return []
      default: {
        const raw = (token as { text?: string }).text ?? ''
        if (!raw) return []
        return [{ type: 'paragraph', content: [{ type: 'text', text: raw }] }]
      }
    }
  }

  private parseList(token: Tokens.List): TiptapNode {
    return {
      type: token.ordered ? 'orderedList' : 'bulletList',
      content: token.items.map((item) => ({
        type: 'listItem',
        content: item.tokens.flatMap((child) => this.parseBlock(child)),
      })),
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
pnpm --filter engines test src/apps/mcp/services/markdown-parser.service.spec.ts
```
Expected: PASS (9/9).

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/mcp/services/markdown-parser.service.ts \
        apps/engines/src/apps/mcp/services/markdown-parser.service.spec.ts
git commit -m "feat(engines): MarkdownParser handles lists, blockquotes, code, hr"
```

---

## Task 4: `MarkdownParser` — inline marks (bold, italic, code, link) and hardBreak

**Files:**
- Modify: `apps/engines/src/apps/mcp/services/markdown-parser.service.ts`
- Modify: `apps/engines/src/apps/mcp/services/markdown-parser.service.spec.ts`

- [ ] **Step 1: Add the failing tests**

Append to the `describe` block:

```ts
  it('parses bold marks', () => {
    const doc = parser.parse('**bold**')
    expect(doc.content[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'bold', marks: [{ type: 'bold' }] }],
    })
  })

  it('parses italic marks', () => {
    const doc = parser.parse('_italic_')
    expect(doc.content[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'italic', marks: [{ type: 'italic' }] }],
    })
  })

  it('parses inline code marks', () => {
    const doc = parser.parse('use `npm` here')
    expect(doc.content[0]).toMatchObject({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'use ' },
        { type: 'text', text: 'npm', marks: [{ type: 'code' }] },
        { type: 'text', text: ' here' },
      ],
    })
  })

  it('parses link marks with href attr', () => {
    const doc = parser.parse('see [docs](https://example.com) please')
    expect(doc.content[0]).toMatchObject({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'see ' },
        { type: 'text', text: 'docs', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
        { type: 'text', text: ' please' },
      ],
    })
  })

  it('stacks nested marks (bold + italic)', () => {
    const doc = parser.parse('**_both_**')
    const para = doc.content[0]
    expect(para.type).toBe('paragraph')
    const text = para.content?.[0]
    expect(text?.text).toBe('both')
    const markTypes = (text?.marks ?? []).map((m) => m.type).sort()
    expect(markTypes).toEqual(['bold', 'italic'])
  })

  it('parses hard breaks inside paragraphs', () => {
    // Markdown hard break = two trailing spaces + newline
    const doc = parser.parse('line one  \nline two')
    expect(doc.content[0]).toMatchObject({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'line one' },
        { type: 'hardBreak' },
        { type: 'text', text: 'line two' },
      ],
    })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
pnpm --filter engines test src/apps/mcp/services/markdown-parser.service.spec.ts
```
Expected: 6 new failures (inline marks fall through to plain text without marks).

- [ ] **Step 3: Extend the inline walker**

In `apps/engines/src/apps/mcp/services/markdown-parser.service.ts`, replace `parseInlineToken` with the full version:

```ts
  private parseInlineToken(token: Token, marks: Mark[]): TiptapNode[] {
    switch (token.type) {
      case 'text': {
        const t = token as Tokens.Text
        if (t.tokens) return t.tokens.flatMap((nested) => this.parseInlineToken(nested, marks))
        return [{ type: 'text', text: t.text, ...(marks.length ? { marks } : {}) }]
      }
      case 'strong': {
        const t = token as Tokens.Strong
        return t.tokens.flatMap((nested) =>
          this.parseInlineToken(nested, [...marks, { type: 'bold' }]),
        )
      }
      case 'em': {
        const t = token as Tokens.Em
        return t.tokens.flatMap((nested) =>
          this.parseInlineToken(nested, [...marks, { type: 'italic' }]),
        )
      }
      case 'codespan': {
        const t = token as Tokens.Codespan
        return [{ type: 'text', text: t.text, marks: [...marks, { type: 'code' }] }]
      }
      case 'link': {
        const t = token as Tokens.Link
        const linkMark: Mark = { type: 'link', attrs: { href: t.href } }
        return t.tokens.flatMap((nested) =>
          this.parseInlineToken(nested, [...marks, linkMark]),
        )
      }
      case 'br':
        return [{ type: 'hardBreak' }]
      default: {
        const text = (token as { text?: string }).text ?? ''
        if (!text) return []
        return [{ type: 'text', text, ...(marks.length ? { marks } : {}) }]
      }
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
pnpm --filter engines test src/apps/mcp/services/markdown-parser.service.spec.ts
```
Expected: PASS (15/15).

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/mcp/services/markdown-parser.service.ts \
        apps/engines/src/apps/mcp/services/markdown-parser.service.spec.ts
git commit -m "feat(engines): MarkdownParser handles inline marks and hard breaks"
```

---

## Task 5: `MarkdownParser` — round-trip with `MarkdownRenderer`

**Files:**
- Modify: `apps/engines/src/apps/mcp/services/markdown-parser.service.spec.ts`

- [ ] **Step 1: Add the round-trip test**

Append to the `describe` block:

```ts
  it('round-trips through MarkdownRenderer for supported nodes', async () => {
    const { MarkdownRenderer } = await import('./markdown-renderer.service.js')
    const renderer = new MarkdownRenderer()

    const markdown = [
      '# Heading 1',
      '',
      'A paragraph with **bold**, _italic_, `code` and a [link](https://ex.com).',
      '',
      '## Sub',
      '',
      '- one',
      '- two',
      '',
      '1. first',
      '2. second',
      '',
      '> quoted',
      '',
      '```ts',
      'const x = 1',
      '```',
      '',
      '---',
    ].join('\n')

    const doc = parser.parse(markdown)
    const rendered = renderer.render(doc)

    // Renderer output should re-parse back to the same doc.
    expect(parser.parse(rendered)).toEqual(doc)
  })
```

- [ ] **Step 2: Run tests to verify behavior**

Run:
```bash
pnpm --filter engines test src/apps/mcp/services/markdown-parser.service.spec.ts
```
Expected: PASS (16/16). If FAIL, the most likely cause is a minor renderer formatting difference (e.g., italic uses `_x_` vs `*x*`) — adjust the parser's tokenizer options or the test input, not the renderer.

- [ ] **Step 3: Commit**

```bash
git add apps/engines/src/apps/mcp/services/markdown-parser.service.spec.ts
git commit -m "test(engines): MarkdownParser round-trips with MarkdownRenderer"
```

---

## Task 6: Register `MarkdownParser` in the MCP module

**Files:**
- Modify: `apps/engines/src/apps/mcp/mcp.module.ts`

- [ ] **Step 1: Read the module to find the providers list**

Run:
```bash
grep -n "providers" apps/engines/src/apps/mcp/mcp.module.ts
```
Note the exact location and existing entries (e.g., `PageWriter`, `MarkdownRenderer`, `StatsService`).

- [ ] **Step 2: Add the import + provider entry**

In `apps/engines/src/apps/mcp/mcp.module.ts`:

1. Add the import alongside the other service imports:
   ```ts
   import { MarkdownParser } from './services/markdown-parser.service.js'
   ```
2. Add `MarkdownParser` to the `providers` array, sorted alphabetically with neighbours (between `MarkdownRenderer` and `PageWriter`).

- [ ] **Step 3: Run the engines build to verify DI wiring**

Run:
```bash
pnpm --filter engines build
```
Expected: PASS, no NestJS DI errors at compile time.

- [ ] **Step 4: Run the full engines test suite to make sure nothing else broke**

Run:
```bash
pnpm --filter engines test
```
Expected: all existing tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/mcp/mcp.module.ts
git commit -m "chore(engines): register MarkdownParser in MCP module"
```

---

## Task 7: `PageWriter.createPage` accepts optional `content`

**Files:**
- Modify: `apps/engines/src/apps/mcp/services/page-writer.service.ts`
- Modify: `apps/engines/src/apps/mcp/services/page-writer.service.spec.ts`

- [ ] **Step 1: Add a failing test for content-on-create**

Open `apps/engines/src/apps/mcp/services/page-writer.service.spec.ts` and add inside the existing `describe('createPage', ...)` (mirror the style of neighbouring tests — use the same fixture/setup helpers; if there are none, use the existing prisma stub pattern visible at the top of the file):

```ts
  it('persists content when supplied on create', async () => {
    const content = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
    }

    const pageId = await writer.createPage({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      parentId: null,
      title: 'With content',
      content,
    })

    const stored = await prisma.page.findUniqueOrThrow({
      where: { id: pageId },
      select: { content: true, type: true, ownership: true },
    })
    expect(stored.content).toEqual(content)
    expect(stored.type).toBe('TEXT')
    expect(stored.ownership).toBe('TEXT')
  })

  it('leaves content null when not supplied (backwards-compatible)', async () => {
    const pageId = await writer.createPage({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      parentId: null,
      title: 'No content',
    })
    const stored = await prisma.page.findUniqueOrThrow({
      where: { id: pageId },
      select: { content: true },
    })
    expect(stored.content).toBeNull()
  })
```

If the existing spec uses different identifier names (`USER_ID`, `WORKSPACE_ID`, `writer`, `prisma`), match them — do not introduce new ones.

- [ ] **Step 2: Run the failing tests**

Run:
```bash
pnpm --filter engines test src/apps/mcp/services/page-writer.service.spec.ts
```
Expected: the first test fails — `content` is silently dropped because the type doesn't declare it.

- [ ] **Step 3: Extend the type + writer**

In `apps/engines/src/apps/mcp/services/page-writer.service.ts`:

1. Extend `CreatePageInput`:
   ```ts
   export type CreatePageInput = {
     userId: string
     workspaceId: string
     parentId?: string | null
     title: string
     ownership?: 'TEXT' | 'SKILL' | 'AGENT'
     content?: unknown
   }
   ```
2. Inside `createPage`, set `content` on the Prisma create (place it after `ownership` to keep diff localised):
   ```ts
   const page = await tx.page.create({
     data: {
       workspaceId: input.workspaceId,
       parentId: input.parentId ?? null,
       title: input.title,
       ownership: input.ownership ?? 'TEXT',
       type: 'TEXT',
       content: input.content === undefined ? undefined : (input.content as never),
       createdById: input.userId,
       updatedById: input.userId,
     },
     select: { id: true },
   })
   ```
   (Using `undefined` when not supplied lets Prisma skip the field entirely instead of writing JSON null — keeps default behaviour identical.)

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
pnpm --filter engines test src/apps/mcp/services/page-writer.service.spec.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/mcp/services/page-writer.service.ts \
        apps/engines/src/apps/mcp/services/page-writer.service.spec.ts
git commit -m "feat(engines): PageWriter.createPage accepts optional Tiptap content"
```

---

## Task 8: `createPage` MCP tool — add `markdown` parameter, parse + persist, return `url`

**Files:**
- Modify: `apps/engines/src/apps/mcp/tools/page.tools.ts`
- Modify: `apps/engines/src/apps/mcp/tools/page.tools.spec.ts`

- [ ] **Step 1: Add failing tests for the new behaviour**

In `apps/engines/src/apps/mcp/tools/page.tools.spec.ts`, add tests inside the existing `describe('createPage', ...)` (match the existing fixture/mocking style):

```ts
  it('returns the in-app URL alongside pageId', async () => {
    const result = await tools.createPage(
      { title: 'No body', ownership: 'TEXT' },
      {} as never,
      mockMcpRequest(WORKSPACE_ID, USER_ID),
    )

    expect(result.pageId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(result.url).toBe(`/workspaces/${WORKSPACE_ID}/pages/${result.pageId}`)
  })

  it('persists markdown content via MarkdownParser when supplied', async () => {
    const markdown = '# Eggs\n\nWhisk and fry.'

    const { pageId } = await tools.createPage(
      { title: 'Eggs', markdown, ownership: 'TEXT' },
      {} as never,
      mockMcpRequest(WORKSPACE_ID, USER_ID),
    )

    const stored = await prisma.page.findUniqueOrThrow({
      where: { id: pageId },
      select: { content: true },
    })
    expect(stored.content).toEqual({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Eggs' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Whisk and fry.' }] },
      ],
    })
  })

  it('rejects markdown longer than 50 000 chars before writing', async () => {
    const tooLong = 'x'.repeat(50_001)
    await expect(
      tools.createPage(
        { title: 'Too big', markdown: tooLong },
        {} as never,
        mockMcpRequest(WORKSPACE_ID, USER_ID),
      ),
    ).rejects.toThrow(/markdown|50_?000|too/i)
  })
```

If the existing spec doesn't have a `MarkdownParser` in scope for DI, construct the tool with one in the spec's `beforeEach` — mirror how `MarkdownRenderer` is currently wired into the tool instance.

- [ ] **Step 2: Run the failing tests**

Run:
```bash
pnpm --filter engines test src/apps/mcp/tools/page.tools.spec.ts
```
Expected: 3 failures (url not in response, markdown ignored, no length cap).

- [ ] **Step 3: Update the tool**

In `apps/engines/src/apps/mcp/tools/page.tools.ts`:

1. Import the parser at the top with the other service imports:
   ```ts
   import { MarkdownParser } from '../services/markdown-parser.service.js'
   ```
2. Extend the Zod schema:
   ```ts
   const CreatePageInput = z.object({
     parentId: mcpNullableUuidOptional(),
     title: z.string().min(1).max(255),
     ownership: mcpInput(z.enum(['TEXT', 'SKILL', 'AGENT']).default('TEXT')),
     markdown: z.string().max(50_000).optional(),
   })
   ```
3. Inject the parser via the constructor:
   ```ts
   constructor(
     @Inject(PRISMA) private readonly prisma: PrismaClient,
     private readonly guard: WorkspaceMemberGuard,
     private readonly writer: PageWriter,
     private readonly renderer: MarkdownRenderer,
     private readonly parser: MarkdownParser,
     private readonly stats: StatsService,
   ) {}
   ```
4. Replace the `createPage` body:
   ```ts
   async createPage(
     args: z.infer<typeof CreatePageInput>,
     _context: Context,
     req: McpRequestWithContext,
   ) {
     const requestContext = getMcpRequestContext(req)
     await this.guard.assert(requestContext.workspaceId, requestContext.userId)
     const content = args.markdown ? this.parser.parse(args.markdown) : undefined
     const pageId = await this.writer.createPage({
       userId: requestContext.userId,
       workspaceId: requestContext.workspaceId,
       parentId: args.parentId,
       title: args.title,
       ownership: args.ownership,
       content,
     })
     return {
       pageId,
       url: `/workspaces/${requestContext.workspaceId}/pages/${pageId}`,
     }
   }
   ```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
pnpm --filter engines test src/apps/mcp/tools/page.tools.spec.ts
```
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/mcp/tools/page.tools.ts \
        apps/engines/src/apps/mcp/tools/page.tools.spec.ts
git commit -m "feat(engines): createPage MCP tool persists markdown body and returns URL"
```

---

## Task 9: Update the `createPage` tool description (intent-first)

**Files:**
- Modify: `apps/engines/src/apps/mcp/tools/page.tools.ts`

- [ ] **Step 1: Replace the description in the `@Tool` decorator**

In `apps/engines/src/apps/mcp/tools/page.tools.ts`, change the `description` of the `createPage` `@Tool` to:

```
Создаёт новую страницу-заметку в рабочем пространстве. Вызывай ' +
'когда пользователь просит "создай страницу", "добавь заметку", ' +
'"заведи новую страницу про X". ' +
'Если пользователь говорит "создай страницу из разговора / чата / ' +
'диалога" или "сохрани обсуждение в страницу" — сначала суммаризируй ' +
'историю беседы в структурированный Markdown (заголовок + основные ' +
'шаги/факты списками) и передай его в параметре `markdown`. ' +
'Требует подтверждения пользователя через UI confirmation. ' +
'Параметры: title (string, обязательный), ownership (TEXT|SKILL|AGENT, ' +
'по умолчанию TEXT — обычная заметка; SKILL — навык агента; AGENT — ' +
'описание агента), parentId (uuid, опционально — id родительской ' +
'страницы; по умолчанию страница создаётся в корне), markdown (string ' +
'до 50_000 символов, опционально — содержимое страницы в Markdown).
```

- [ ] **Step 2: Run the engines tests as a sanity check**

Run:
```bash
pnpm --filter engines test
```
Expected: PASS (no test asserts the description string, so this should be clean).

- [ ] **Step 3: Commit**

```bash
git add apps/engines/src/apps/mcp/tools/page.tools.ts
git commit -m "feat(engines): intent-first createPage description covers chat-summary flow"
```

---

## Task 10: Run the full engines gate before moving to E2E

**Files:** none (verification step)

- [ ] **Step 1: Lint, typecheck, tests, build**

Run from the repo root:
```bash
pnpm --filter engines lint
pnpm --filter engines check-types
pnpm --filter engines test
pnpm --filter engines build
```
Expected: all green. Fix any issues found before continuing.

- [ ] **Step 2: Run repo-wide gates so neighbour packages don't regress**

Run:
```bash
pnpm gates
```
Expected: PASS. Common breakage to watch for: Zod schema changes can ripple into MCP-client typings in `apps/agents` (it talks to engines via JSON-RPC so should be transparent, but verify).

- [ ] **Step 3: (No commit — verification only.)**

---

## Task 11: Playwright E2E — create page from chat (happy path)

**Files:**
- Create: `apps/e2e/create-page-from-chat.spec.ts`

- [ ] **Step 1: Inspect prerequisites used by `agent-qa-citations.spec.ts`**

Run:
```bash
sed -n '1,80p' apps/e2e/agent-qa-citations.spec.ts
```
Confirm the env-loading pattern (`ensureDbUrl`), the `OPENAI_API_KEY` gate, the `encryptFixture` helper, and how the spec seeds AiProvider/Model rows + workspace + auth. The new spec mirrors all of these.

- [ ] **Step 2: Write the failing E2E spec**

Create `apps/e2e/create-page-from-chat.spec.ts`:

```ts
/**
 * E2E: agent creates a page from chat history.
 *
 * Requires:
 *   - OPENAI_API_KEY in env (skipped otherwise)
 *   - docker compose up -d (postgres)
 *   - apps/engines on :8082, apps/agents on :8080 — Playwright starts apps/web
 *     itself on :3100 via playwright.config.ts.
 *   - SECRETS_ENCRYPTION_KEY set (for encryptFixture).
 *
 * Determinism caveats:
 *   - This calls a real LLM. The prompt is explicit ("Создай страницу из
 *     разговора") and the tool description is intent-first, so reliable in
 *     practice. The assertions tolerate model variance: page title non-empty,
 *     content non-null, body contains the topic substring "яичниц".
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

const OPENAI_KEY = process.env.OPENAI_API_KEY

function ensureDbUrl(): void {
  if (process.env.DATABASE_URL) return
  const envPath = join(process.cwd(), '.env')
  const envFile = readFileSync(envPath, 'utf8')
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^"|"$/g, '')
    process.env[key] = process.env[key] ?? value
  }
}

function encryptFixture(value: object): object {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { encryptSecret } = require('../../packages/auth/src/index') as {
    encryptSecret: (s: string) => object
  }
  return encryptSecret(JSON.stringify(value))
}

test.describe('agent — create page from chat', () => {
  test.skip(!OPENAI_KEY, 'OPENAI_API_KEY not set; skipping live agent E2E')

  let prisma: typeof import('../../packages/db/src/index').prisma

  test.beforeAll(async () => {
    ensureDbUrl()
    const db = await import('../../packages/db/src/index')
    prisma = db.prisma
  })

  test.afterAll(async () => {
    if (prisma) await prisma.$disconnect()
  })

  test('summarises the dialog into a new root page and returns a clickable link', async ({
    page,
  }) => {
    // ----- 1. Sign-up + auth -----------------------------------------------
    const email = `create-from-chat+${Date.now()}@example.com`
    const password = 'SuperSecure123!'
    await signUpAndAuthAs(page, {
      email,
      password,
      firstName: 'Чат',
      lastName: 'Страница',
    })

    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    })

    // ----- 2. Seed workspace + AI provider for this user --------------------
    //   Mirror agent-qa-citations.spec.ts: lookup provider/model rows
    //   from the seeded DB; if missing, skip with a descriptive message.
    const provider = await prisma.aiProvider.findFirst({
      where: { code: 'openai' },
      select: { id: true },
    })
    test.skip(!provider, 'openai provider missing from DB — run prisma db seed first')

    const workspace = await prisma.workspace.findFirstOrThrow({
      where: { members: { some: { userId: user.id } } },
      select: { id: true },
    })

    // Write workspace-scoped AI credentials via the same path the settings UI uses:
    await prisma.workspaceAiConfig.upsert({
      where: { workspaceId: workspace.id },
      create: {
        workspaceId: workspace.id,
        providerId: provider!.id,
        credentials: encryptFixture({ apiKey: OPENAI_KEY }) as never,
      },
      update: {
        providerId: provider!.id,
        credentials: encryptFixture({ apiKey: OPENAI_KEY }) as never,
      },
    })

    // ----- 3. Open chat, send 3 turns about eggs ---------------------------
    await page.goto(`/workspaces/${workspace.id}/chat`)

    const input = page.getByTestId('chat-message-input')
    const send = page.getByTestId('chat-send-button')

    for (const message of [
      'Как пожарить яичницу?',
      'А сколько по времени готовить желток?',
      'Что добавить, чтобы было вкуснее?',
    ]) {
      await input.fill(message)
      await send.click()
      // Wait for an assistant reply to settle before sending the next turn.
      await expect(page.locator('[data-testid="chat-message-assistant"]').last()).toBeVisible({
        timeout: 60_000,
      })
      // Heuristic: wait for stream-done indicator if present, else short pause.
      await page.waitForTimeout(500)
    }

    // ----- 4. Ask to create a page from the conversation -------------------
    await input.fill('Создай страницу из разговора')
    await send.click()

    // ----- 5. Confirm the createPage modal ---------------------------------
    const confirmModal = page.getByTestId('agent-confirmation-modal')
    await expect(confirmModal).toBeVisible({ timeout: 60_000 })
    await expect(confirmModal).toContainText(/Создать страницу/i)
    await confirmModal.getByTestId('agent-confirmation-allow').click()

    // ----- 6. The final assistant message contains a page link -------------
    const pageLink = page
      .locator('[data-testid="chat-message-assistant"]')
      .last()
      .locator(`a[href^="/workspaces/${workspace.id}/pages/"]`)
    await expect(pageLink).toBeVisible({ timeout: 60_000 })
    const href = await pageLink.getAttribute('href')
    expect(href).toMatch(
      new RegExp(`^/workspaces/${workspace.id}/pages/[0-9a-f-]{36}$`, 'i'),
    )

    // ----- 7. Navigate to the created page and assert contents -------------
    await pageLink.click()
    await page.waitForURL(new RegExp(`/workspaces/${workspace.id}/pages/[0-9a-f-]{36}$`))

    const pageId = href!.split('/').pop()!
    const stored = await prisma.page.findUniqueOrThrow({
      where: { id: pageId },
      select: { title: true, content: true, parentId: true, type: true },
    })
    expect(stored.parentId).toBeNull()
    expect(stored.type).toBe('TEXT')
    expect(stored.title?.trim()).not.toBe('')
    expect(stored.content).not.toBeNull()

    // Loose body check — model paraphrases, so look for any "egg" stem.
    const flat = JSON.stringify(stored.content).toLowerCase()
    expect(flat).toMatch(/яичниц|желт|жарь|жарь/i)
  })
})
```

If specific `data-testid`s above (`chat-message-input`, `chat-send-button`, `chat-message-assistant`, `agent-confirmation-modal`, `agent-confirmation-allow`) don't match the live UI, run:

```bash
grep -rn 'data-testid=' apps/web/src/components/workspace/chat apps/web/src/components/chat | head -40
```

and substitute the real ones. If a needed testid is missing, add it to the relevant component in a single small edit and re-commit before the spec.

- [ ] **Step 3: Run the spec with `OPENAI_API_KEY` unset to confirm it skips cleanly**

Run:
```bash
OPENAI_API_KEY= pnpm exec playwright test apps/e2e/create-page-from-chat.spec.ts
```
Expected: 1 skipped, 0 failed (sanity that the gate works for CI without keys).

- [ ] **Step 4: Run the spec live**

Make sure prerequisites are up:
```bash
docker compose up -d
pnpm --filter engines dev &
pnpm --filter agents dev &
```
Then:
```bash
pnpm exec playwright test apps/e2e/create-page-from-chat.spec.ts --headed
```
Expected: PASS. If the LLM declines to call the tool, inspect the system prompt + tool description in `apps/agents/agents/apps/agent/services/nodes/executor.py` and the updated `createPage` description — strengthen the intent phrasing if needed.

- [ ] **Step 5: Commit**

```bash
git add apps/e2e/create-page-from-chat.spec.ts
git commit -m "test(e2e): agent creates a TEXT page from chat history with a clickable link"
```

---

## Task 12: Update the spec's "Open items" section to record final decisions

**Files:**
- Modify: `docs/superpowers/specs/2026-05-18-create-page-from-chat-design.md`

- [ ] **Step 1: Replace the "Open items" section**

In the spec, replace the `## Open items the plan step will resolve` section with:

```markdown
## Open items — resolved

- **`marked` version**: pinned to `^14.1.3` to match `@repo/editor`.
- **E2E LLM stub**: none built. Spec follows the existing pattern from
  `apps/e2e/agent-qa-citations.spec.ts` (`test.skip(!OPENAI_API_KEY)`) so
  CI without LLM keys is green-by-skip. A future iteration can introduce a
  shared stub provider if flakiness becomes a problem.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-05-18-create-page-from-chat-design.md
git commit -m "docs(specs): mark create-page-from-chat open items as resolved"
```

---

## Self-Review (already applied)

- **Spec coverage** — every section of the spec maps to a task:
  - `MarkdownParser` service + tests → Tasks 2–5
  - DI wiring → Task 6
  - `PageWriter.createPage` content → Task 7
  - `createPage` MCP tool extension (schema + URL response) → Task 8
  - Intent-first description → Task 9
  - Repo-wide gate → Task 10
  - Playwright E2E (UX from chat → confirmation → link → page contents) → Task 11
  - Open-items closure → Task 12
- **Placeholders** — no TBD/TODO; the only conditional fallback (testid lookup in Task 11 Step 2) gives an explicit grep command to resolve before committing.
- **Type consistency** — `CreatePageInput.content?: unknown` is consistent between `PageWriter` (Task 7) and the tool body (Task 8). The response shape `{ pageId, url }` is set in Task 8 and matched by the spec assertion in Task 11. `TiptapDoc` from Task 2 stays internal to the parser and isn't referenced from later tasks.
