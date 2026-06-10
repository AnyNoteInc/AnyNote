/** Hard cap on recorded lines: a pathological archive must not balloon the report. */
const MAX_LINES = 20_000
const TRUNCATION_NOTE = 'Журнал усечён — слишком много записей'

/** Per-job human-readable import journal; rendered as the REPORT artifact. */
export class ImportJournal {
  private lines: string[] = []
  private warningLines: string[] = []
  private truncated = false

  constructor(
    private readonly source: string,
    private readonly fileName: string,
  ) {}

  action(msg: string): void {
    this.record(`[ok] ${msg}`)
  }

  warn(msg: string): void {
    if (this.record(`[!] ${msg}`)) this.warningLines.push(msg)
  }

  skip(msg: string): void {
    if (this.record(`[skip] ${msg}`)) this.warningLines.push(msg)
  }

  /** Append the line unless the cap is hit; past it, note the truncation once. */
  private record(line: string): boolean {
    if (this.lines.length >= MAX_LINES) {
      if (!this.truncated) {
        this.truncated = true
        this.lines.push(`[!] ${TRUNCATION_NOTE}`)
        this.warningLines.push(TRUNCATION_NOTE)
      }
      return false
    }
    this.lines.push(line)
    return true
  }

  get warnings(): string[] {
    return [...this.warningLines]
  }

  render(): string {
    return [
      `Журнал импорта AnyNote`,
      `Источник: ${this.source}`,
      `Файл: ${this.fileName}`,
      '',
      ...this.lines,
      '',
      `Предупреждений: ${this.warningLines.length}`,
    ].join('\n')
  }
}
