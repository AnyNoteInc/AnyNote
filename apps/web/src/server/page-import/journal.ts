/** Per-job human-readable import journal; rendered as the REPORT artifact. */
export class ImportJournal {
  private lines: string[] = []
  private warningLines: string[] = []

  constructor(
    private readonly source: string,
    private readonly fileName: string,
  ) {}

  action(msg: string): void {
    this.lines.push(`[ok] ${msg}`)
  }

  warn(msg: string): void {
    this.lines.push(`[!] ${msg}`)
    this.warningLines.push(msg)
  }

  skip(msg: string): void {
    this.lines.push(`[skip] ${msg}`)
    this.warningLines.push(msg)
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
