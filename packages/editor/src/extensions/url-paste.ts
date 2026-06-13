import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

import { normalizeLinkHref } from '../link-href'
import { urlPasteOptions, type UrlPasteOption } from '../url-paste-decision'

// Bare-URL paste menu (spec §4). On an EMPTY selection, pasting a single http(s)
// URL shows an inline chooser — «Ссылка» / «Закладка» / «Встроить» (the last
// only when the URL is allowlisted). Pasting onto a text selection stays the
// default plain-link behavior (untouched here).
//
// Priority is BELOW image-paste (200) and the default FileUpload so a file/image
// paste is claimed first; this plugin only acts when the clipboard is plain
// TEXT that is a bare URL.
//
// The chooser is a vanilla floating DOM menu (no React) so the plugin stays
// self-contained — built the way link-click-handler manipulates the DOM
// directly. The "which options" decision is the pure, unit-tested
// `urlPasteOptions`; this file is the wiring.

export type BookmarkPreview = {
  title?: string
  description?: string
  image?: string
  favicon?: string
}

// Injected by apps/web (Task 4). Tolerant of being absent — the bookmark inserts
// with just its url and stays a bare card until a preview is wired.
export type PreviewFetch = (url: string) => Promise<BookmarkPreview>

const urlPasteKey = new PluginKey('urlPaste')

type Labels = Record<UrlPasteOption['kind'], string>
const LABELS: Labels = {
  link: 'Ссылка',
  bookmark: 'Закладка',
  embed: 'Встроить',
}

const insertLink = (view: EditorView, from: number, to: number, url: string) => {
  const { state } = view
  const linkMark = state.schema.marks.link
  const tr = state.tr.insertText(url, from, to)
  if (linkMark) {
    tr.addMark(from, from + url.length, linkMark.create({ href: url }))
  }
  view.dispatch(tr)
}

const insertBookmark = (
  view: EditorView,
  from: number,
  to: number,
  url: string,
  previewFetch?: PreviewFetch,
) => {
  const bookmarkType = view.state.schema.nodes.bookmark
  if (!bookmarkType) {
    insertLink(view, from, to, url)
    return
  }
  const node = bookmarkType.create({ url, title: '', description: '', image: '', favicon: '' })
  view.dispatch(view.state.tr.replaceWith(from, to, node))

  // Best-effort async preview fill — tolerate an absent fetch (Task 3 ships
  // before Task 4 wires the route).
  if (!previewFetch) return
  void previewFetch(url)
    .then((preview) => {
      if (!preview) return
      // The fetch can resolve up to FETCH_TIMEOUT_MS (8s) later, by which time
      // the editor may have unmounted — dispatching on a destroyed view throws.
      // Bail early, and wrap the dispatch as a belt against any race.
      if (view.isDestroyed) return
      // Re-find the just-inserted bookmark by url (positions drift under Yjs).
      let pos: number | null = null
      view.state.doc.descendants((n, p) => {
        if (pos != null) return false
        if (n.type.name === 'bookmark' && n.attrs.url === url && !n.attrs.title) {
          pos = p
          return false
        }
        return undefined
      })
      if (pos == null) return
      try {
        view.dispatch(
          view.state.tr.setNodeMarkup(pos, undefined, {
            url,
            title: preview.title ?? '',
            description: preview.description ?? '',
            image: preview.image ?? '',
            favicon: preview.favicon ?? '',
          }),
        )
      } catch {
        // View torn down between the guard and dispatch — the bare card stays.
      }
    })
    .catch(() => {
      // Preview failed — the bare bookmark card stays.
    })
}

const insertEmbed = (
  view: EditorView,
  from: number,
  to: number,
  url: string,
  provider: string,
  embedUrl: string,
) => {
  const embedType = view.state.schema.nodes.embed
  if (!embedType) {
    insertLink(view, from, to, url)
    return
  }
  const node = embedType.create({ url, provider, embedUrl })
  view.dispatch(view.state.tr.replaceWith(from, to, node))
}

// ── The floating chooser menu (vanilla DOM) ─────────────────────────────────
let activeMenu: HTMLElement | null = null
const closeMenu = () => {
  if (activeMenu) {
    activeMenu.remove()
    activeMenu = null
  }
}

const showChooser = (
  view: EditorView,
  pos: number,
  url: string,
  options: UrlPasteOption[],
  previewFetch?: PreviewFetch,
) => {
  closeMenu()
  const coords = view.coordsAtPos(pos)
  const menu = document.createElement('div')
  menu.className = 'anynote-url-paste-menu'
  menu.setAttribute('role', 'menu')
  Object.assign(menu.style, {
    position: 'fixed',
    left: `${Math.round(coords.left)}px`,
    top: `${Math.round(coords.bottom + 4)}px`,
    zIndex: '1400',
    display: 'flex',
    gap: '4px',
    padding: '4px',
    background: 'var(--anynote-menu-bg, #fff)',
    border: '1px solid rgba(0,0,0,0.12)',
    borderRadius: '8px',
    boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
    font: '13px system-ui, sans-serif',
  })

  // `cleanup` and `onDismiss` reference each other but are only INVOKED after the
  // `setTimeout` registers the listeners (and `choose` runs on a user click), so
  // the mutual reference resolves at call time — both can be `const`. `cleanup`
  // tears down the document listeners on the HAPPY path too (picking an option),
  // not just on outside-dismiss — otherwise 3 listeners leak until the next
  // global event.
  const onDismiss = (e: Event) => {
    if (e instanceof KeyboardEvent && e.key !== 'Escape') return
    if (
      e.type === 'mousedown' &&
      activeMenu &&
      e.target instanceof Node &&
      activeMenu.contains(e.target)
    ) {
      return
    }
    closeMenu()
    cleanup()
  }
  const cleanup = () => {
    // `removeEventListener` is a no-op for an already-removed listener, so a
    // double call (choose() then a stray dismiss event) is harmless.
    document.removeEventListener('mousedown', onDismiss, true)
    document.removeEventListener('keydown', onDismiss, true)
    window.removeEventListener('scroll', onDismiss, true)
  }

  const choose = (opt: UrlPasteOption) => {
    closeMenu()
    cleanup()
    const { from, to } = view.state.selection
    if (opt.kind === 'link') insertLink(view, from, to, url)
    else if (opt.kind === 'bookmark') insertBookmark(view, from, to, url, previewFetch)
    else insertEmbed(view, from, to, url, opt.provider, opt.embedUrl)
    view.focus()
  }

  for (const opt of options) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.setAttribute('role', 'menuitem')
    btn.textContent = LABELS[opt.kind]
    Object.assign(btn.style, {
      border: 'none',
      borderRadius: '6px',
      padding: '6px 10px',
      cursor: 'pointer',
      background: 'transparent',
      color: 'inherit',
      font: 'inherit',
    })
    btn.addEventListener('mouseenter', () => (btn.style.background = 'rgba(0,0,0,0.06)'))
    btn.addEventListener('mouseleave', () => (btn.style.background = 'transparent'))
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      choose(opt)
    })
    menu.appendChild(btn)
  }

  document.body.appendChild(menu)
  activeMenu = menu

  // Register the dismiss listeners on the next tick so the paste's own events
  // don't immediately close the menu.
  setTimeout(() => {
    document.addEventListener('mousedown', onDismiss, true)
    document.addEventListener('keydown', onDismiss, true)
    window.addEventListener('scroll', onDismiss, true)
  }, 0)
}

export const buildUrlPaste = (previewFetch?: PreviewFetch) =>
  Extension.create({
    name: 'urlPaste',
    // Below imagePaste (200) and default FileUpload — only acts on plain-text
    // bare-URL pastes that no file handler claimed.
    priority: 50,
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: urlPasteKey,
          props: {
            handlePaste: (view, event) => {
              // Files are handled by image-paste / file-upload; ignore here.
              if ((event.clipboardData?.files?.length ?? 0) > 0) return false
              // Only a collapsed (empty) selection triggers the chooser; a paste
              // over selected text keeps today's plain-link behavior.
              if (!view.state.selection.empty) return false
              const text = event.clipboardData?.getData('text/plain') ?? ''
              const options = urlPasteOptions(text)
              if (options.length === 0) return false
              const url = normalizeLinkHref(text.trim())
              if (!url) return false
              event.preventDefault()
              showChooser(view, view.state.selection.from, url, options, previewFetch)
              return true
            },
          },
        }),
      ]
    },
  })
