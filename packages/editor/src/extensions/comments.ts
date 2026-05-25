import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import { anchorToRange } from '../comment-anchor'
import { mergeRanges, type DecoRange } from '../comment-ranges'
import type { CommentThreadAnchor } from '../types-comments'

type PluginState = { threads: CommentThreadAnchor[] }
export const commentsPluginKey = new PluginKey<PluginState>('comments')

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    comments: {
      setCommentThreads: (threads: CommentThreadAnchor[]) => ReturnType
    }
  }
}

export type CommentsOptions = { onOpenThread: (threadId: string) => void }

export type CommentsStorage = {
  canComment: boolean
  onCreateComment?: (anchor: { anchorStart: string; anchorEnd: string; quotedText: string }) => void
}

export const Comments = Extension.create<CommentsOptions, CommentsStorage>({
  name: 'comments',

  addOptions() {
    return { onOpenThread: () => undefined }
  },

  addStorage() {
    return { canComment: false, onCreateComment: undefined }
  },

  addCommands() {
    return {
      setCommentThreads:
        (threads) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(commentsPluginKey, { threads }))
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    const onOpenThread = this.options.onOpenThread
    return [
      new Plugin<PluginState>({
        key: commentsPluginKey,
        state: {
          init: () => ({ threads: [] }),
          apply(tr, value) {
            const meta = tr.getMeta(commentsPluginKey) as PluginState | undefined
            return meta ?? value
          },
        },
        props: {
          // Decorations are derived from EditorState alone: anchorToRange reads
          // the @tiptap/y-tiptap binding via ySyncPluginKey.getState(state), so we
          // never write marks into the doc (read-only commenters can render).
          decorations(state) {
            const pstate = commentsPluginKey.getState(state)
            if (!pstate || pstate.threads.length === 0) return DecorationSet.empty
            const ranges: DecoRange[] = []
            for (const t of pstate.threads) {
              if (t.resolvedAt) continue
              const range = anchorToRange(state, t)
              if (range) ranges.push(range)
            }
            // Flatten overlapping thread ranges into one span each: translucent
            // highlights would otherwise nest and compound into a darker patch.
            const decos = mergeRanges(ranges).map((r) =>
              Decoration.inline(r.from, r.to, { class: 'comment-highlight' }),
            )
            return DecorationSet.create(state.doc, decos)
          },
          handleClick(view, pos) {
            const pstate = commentsPluginKey.getState(view.state)
            if (!pstate) return false
            for (const t of pstate.threads) {
              if (t.resolvedAt) continue
              const range = anchorToRange(view.state, t)
              if (range && pos >= range.from && pos < range.to) {
                onOpenThread(t.id)
                return true
              }
            }
            return false
          },
        },
      }),
    ]
  },
})
