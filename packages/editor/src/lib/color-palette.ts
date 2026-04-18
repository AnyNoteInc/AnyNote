export const TEXT_COLOR_KEYS = [
  "default",
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
] as const

export type TextColorKey = (typeof TEXT_COLOR_KEYS)[number]

export const TEXT_COLOR_LABELS: Record<TextColorKey, string> = {
  default: "По умолчанию",
  gray: "Серый",
  brown: "Коричневый",
  orange: "Оранжевый",
  yellow: "Жёлтый",
  green: "Зелёный",
  blue: "Голубой",
  purple: "Фиолетовый",
  pink: "Розовый",
  red: "Красный",
}

export const BACKGROUND_COLOR_KEYS = TEXT_COLOR_KEYS
export type BackgroundColorKey = TextColorKey
export const BACKGROUND_COLOR_LABELS: Record<BackgroundColorKey, string> = {
  ...TEXT_COLOR_LABELS,
  blue: "Синий",
}

// CSS-variable-backed preview swatches for menu items.
export function textColorSwatch(key: TextColorKey): string {
  if (key === "default") return "transparent"
  return `var(--anynote-color-${key})`
}

export function backgroundColorSwatch(key: BackgroundColorKey): string {
  if (key === "default") return "transparent"
  return `var(--anynote-bg-${key})`
}
