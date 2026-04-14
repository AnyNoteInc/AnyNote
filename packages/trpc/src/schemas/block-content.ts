import { z } from "zod"

const textBlock = z.object({ text: z.string().max(10_000) })
const todoBlock = z.object({ text: z.string().max(10_000), checked: z.boolean().default(false) })
const calloutBlock = z.object({ text: z.string().max(10_000), emoji: z.string().max(8).optional() })
const codeBlock = z.object({
  text: z.string().max(50_000),
  language: z.string().max(32).default("plaintext"),
})
const emptyBlock = z.object({}).strict()

export const BlockCreateInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("PARAGRAPH"), content: textBlock }),
  z.object({ type: z.literal("HEADING_1"), content: textBlock }),
  z.object({ type: z.literal("HEADING_2"), content: textBlock }),
  z.object({ type: z.literal("HEADING_3"), content: textBlock }),
  z.object({ type: z.literal("TO_DO"), content: todoBlock }),
  z.object({ type: z.literal("BULLETED_LIST_ITEM"), content: textBlock }),
  z.object({ type: z.literal("NUMBERED_LIST_ITEM"), content: textBlock }),
  z.object({ type: z.literal("TOGGLE"), content: textBlock }),
  z.object({ type: z.literal("QUOTE"), content: textBlock }),
  z.object({ type: z.literal("CALLOUT"), content: calloutBlock }),
  z.object({ type: z.literal("DIVIDER"), content: emptyBlock }),
  z.object({ type: z.literal("CODE"), content: codeBlock }),
])

export type BlockCreateInputType = z.infer<typeof BlockCreateInput>
