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
