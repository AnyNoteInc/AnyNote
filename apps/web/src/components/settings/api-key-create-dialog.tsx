'use client'

import { useState } from 'react'

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@repo/ui/components'

import { trpc, type RouterOutputs } from '@/trpc/client'

export type Ttl = '7d' | '30d' | '90d' | '1y' | 'never'

export type CreatedKey = RouterOutputs['apiKey']['create']

type Props = {
  open: boolean
  onClose: () => void
  onCreated: (key: CreatedKey) => void
}

export function ApiKeyCreateDialog({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [ttl, setTtl] = useState<Ttl>('30d')

  const create = trpc.apiKey.create.useMutation({
    onSuccess: (data) => {
      onCreated(data)
      setName('')
      setTtl('30d')
    },
  })

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Создать API-ключ</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            autoFocus
            label="Название"
            placeholder="Cursor на ноутбуке"
            value={name}
            onChange={(e) => setName(e.target.value)}

            fullWidth
            slotProps={{ htmlInput: { 'data-testid': 'api-key-name-input', maxLength: 100 } }}
          />
          <FormControl fullWidth size="small">
            <InputLabel id="api-key-ttl-label">Срок действия</InputLabel>
            <Select
              labelId="api-key-ttl-label"
              label="Срок действия"
              value={ttl}
              onChange={(e) => setTtl(e.target.value as Ttl)}
            >
              <MenuItem value="7d">7 дней</MenuItem>
              <MenuItem value="30d">30 дней</MenuItem>
              <MenuItem value="90d">90 дней</MenuItem>
              <MenuItem value="1y">1 год</MenuItem>
              <MenuItem value="never">Бессрочный</MenuItem>
            </Select>
          </FormControl>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={create.isPending}>
          Отмена
        </Button>
        <Button
          variant="contained"
          disabled={name.trim().length === 0 || create.isPending}
          data-testid="api-key-create-submit"
          onClick={() => create.mutate({ name: name.trim(), ttl })}
        >
          Создать
        </Button>
      </DialogActions>
    </Dialog>
  )
}
