import { TiptapTransformer } from "@hocuspocus/transformer"
import Code from "@tiptap/extension-code"
import Document from "@tiptap/extension-document"
import Paragraph from "@tiptap/extension-paragraph"
import Text from "@tiptap/extension-text"
import TaskList from "@tiptap/extension-task-list"
import TaskItem from "@tiptap/extension-task-item"
import * as Y from "yjs"

// Matches the checklist the user sees on first launch:
//   - [x] Создать аккаунт в AnyNote
//   - [ ] Нажать где-нибудь внизу `/` и посмотреть элементы
//       - [ ] Ввести `/image`, нажать Enter и загрузить свое фото
//   - [ ] Создать новую страницу в сайдбаре слева 👈
const WELCOME_CONTENT = {
  type: "doc",
  content: [
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: true },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Создать аккаунт в AnyNote" }],
            },
          ],
        },
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Нажать где-нибудь внизу " },
                { type: "text", marks: [{ type: "code" }], text: "/" },
                { type: "text", text: " и посмотреть элементы" },
              ],
            },
            {
              type: "taskList",
              content: [
                {
                  type: "taskItem",
                  attrs: { checked: false },
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        { type: "text", text: "Ввести " },
                        { type: "text", marks: [{ type: "code" }], text: "/image" },
                        { type: "text", text: ", нажать Enter и загрузить свое фото" },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Создать новую страницу в сайдбаре слева 👈" }],
            },
          ],
        },
      ],
    },
  ],
}

const EXTENSIONS = [
  Document,
  Paragraph,
  Text,
  Code,
  TaskList,
  TaskItem.configure({ nested: true }),
]

export function buildWelcomePageContent(): {
  content: object
  contentYjs: Uint8Array<ArrayBuffer>
} {
  const ydoc = TiptapTransformer.toYdoc(WELCOME_CONTENT, "default", EXTENSIONS)
  const src = Y.encodeStateAsUpdate(ydoc)
  // Copy into a fresh ArrayBuffer-backed view so the type matches Prisma's
  // `Uint8Array<ArrayBuffer>` expectation for Bytes columns.
  const contentYjs = new Uint8Array(new ArrayBuffer(src.byteLength))
  contentYjs.set(src)
  return { content: WELCOME_CONTENT, contentYjs }
}
