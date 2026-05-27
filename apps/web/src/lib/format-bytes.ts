export function formatBytes(bytes: bigint | number, fractionDigits = 1): string {
  const n = typeof bytes === 'bigint' ? Number(bytes) : bytes
  if (n < 1024) return `${n} Б`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(fractionDigits)} КБ`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(fractionDigits)} МБ`
  return `${(n / 1024 ** 3).toFixed(fractionDigits)} ГБ`
}
