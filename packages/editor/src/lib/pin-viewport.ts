/**
 * Держит кликнутый элемент на месте во вьюпорте, пока открытие боковой
 * сплит-панели (horizontal Collapse, ~300мс) сужает колонку контента:
 * рефлоу делает контент выше и уносит блок за экран — браузерный scroll
 * anchoring это не компенсирует. Каждый кадр возвращаем дрейф scrollTop
 * ближайшего скролл-контейнера, пока анимация не устаканится.
 */
export function pinViewportPosition(el: HTMLElement, durationMs = 500): void {
  if (typeof window === 'undefined') return
  const scroller = findScrollParent(el)
  if (!scroller) return
  const originalTop = el.getBoundingClientRect().top
  const deadline = performance.now() + durationMs
  const step = () => {
    if (!el.isConnected) return
    const drift = el.getBoundingClientRect().top - originalTop
    if (drift !== 0) scroller.scrollTop += drift
    if (performance.now() < deadline) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

const findScrollParent = (el: HTMLElement): HTMLElement | null => {
  let cur = el.parentElement
  while (cur) {
    const style = getComputedStyle(cur)
    // Требуем ФАКТИЧЕСКУЮ вертикальную прокручиваемость: у инлайн-обёрток
    // (превью code-block c overflow:auto) scrollHeight == clientHeight, и
    // подкрутка их scrollTop — no-op вместо компенсации.
    if (/(auto|scroll)/.test(style.overflowY) && cur.scrollHeight > cur.clientHeight) return cur
    cur = cur.parentElement
  }
  return null
}
