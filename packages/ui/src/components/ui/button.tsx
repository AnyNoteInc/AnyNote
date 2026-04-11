"use client"

import { forwardRef } from "react"
import MuiButton, { type ButtonProps as MuiButtonProps } from "@mui/material/Button"
import CircularProgress from "@mui/material/CircularProgress"

export type ButtonProps = MuiButtonProps & {
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { loading = false, children, endIcon, disabled, ...props },
  ref,
) {
  return (
    <MuiButton
      ref={ref}
      {...props}
      disabled={disabled ?? loading}
      endIcon={loading ? <CircularProgress size={16} color="inherit" /> : endIcon}
    >
      {children}
    </MuiButton>
  )
})
