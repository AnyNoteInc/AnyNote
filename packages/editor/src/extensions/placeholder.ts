import Placeholder from '@tiptap/extension-placeholder'

export const buildPlaceholder = (text: string) =>
  Placeholder.configure({
    placeholder: text,
    showOnlyWhenEditable: true,
    emptyEditorClass: 'is-editor-empty',
  })
