'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'

// Единый регион утилитарных боковых панелей страницы (комментарии, история,
// просмотр файла): одновременно открыта не более одной — открытие следующей
// закрывает предыдущую. Чат в регион НЕ входит: это отдельная колонка, всегда
// правее региона (порядок закреплён DOM-порядком в workspace-layout-client).
//
// Механика без state: провайдер держит Map<id, close>; claim(id) зовёт close
// всех остальных. Панели регистрируются в useEffect и клеймят регион эффектом
// на открытие, поэтому чужой setState никогда не выполняется во время рендера.

export type PagePanelId = 'comments' | 'history' | 'preview'

type PagePanelRegionValue = {
  /** Заявить регион за панелью — закрывает остальных зарегистрированных. */
  claim: (id: PagePanelId) => void
  /** Регистрация панели; возвращает unregister (для cleanup эффекта). */
  register: (id: PagePanelId, close: () => void) => () => void
}

const PagePanelRegionContext = createContext<PagePanelRegionValue | null>(null)

/** Non-throwing: панели монтируются и вне региона (страницы без провайдера)
 *  и должны деградировать к независимому поведению. */
export function usePagePanelRegion(): PagePanelRegionValue | null {
  return useContext(PagePanelRegionContext)
}

/** Членство панели в регионе: регистрирует свой close один раз и клеймит регион
 *  при открытии. Инкапсулирует пару эффектов, которую иначе каждый контекст
 *  панели повторяет вручную (и легко ошибиться с deps/cleanup). */
export function usePagePanelMember(id: PagePanelId, isOpen: boolean, close: () => void): void {
  const region = usePagePanelRegion()
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => region?.register(id, () => closeRef.current()), [region, id])
  useEffect(() => {
    if (isOpen) region?.claim(id)
  }, [region, id, isOpen])
}

export function PagePanelRegionProvider({ children }: { children: ReactNode }) {
  const panelsRef = useRef(new Map<PagePanelId, () => void>())

  const register = useCallback((id: PagePanelId, close: () => void) => {
    panelsRef.current.set(id, close)
    return () => {
      // Не затираем более позднюю регистрацию того же id (StrictMode replay).
      if (panelsRef.current.get(id) === close) panelsRef.current.delete(id)
    }
  }, [])

  const claim = useCallback((id: PagePanelId) => {
    for (const [otherId, close] of panelsRef.current) {
      if (otherId !== id) close()
    }
  }, [])

  const value = useMemo(() => ({ claim, register }), [claim, register])
  return <PagePanelRegionContext.Provider value={value}>{children}</PagePanelRegionContext.Provider>
}
