// Shared label maps, formatting helpers, and wire types for the workspace
// billing section (billing-section.tsx and its cards) — the people-labels.ts
// precedent.

export type ChipColor = 'default' | 'success' | 'error' | 'warning' | 'info'

// Russian labels for the seat ledger. KEEP IN SYNC with SeatLedgerEventType
// in packages/domain/src/seats/dto/seats.dto.ts (6 types in Phase 8D);
// unknown types fall back to the raw key.
export const SEAT_EVENT_LABELS: Record<string, string> = {
  MEMBER_JOINED: 'Участник занял место',
  MEMBER_REMOVED: 'Место освобождено',
  SEATS_PURCHASED: 'Места докуплены',
  SEATS_REDUCTION_SCHEDULED: 'Запланировано уменьшение',
  SEATS_RENEWED: 'Места продлены',
  ADDONS_RESET: 'Докупленные места сброшены',
}

/** InvoiceRequestStatus → chip. KEEP IN SYNC with InvoiceRequestState in seats.dto.ts. */
export const INVOICE_STATUS_CHIPS: Record<string, { label: string; color: ChipColor }> = {
  NEW: { label: 'Новая', color: 'info' },
  IN_PROGRESS: { label: 'В работе', color: 'warning' },
  COMPLETED: { label: 'Выполнена', color: 'success' },
  REJECTED: { label: 'Отклонена', color: 'default' },
}

/** Kopecks → «1 234,56 ₽» (whole rubles render without a fraction). */
export function formatKopecks(kopecks: number): string {
  return `${(kopecks / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`
}

/** Date-only ru format; tolerates the transformer-less wire (ISO strings). */
export function formatDateRu(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ru-RU')
}

/**
 * `billing.seatUsage` as the BROWSER sees it: the HTTP link has no
 * transformer, so the server's `periodEnd: Date` arrives as an ISO string
 * (the notification.list precedent). Mirrors `SeatUsage` in
 * packages/domain/src/seats/dto/seats.dto.ts.
 */
export type SeatUsageWire = {
  memberCount: number
  includedSeats: number
  paidSeats: number
  scheduledSeats: number | null
  capacity: number
  seatPrice: {
    monthlyKopecks: number
    yearlyKopecks: number
    currentKopecks: number
    billingPeriod: 'MONTHLY' | 'YEARLY'
  } | null
  periodEnd: string | Date | null
  canPurchase: boolean
}
