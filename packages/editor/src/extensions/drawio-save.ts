export type DrawioNodeAttrs = {
  /** mxGraph XML — the editable source. */
  xml: string
  /** Rendered SVG as a data URL — the preview image. */
  svg: string
}

export type DrawioSaveInput = {
  /** Latest XML captured from the embed's autosave events. */
  latestXml: string
  /** XML the editor modal was opened with. */
  initialXml: string
  /** Data URL returned by exportDiagram({ format: 'xmlsvg' }). */
  exportData: string
}

export function finalizeDrawioSave({
  latestXml,
  initialXml,
  exportData,
}: DrawioSaveInput): DrawioNodeAttrs {
  return { xml: latestXml || initialXml, svg: exportData }
}
