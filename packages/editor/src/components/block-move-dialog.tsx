"use client"

import type { ReactNode } from "react"

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@mui/material"

type Props = {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  busy?: boolean
  treePicker: ReactNode
  canConfirm: boolean
}

export function BlockMoveDialog({
  open,
  onClose,
  onConfirm,
  busy,
  treePicker,
  canConfirm,
}: Props) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Переместить блок на страницу</DialogTitle>
      <DialogContent dividers sx={{ maxHeight: 480, overflow: "auto", p: 1 }}>
        {treePicker}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Отмена</Button>
        <Button
          onClick={onConfirm}
          disabled={!canConfirm || Boolean(busy)}
          variant="contained"
        >
          {busy ? "Перемещение…" : "Переместить"}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
