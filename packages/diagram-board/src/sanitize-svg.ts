// Strip empty/invalid geometry attrs (x,y,width,height) on <foreignObject> (and any
// SVG element) before injecting via innerHTML / dangerouslySetInnerHTML. Empty-string
// values trip React's `Invalid value for <foreignObject> attribute y=""` invariant if
// such markup ever reaches the reconciler; mermaid emits <foreignObject> for HTML
// labels and can produce empty geometry — normalize at the injection source.
const GEOMETRY_ATTRS = ['x', 'y', 'width', 'height']

export function sanitizeSvg(svg: string): string {
  if (!svg || typeof window === 'undefined' || !svg.includes('<foreignObject')) return svg
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  if (doc.querySelector('parsererror')) return svg // never make it worse
  for (const fo of Array.from(doc.querySelectorAll('foreignObject'))) {
    for (const attr of GEOMETRY_ATTRS) {
      const v = fo.getAttribute(attr)
      if (v === '' || v == null || Number.isNaN(Number(v))) fo.removeAttribute(attr)
    }
  }
  return new XMLSerializer().serializeToString(doc.documentElement)
}

/**
 * Готовит innerHTML-качества разметку к показу через `<img src=BlobURL>`.
 * Mermaid (securityLevel:'strict') прогоняет вывод через DOMPurify, чья
 * HTML-сериализация ломает XML: `<br/>` снова становится незакрытым `<br>`,
 * HTML-сущности (`&nbsp;`) остаются — строгий XML-парсер браузера в <img>
 * падает, и просмотр молча пустой. Плюс mermaid отдаёт width="100%" без
 * height, так что даже валидный SVG в <img> рендерится в дефолтные 300×150.
 *
 * Лечим оба: парсим ЛЕНИЕНТНЫМ HTML-парсером (чинит незакрытые теги и
 * сущности; document отсоединён — скрипты не исполняются) и, если размеры
 * относительные/отсутствуют, восстанавливаем их из viewBox. Возвращаем
 * гарантированно валидный XML. Контракт «SVG только через <img>, никогда
 * innerHTML» не меняется.
 */
export function normalizeSvgForImg(markup: string): string {
  if (!markup || typeof window === 'undefined') return markup
  const doc = new DOMParser().parseFromString(markup, 'text/html')
  const svg = doc.querySelector('svg')
  if (!svg) return markup
  const width = svg.getAttribute('width')
  const needsSize = !width || width.endsWith('%') || !svg.getAttribute('height')
  if (needsSize) {
    const viewBox = svg
      .getAttribute('viewBox')
      ?.trim()
      .split(/[\s,]+/)
      .map(Number)
    if (viewBox?.length === 4 && viewBox[2]! > 0 && viewBox[3]! > 0) {
      svg.setAttribute('width', String(viewBox[2]))
      svg.setAttribute('height', String(viewBox[3]))
    }
  }
  return new XMLSerializer().serializeToString(svg)
}
