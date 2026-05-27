'use client'

import { useState } from 'react'

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
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
            inputProps={{ 'data-testid': 'api-key-name-input', maxLength: 100 }}
            fullWidth
          />
          <FormControl>
            <FormLabel>Срок действия</FormLabel>
            <RadioGroup value={ttl} onChange={(e) => setTtl(e.target.value as Ttl)}>
              <FormControlLabel value="7d" control={<Radio />} label="7 дней" />
              <FormControlLabel value="30d" control={<Radio />} label="30 дней" />
              <FormControlLabel value="90d" control={<Radio />} label="90 дней" />
              <FormControlLabel value="1y" control={<Radio />} label="1 год" />
              <FormControlLabel value="never" control={<Radio />} label="Никогда" />
            </RadioGroup>
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
