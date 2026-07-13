/**
 * Держит кликнутый элемент на месте во вьюпорте, пока открытие боковой
 * сплит-панели (horizontal Collapse, ~300мс) сужает колонку контента:
 * рефлоу делает контент выше и уносит блок за экран — браузерный scroll
 * anchoring это не компенсирует. Каждый кадр возвращаем дрейф scrollTop
 * ближайшего скролл-контейнера, пока анимация не устаканится.
 *
 * Ловушка: цикл не отличает рефлоу-дрейф от пользовательского скролла, поэтому
 * прерываемся на первом же жесте (wheel/touchmove/keydown) — иначе ~500мс после
 * открытия колёсико «не работает». И один активный цикл на контейнер: повторный
 * клик отменяет предыдущий, чтобы два цикла не дрались за один scrollTop.
 */
const activeLoops = new WeakMap<HTMLElement, () => void>()

export function pinViewportPosition(el: HTMLElement, durationMs = 500): void {
  if (typeof window === 'undefined') return
  const scroller = findScrollParent(el)
  if (!scroller) return

  // Отменяем предыдущий цикл на этом же контейнере.
  activeLoops.get(scroller)?.()

  let cancelled = false
  const opts = { passive: true, once: true } as const
  const cancel = () => {
    if (cancelled) return
    cancelled = true
    scroller.removeEventListener('wheel', cancel)
    scroller.removeEventListener('touchmove', cancel)
    scroller.removeEventListener('keydown', cancel)
    if (activeLoops.get(scroller) === cancel) activeLoops.delete(scroller)
  }
  scroller.addEventListener('wheel', cancel, opts)
  scroller.addEventListener('touchmove', cancel, opts)
  scroller.addEventListener('keydown', cancel, opts)
  activeLoops.set(scroller, cancel)

  const originalTop = el.getBoundingClientRect().top
  const deadline = performance.now() + durationMs
  const step = () => {
    if (cancelled || !el.isConnected) {
      cancel()
      return
    }
    const drift = el.getBoundingClientRect().top - originalTop
    if (drift !== 0) scroller.scrollTop += drift
    if (performance.now() < deadline) requestAnimationFrame(step)
    else cancel()
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
