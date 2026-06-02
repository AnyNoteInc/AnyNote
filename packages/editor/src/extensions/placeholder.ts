import Placeholder from '@tiptap/extension-placeholder'

export const buildPlaceholder = (text: string) =>
  Placeholder.configure({
    placeholder: text,
    showOnlyWhenEditable: true,
    emptyEditorClass: 'is-editor-empty',
    // Tag every empty top-level node (not just the first) so the placeholder
    // shows on any empty line where the cursor sits.
    emptyNodeClass: 'is-empty',
  })
