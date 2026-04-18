import TurndownService from "turndown"

export function editorHtmlToMarkdown(html: string): string {
  const td = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
  })

  // Callout: blockquote with emoji prefix
  td.addRule("callout", {
    filter: (n) => {
      if (n.nodeName !== "DIV") return false
      const el = n as HTMLElement
      return el.dataset?.type === "callout"
    },
    replacement: (content, node) => {
      const el = node as HTMLElement
      const icon = el.dataset?.emoji ?? el.dataset?.icon ?? "💡"
      return `\n\n> ${icon} ${content.trim()}\n\n`
    },
  })

  // Toggle: <details><summary>...</summary>...</details>
  td.addRule("toggle", {
    filter: (n) => {
      if (n.nodeName !== "DIV") return false
      const el = n as HTMLElement
      return el.dataset?.type === "toggle"
    },
    replacement: (content) => {
      const trimmed = content.trim()
      const lines = trimmed.split("\n")
      const summary = lines[0] ?? ""
      const body = lines.slice(1).join("\n").trim()
      return `\n\n<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>\n\n`
    },
  })

  // HiddenText: best-effort span wrapper (MD has no masked text primitive)
  td.addRule("hiddenText", {
    filter: (n) => {
      if (n.nodeName !== "DIV") return false
      const el = n as HTMLElement
      return el.dataset?.type === "hidden-text"
    },
    replacement: (content) => `<span class="hidden">${content.trim()}</span>`,
  })

  // FileAttachment: [filename](url)
  td.addRule("fileAttachment", {
    filter: (n) => {
      if (n.nodeName !== "DIV") return false
      const el = n as HTMLElement
      return el.dataset?.type === "file-attachment"
    },
    replacement: (_content, node) => {
      const el = node as HTMLElement
      const name = el.dataset?.name ?? "file"
      const url = el.dataset?.url ?? el.dataset?.href ?? "#"
      return `[${name}](${url})`
    },
  })

  return td.turndown(html)
}
