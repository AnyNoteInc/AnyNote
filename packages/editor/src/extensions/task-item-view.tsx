"use client"

import { Checkbox } from "@mui/material"
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react"
import type { NodeViewProps } from "@tiptap/react"
import TaskItem from "@tiptap/extension-task-item"

function TaskItemView({ node, updateAttributes, editor }: NodeViewProps) {
  const checked = Boolean(node.attrs.checked)
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.checked
    if (editor.isEditable) updateAttributes({ checked: next })
  }
  return (
    <NodeViewWrapper as="li" data-checked={checked || undefined} className="anynote-task-item">
      <Checkbox
        checked={checked}
        onChange={handleChange}
        color="primary"
        size="small"
        disableRipple
        disabled={!editor.isEditable}
        className="anynote-task-item__checkbox"
        onMouseDown={(e) => e.stopPropagation()}
      />
      <NodeViewContent as="div" className="anynote-task-item__content" />
    </NodeViewWrapper>
  )
}

export const TaskItemWithCheckbox = TaskItem.extend({
  addNodeView() {
    return ReactNodeViewRenderer(TaskItemView)
  },
})
