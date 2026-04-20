import { describe, it, expect } from "@jest/globals"

import { PageChunker } from "./page-chunker.service.js"

describe("PageChunker", () => {
  const chunker = new PageChunker()

  it("returns empty array for null doc", () => {
    expect(chunker.chunksFromDoc(null)).toEqual([])
  })

  it("returns empty array for doc without content", () => {
    expect(chunker.chunksFromDoc({ type: "doc" })).toEqual([])
  })

  it("extracts one chunk per first-level node", () => {
    const doc = {
      type: "doc" as const,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "First paragraph." }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "A heading" }] },
        { type: "paragraph", content: [{ type: "text", text: "Second paragraph." }] },
      ],
    }
    expect(chunker.chunksFromDoc(doc)).toEqual([
      "First paragraph.",
      "A heading",
      "Second paragraph.",
    ])
  })

  it("joins nested text leaves inside one first-level node", () => {
    const doc = {
      type: "doc" as const,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "world", marks: [{ type: "bold" }] },
            { type: "text", text: "!" },
          ],
        },
      ],
    }
    expect(chunker.chunksFromDoc(doc)).toEqual(["Hello  world !"])
  })

  it("walks deeply nested content (bulletList → listItem → paragraph → text)", () => {
    const doc = {
      type: "doc" as const,
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Item A" }] },
              ],
            },
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Item B" }] },
              ],
            },
          ],
        },
      ],
    }
    expect(chunker.chunksFromDoc(doc)).toEqual(["Item A Item B"])
  })

  it("skips empty first-level nodes", () => {
    const doc = {
      type: "doc" as const,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "valid" }] },
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "   " }] },
        { type: "paragraph", content: [{ type: "text", text: "also valid" }] },
      ],
    }
    expect(chunker.chunksFromDoc(doc)).toEqual(["valid", "also valid"])
  })
})
