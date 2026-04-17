import { createElement, type ReactElement, type SVGProps } from "react"

// Inline SVG components so we don't need a custom webpack/SVGR loader.
// Each icon accepts standard SVG props and inherits stroke color from currentColor.

type IconProps = SVGProps<SVGSVGElement>

const base: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  width: 20,
  height: 20,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
}

const icon = (paths: ReactElement[]) => (props: IconProps) =>
  createElement("svg", { ...base, ...props }, paths)

export const Heading1Icon = icon([
  <path key="a" d="M4 12h8" />,
  <path key="b" d="M4 18V6" />,
  <path key="c" d="M12 18V6" />,
  <path key="d" d="M17 12l3-2v8" />,
])

export const Heading2Icon = icon([
  <path key="a" d="M4 12h8" />,
  <path key="b" d="M4 18V6" />,
  <path key="c" d="M12 18V6" />,
  <path key="d" d="M15 10c0-1.1.9-2 2-2s2 .9 2 2c0 1-1 2-2 3l-2 2h4" />,
])

export const Heading3Icon = icon([
  <path key="a" d="M4 12h8" />,
  <path key="b" d="M4 18V6" />,
  <path key="c" d="M12 18V6" />,
  <path key="d" d="M15 9h4l-2 3a2 2 0 1 1-1 3.7" />,
])

export const ParagraphIcon = icon([
  <path key="a" d="M13 4v16" />,
  <path key="b" d="M17 4v16" />,
  <path key="c" d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13" />,
])

export const BulletListIcon = icon([
  <line key="a" x1="8" y1="6" x2="21" y2="6" />,
  <line key="b" x1="8" y1="12" x2="21" y2="12" />,
  <line key="c" x1="8" y1="18" x2="21" y2="18" />,
  <circle key="d" cx="3.5" cy="6" r="1" />,
  <circle key="e" cx="3.5" cy="12" r="1" />,
  <circle key="f" cx="3.5" cy="18" r="1" />,
])

export const OrderedListIcon = icon([
  <line key="a" x1="10" y1="6" x2="21" y2="6" />,
  <line key="b" x1="10" y1="12" x2="21" y2="12" />,
  <line key="c" x1="10" y1="18" x2="21" y2="18" />,
  <path key="d" d="M4 6h1v4" />,
  <path key="e" d="M4 10h2" />,
  <path key="f" d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />,
])

export const TaskListIcon = icon([
  <rect key="a" x="3" y="5" width="6" height="6" rx="1" />,
  <path key="b" d="M4.5 8l1.5 1.5L8 7" />,
  <rect key="c" x="3" y="14" width="6" height="6" rx="1" />,
  <line key="d" x1="12" y1="8" x2="21" y2="8" />,
  <line key="e" x1="12" y1="17" x2="21" y2="17" />,
])

export const QuoteIcon = icon([
  <path key="a" d="M3 21c3 0 7-1 7-8V5c0-1-1-2-2-2H4c-1 0-2 1-2 2v6c0 1 1 2 2 2h3" />,
  <path key="b" d="M15 21c3 0 7-1 7-8V5c0-1-1-2-2-2h-4c-1 0-2 1-2 2v6c0 1 1 2 2 2h3" />,
])

export const CodeIcon = icon([
  <polyline key="a" points="16 18 22 12 16 6" />,
  <polyline key="b" points="8 6 2 12 8 18" />,
])

export const DividerIcon = icon([<line key="a" x1="3" y1="12" x2="21" y2="12" />])

export const TableIcon = icon([
  <rect key="a" x="3" y="4" width="18" height="16" rx="2" />,
  <line key="b" x1="3" y1="10" x2="21" y2="10" />,
  <line key="c" x1="3" y1="16" x2="21" y2="16" />,
  <line key="d" x1="10" y1="4" x2="10" y2="20" />,
  <line key="e" x1="16" y1="4" x2="16" y2="20" />,
])
