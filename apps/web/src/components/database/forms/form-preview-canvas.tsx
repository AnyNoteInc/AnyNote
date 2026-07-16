'use client'

import { Box } from '@repo/ui/components'

import { FormRenderer } from '../../forms/form-renderer'
import type { FormBuilderAction, FormBuilderState } from './form-builder-state'

export function FormPreviewCanvas({
  state,
  dispatch,
}: {
  readonly state: FormBuilderState
  readonly dispatch: React.Dispatch<FormBuilderAction>
}) {
  const selectedQuestion =
    state.selection.kind === 'QUESTION'
      ? state.document.questions.find(({ id }) => id === state.selection.id)
      : undefined
  const location =
    state.selection.kind === 'ENDING'
      ? ({ kind: 'ENDING', id: state.selection.id } as const)
      : ({
          kind: 'SECTION',
          id:
            state.selection.kind === 'SECTION'
              ? state.selection.id
              : (selectedQuestion?.sectionId ?? state.document.firstSectionId),
        } as const)
  return (
    <Box
      component="main"
      aria-label="Предпросмотр формы"
      sx={{
        minWidth: 0,
        minHeight: 0,
        overflow: 'auto',
        bgcolor: 'background.default',
        backgroundImage: (theme) =>
          `radial-gradient(circle at 12% 18%, ${theme.palette.action.selected} 0, transparent 28%), linear-gradient(${theme.palette.divider} 1px, transparent 1px)`,
        backgroundSize: 'auto, 100% 72px',
      }}
    >
      <FormRenderer
        version={state.document}
        mode="preview"
        submissionDisabled
        previewLocation={location}
        onPreviewLocationChange={(next) => dispatch({ type: 'ITEM_SELECTED', selection: next })}
      />
    </Box>
  )
}
