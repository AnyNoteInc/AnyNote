'use client'

import { Box } from '@repo/ui/components'

import { FormRenderer } from '../../forms/form-renderer'
import type { FormBuilderState } from './form-builder-state'

export function FormPreviewCanvas({ state }: { readonly state: FormBuilderState }) {
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
      <FormRenderer version={state.document} mode="preview" submissionDisabled />
    </Box>
  )
}
