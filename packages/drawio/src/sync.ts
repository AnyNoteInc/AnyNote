import type * as Y from 'yjs'

/**
 * Replace the entire Y.Text content with `xml` in a single local transaction.
 * Running in one transaction means the board's observer sees exactly one event
 * with `transaction.local === true`, which it uses to skip reloading the iframe
 * from our own write (only remote peers' saves trigger a reload).
 */
export function writeXmlToYText(ydoc: Y.Doc, ytext: Y.Text, xml: string): void {
  ydoc.transact(() => {
    if (ytext.length > 0) ytext.delete(0, ytext.length)
    if (xml) ytext.insert(0, xml)
  })
}
