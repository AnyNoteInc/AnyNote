export const chatTokens = {
  maxContentWidth: 720,
  bubbleRadius: 16,
  composerRadius: 24,
  composerMaxHeight: "40vh",
  bubbleSpacing: 1.5,
  groupSpacing: 3,
  scrollPinThresholdPx: 80,
} as const

export type ChatTokens = typeof chatTokens
