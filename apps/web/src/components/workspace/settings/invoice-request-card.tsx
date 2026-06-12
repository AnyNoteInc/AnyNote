'use client'

import { useState } from 'react'

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@repo/ui/components'

// Deep-import the client-safe dto leaf (NOT the @repo/domain root barrel) —
// the validation mirrors the server exactly (isValidInn/isValidKpp are the
// same functions createInvoiceRequest runs).
import {
  INVOICE_MAX_PERIOD_MONTHS,
  INVOICE_MIN_PERIOD_MONTHS,
  isValidInn,
  isValidKpp,
} from '@repo/domain/seats/dto/seats.dto.ts'

import { trpc } from '@/trpc/client'

import { SettingsCard } from './settings-card'
import { INVOICE_STATUS_CHIPS, formatDateRu } from './billing-labels'

type Props = {
  workspaceId: string
  /** Requested seats must cover the live member count (INVOICE_SEATS_BELOW_USAGE). */
  memberCount: number
}

type FieldErrors = Partial<
  Record<
    'legalName' | 'inn' | 'kpp' | 'legalAddress' | 'contactEmail' | 'periodMonths' | 'seats',
    string
  >
>

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * «Счёт для юридических лиц» (8D spec §6) — the offline-payment workflow.
 * Payment stays offline: the persisted request row is the record; the operator
 * mail goes out server-side. OWNER-only (the router gate), not holder-gated.
 */
export function InvoiceRequestCard({ workspaceId, memberCount }: Props) {
  const utils = trpc.useUtils()
  const [legalName, setLegalName] = useState('')
  const [inn, setInn] = useState('')
  const [kpp, setKpp] = useState('')
  const [legalAddress, setLegalAddress] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [periodMonths, setPeriodMonths] = useState('12')
  const [seats, setSeats] = useState(String(Math.max(memberCount, 1)))
  const [comment, setComment] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [success, setSuccess] = useState(false)

  const listQ = trpc.billing.listInvoiceRequests.useQuery({ workspaceId })

  const create = trpc.billing.createInvoiceRequest.useMutation({
    onSuccess: () => {
      setSuccess(true)
      setErrors({})
      setLegalName('')
      setInn('')
      setKpp('')
      setLegalAddress('')
      setContactEmail('')
      setPeriodMonths('12')
      setSeats(String(Math.max(memberCount, 1)))
      setComment('')
      void utils.billing.listInvoiceRequests.invalidate({ workspaceId })
    },
  })

  // Mirrors the server's createInvoiceRequest validation (seats.dto.ts) so the
  // form refuses locally what the domain would refuse anyway.
  function validate(): { periodMonths: number; seats: number } | null {
    const next: FieldErrors = {}
    const period = Number.parseInt(periodMonths, 10)
    const seatCount = Number.parseInt(seats, 10)

    if (!legalName.trim()) next.legalName = 'Укажите название организации'
    else if (legalName.trim().length > 255) next.legalName = 'Не более 255 символов'
    if (!isValidInn(inn.trim())) next.inn = 'ИНН должен содержать ровно 10 или 12 цифр'
    if (kpp.trim() && !isValidKpp(kpp.trim())) next.kpp = 'КПП должен содержать ровно 9 цифр'
    if (!legalAddress.trim()) next.legalAddress = 'Укажите юридический адрес'
    else if (legalAddress.trim().length > 500) next.legalAddress = 'Не более 500 символов'
    if (!EMAIL_RE.test(contactEmail.trim())) next.contactEmail = 'Укажите корректный email'
    if (
      Number.isNaN(period) ||
      period < INVOICE_MIN_PERIOD_MONTHS ||
      period > INVOICE_MAX_PERIOD_MONTHS
    ) {
      next.periodMonths = `Период счёта — от ${INVOICE_MIN_PERIOD_MONTHS} до ${INVOICE_MAX_PERIOD_MONTHS} месяцев`
    }
    if (Number.isNaN(seatCount) || seatCount < 1) next.seats = 'Минимум одно место'
    else if (seatCount < memberCount) {
      next.seats = `Не меньше текущего числа участников (${memberCount})`
    }

    setErrors(next)
    return Object.keys(next).length === 0 ? { periodMonths: period, seats: seatCount } : null
  }

  return (
    <SettingsCard
      title="Счёт для юридических лиц"
      description="Оплата мест по счёту: оставьте реквизиты — мы выставим счёт и активируем места после оплаты."
    >
      <Box
        component="form"
        data-testid="billing-invoice-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          setSuccess(false)
          const parsed = validate()
          if (!parsed) return
          create.mutate({
            workspaceId,
            legalName: legalName.trim(),
            inn: inn.trim(),
            kpp: kpp.trim() || undefined,
            legalAddress: legalAddress.trim(),
            contactEmail: contactEmail.trim(),
            periodMonths: parsed.periodMonths,
            seats: parsed.seats,
            comment: comment.trim() || undefined,
          })
        }}
      >
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Название организации"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              error={Boolean(errors.legalName)}
              helperText={errors.legalName}
              size="small"
              fullWidth
              slotProps={{ htmlInput: { 'data-testid': 'billing-invoice-legal-name' } }}
            />
            <TextField
              label="ИНН"
              value={inn}
              onChange={(e) => setInn(e.target.value)}
              error={Boolean(errors.inn)}
              helperText={errors.inn ?? '10 или 12 цифр'}
              size="small"
              sx={{ minWidth: 180 }}
              slotProps={{ htmlInput: { 'data-testid': 'billing-invoice-inn' } }}
            />
            <TextField
              label="КПП (необязательно)"
              value={kpp}
              onChange={(e) => setKpp(e.target.value)}
              error={Boolean(errors.kpp)}
              helperText={errors.kpp ?? '9 цифр'}
              size="small"
              sx={{ minWidth: 160 }}
              slotProps={{ htmlInput: { 'data-testid': 'billing-invoice-kpp' } }}
            />
          </Stack>
          <TextField
            label="Юридический адрес"
            value={legalAddress}
            onChange={(e) => setLegalAddress(e.target.value)}
            error={Boolean(errors.legalAddress)}
            helperText={errors.legalAddress}
            size="small"
            fullWidth
            slotProps={{ htmlInput: { 'data-testid': 'billing-invoice-address' } }}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Email для связи"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              error={Boolean(errors.contactEmail)}
              helperText={errors.contactEmail}
              size="small"
              fullWidth
              slotProps={{ htmlInput: { 'data-testid': 'billing-invoice-email' } }}
            />
            <TextField
              label="Период, месяцев"
              type="number"
              value={periodMonths}
              onChange={(e) => setPeriodMonths(e.target.value)}
              error={Boolean(errors.periodMonths)}
              helperText={errors.periodMonths}
              size="small"
              sx={{ minWidth: 150 }}
              slotProps={{
                htmlInput: {
                  min: INVOICE_MIN_PERIOD_MONTHS,
                  max: INVOICE_MAX_PERIOD_MONTHS,
                  'data-testid': 'billing-invoice-period',
                },
              }}
            />
            <TextField
              label="Мест"
              type="number"
              value={seats}
              onChange={(e) => setSeats(e.target.value)}
              error={Boolean(errors.seats)}
              helperText={errors.seats}
              size="small"
              sx={{ minWidth: 120 }}
              slotProps={{ htmlInput: { min: 1, 'data-testid': 'billing-invoice-seats' } }}
            />
          </Stack>
          <TextField
            label="Комментарий (необязательно)"
            value={comment}
            onChange={(e) => setComment(e.target.value.slice(0, 1000))}
            size="small"
            fullWidth
            multiline
            minRows={2}
          />

          {success ? (
            <Alert severity="success" onClose={() => setSuccess(false)}>
              Заявка отправлена — мы выставим счёт и свяжемся с вами по указанному email.
            </Alert>
          ) : null}
          {create.error ? <Alert severity="error">{create.error.message}</Alert> : null}

          <Box>
            <Button
              type="submit"
              variant="contained"
              data-testid="billing-invoice-submit"
              loading={create.isPending}
            >
              Отправить заявку
            </Button>
          </Box>
        </Stack>
      </Box>

      {/* ── past requests ──────────────────────────────────────────────────── */}
      {listQ.isPending ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
          <CircularProgress size={20} />
        </Box>
      ) : listQ.isError ? (
        <Alert severity="error">{listQ.error.message}</Alert>
      ) : listQ.data.length > 0 ? (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Отправленные заявки
          </Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Организация</TableCell>
                  <TableCell>Мест</TableCell>
                  <TableCell>Период</TableCell>
                  <TableCell>Дата</TableCell>
                  <TableCell align="right">Статус</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {listQ.data.map((row) => {
                  const chip = INVOICE_STATUS_CHIPS[row.status] ?? {
                    label: row.status,
                    color: 'default' as const,
                  }
                  return (
                    <TableRow key={row.id} data-testid="billing-invoice-row">
                      <TableCell>
                        <Typography variant="body2" noWrap>
                          {row.legalName}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          ИНН {row.inn}
                        </Typography>
                      </TableCell>
                      <TableCell>{row.seats}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{row.periodMonths} мес.</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {formatDateRu(row.createdAt)}
                      </TableCell>
                      <TableCell align="right">
                        <Chip size="small" color={chip.color} label={chip.label} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      ) : null}
    </SettingsCard>
  )
}
