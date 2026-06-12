import { esc } from '../utils.ts'
import type { MailPayloads, RenderedEmail } from '../types.ts'

/**
 * Legal-entity invoice request (per-seat billing, Phase 8D). OPERATOR-facing:
 * the recipient is BILLING_INVOICE_EMAIL, not the user — the payment is
 * processed offline, the InvoiceRequest row is the system of record.
 */
export function renderInvoiceRequest(p: MailPayloads['invoice-request']): RenderedEmail {
  const comment = p.comment?.trim()
  return {
    subject: `Заявка на счёт: ${p.legalName} (ИНН ${p.inn})`,
    text:
      `Новая заявка на выставление счёта в «Любых заметках».\n\n` +
      `Организация: ${p.legalName}\n` +
      `ИНН: ${p.inn}\n` +
      `Пространство: ${p.workspaceName}\n` +
      `Email владельца: ${p.ownerEmail}\n` +
      `Мест: ${p.seats}\n` +
      `Период: ${p.periodMonths} мес.` +
      (comment ? `\nКомментарий: ${comment}` : ''),
    html:
      `<p>Новая заявка на выставление счёта в «Любых заметках».</p>` +
      `<ul>` +
      `<li>Организация: ${esc(p.legalName)}</li>` +
      `<li>ИНН: ${esc(p.inn)}</li>` +
      `<li>Пространство: ${esc(p.workspaceName)}</li>` +
      `<li>Email владельца: ${esc(p.ownerEmail)}</li>` +
      `<li>Мест: ${p.seats}</li>` +
      `<li>Период: ${p.periodMonths} мес.</li>` +
      (comment ? `<li>Комментарий: ${esc(comment)}</li>` : '') +
      `</ul>`,
  }
}
