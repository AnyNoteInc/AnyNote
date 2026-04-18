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

const icon = (name: string, paths: ReactElement[]) => {
  const Component = (props: IconProps) => createElement("svg", { ...base, ...props }, paths)
  Component.displayName = name
  return Component
}

export const Heading1Icon = icon("Heading1Icon", [
  <path key="a" d="M4 12h8" />,
  <path key="b" d="M4 18V6" />,
  <path key="c" d="M12 18V6" />,
  <path key="d" d="M17 12l3-2v8" />,
])

export const Heading2Icon = icon("Heading2Icon", [
  <path key="a" d="M4 12h8" />,
  <path key="b" d="M4 18V6" />,
  <path key="c" d="M12 18V6" />,
  <path key="d" d="M15 10c0-1.1.9-2 2-2s2 .9 2 2c0 1-1 2-2 3l-2 2h4" />,
])

export const Heading3Icon = icon("Heading3Icon", [
  <path key="a" d="M4 12h8" />,
  <path key="b" d="M4 18V6" />,
  <path key="c" d="M12 18V6" />,
  <path key="d" d="M15 9h4l-2 3a2 2 0 1 1-1 3.7" />,
])

export const Heading4Icon = icon("Heading4Icon", [
  <path key="a" d="M4 12h8" />,
  <path key="b" d="M4 18V6" />,
  <path key="c" d="M12 18V6" />,
  <path key="d" d="M16 8v5h4" />,
  <path key="e" d="M20 8v10" />,
])

export const ParagraphIcon = icon("ParagraphIcon", [
  <path key="a" d="M13 4v16" />,
  <path key="b" d="M17 4v16" />,
  <path key="c" d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13" />,
])

export const TextIcon = (props: IconProps) =>
  createElement(
    "svg",
    { ...base, strokeWidth: 2.2, ...props },
    <line key="a" x1="5" y1="6" x2="19" y2="6" />,
    <line key="b" x1="12" y1="6" x2="12" y2="19" />,
  )

export const BulletListIcon = icon("BulletListIcon", [
  <line key="a" x1="8" y1="6" x2="21" y2="6" />,
  <line key="b" x1="8" y1="12" x2="21" y2="12" />,
  <line key="c" x1="8" y1="18" x2="21" y2="18" />,
  <circle key="d" cx="3.5" cy="6" r="1" />,
  <circle key="e" cx="3.5" cy="12" r="1" />,
  <circle key="f" cx="3.5" cy="18" r="1" />,
])

export const OrderedListIcon = icon("OrderedListIcon", [
  <line key="a" x1="10" y1="6" x2="21" y2="6" />,
  <line key="b" x1="10" y1="12" x2="21" y2="12" />,
  <line key="c" x1="10" y1="18" x2="21" y2="18" />,
  <path key="d" d="M4 6h1v4" />,
  <path key="e" d="M4 10h2" />,
  <path key="f" d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />,
])

export const TaskListIcon = icon("TaskListIcon", [
  <rect key="a" x="3" y="5" width="6" height="6" rx="1" />,
  <path key="b" d="M4.5 8l1.5 1.5L8 7" />,
  <rect key="c" x="3" y="14" width="6" height="6" rx="1" />,
  <line key="d" x1="12" y1="8" x2="21" y2="8" />,
  <line key="e" x1="12" y1="17" x2="21" y2="17" />,
])

export const QuoteIcon = icon("QuoteIcon", [
  <path key="a" d="M3 21c3 0 7-1 7-8V5c0-1-1-2-2-2H4c-1 0-2 1-2 2v6c0 1 1 2 2 2h3" />,
  <path key="b" d="M15 21c3 0 7-1 7-8V5c0-1-1-2-2-2h-4c-1 0-2 1-2 2v6c0 1 1 2 2 2h3" />,
])

export const CodeIcon = icon("CodeIcon", [
  <polyline key="a" points="16 18 22 12 16 6" />,
  <polyline key="b" points="8 6 2 12 8 18" />,
])

export const DividerIcon = icon("DividerIcon", [<line key="a" x1="3" y1="12" x2="21" y2="12" />])

export const TableIcon = icon("TableIcon", [
  <rect key="a" x="3" y="4" width="18" height="16" rx="2" />,
  <line key="b" x1="3" y1="10" x2="21" y2="10" />,
  <line key="c" x1="3" y1="16" x2="21" y2="16" />,
  <line key="d" x1="10" y1="4" x2="10" y2="20" />,
  <line key="e" x1="16" y1="4" x2="16" y2="20" />,
])

export const InsertColumnLeftIcon = icon("InsertColumnLeftIcon", [
  <rect key="a" x="10" y="4" width="10" height="16" rx="1" />,
  <line key="b" x1="15" y1="4" x2="15" y2="20" />,
  <line key="c" x1="5" y1="12" x2="1" y2="12" />,
  <line key="d" x1="3" y1="10" x2="3" y2="14" />,
])

export const InsertColumnRightIcon = icon("InsertColumnRightIcon", [
  <rect key="a" x="4" y="4" width="10" height="16" rx="1" />,
  <line key="b" x1="9" y1="4" x2="9" y2="20" />,
  <line key="c" x1="19" y1="12" x2="23" y2="12" />,
  <line key="d" x1="21" y1="10" x2="21" y2="14" />,
])

export const DeleteColumnIcon = icon("DeleteColumnIcon", [
  <rect key="a" x="3" y="4" width="6" height="16" rx="1" />,
  <rect key="b" x="15" y="4" width="6" height="16" rx="1" />,
  <line key="c" x1="10.5" y1="8" x2="13.5" y2="11" />,
  <line key="d" x1="13.5" y1="8" x2="10.5" y2="11" />,
])

export const InsertRowUpIcon = icon("InsertRowUpIcon", [
  <rect key="a" x="4" y="10" width="16" height="10" rx="1" />,
  <line key="b" x1="4" y1="15" x2="20" y2="15" />,
  <line key="c" x1="12" y1="5" x2="12" y2="1" />,
  <line key="d" x1="10" y1="3" x2="14" y2="3" />,
])

export const InsertRowDownIcon = icon("InsertRowDownIcon", [
  <rect key="a" x="4" y="4" width="16" height="10" rx="1" />,
  <line key="b" x1="4" y1="9" x2="20" y2="9" />,
  <line key="c" x1="12" y1="19" x2="12" y2="23" />,
  <line key="d" x1="10" y1="21" x2="14" y2="21" />,
])

export const DeleteRowIcon = icon("DeleteRowIcon", [
  <rect key="a" x="4" y="3" width="16" height="6" rx="1" />,
  <rect key="b" x="4" y="15" width="16" height="6" rx="1" />,
  <line key="c" x1="8" y1="10.5" x2="11" y2="13.5" />,
  <line key="d" x1="11" y1="10.5" x2="8" y2="13.5" />,
])

export const DeleteTableIcon = (props: IconProps) =>
  createElement(
    "svg",
    { ...base, ...props },
    <rect key="a" x="3" y="4" width="18" height="16" rx="2" />,
    <line key="b" x1="3" y1="10" x2="21" y2="10" />,
    <line key="c" x1="3" y1="16" x2="21" y2="16" />,
    <line key="d" x1="10" y1="4" x2="10" y2="20" />,
    <line key="e" x1="16" y1="4" x2="16" y2="20" />,
    <line key="f" x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth={2.5} />,
    <line key="g" x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth={2.5} />,
  )

export const ImageIcon = icon("ImageIcon", [
  <rect key="a" x="3" y="4" width="18" height="16" rx="2" />,
  <circle key="b" cx="9" cy="10" r="1.5" />,
  <path key="c" d="m21 16-4-4-6 6-3-3-5 5" />,
])

export const FileIcon = icon("FileIcon", [
  <path key="a" d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />,
  <polyline key="b" points="14 3 14 8 19 8" />,
])

export const PageLinkIcon = icon("PageLinkIcon", [
  <path key="a" d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />,
  <polyline key="b" points="14 3 14 8 19 8" />,
  <path key="c" d="M9 13h6" />,
  <path key="d" d="M9 17h4" />,
])

export const DownloadIcon = icon("DownloadIcon", [
  <path key="a" d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />,
  <polyline key="b" points="7 10 12 15 17 10" />,
  <line key="c" x1="12" y1="15" x2="12" y2="3" />,
])

export const CalloutIcon = icon("CalloutIcon", [
  <rect key="a" x="3" y="5" width="18" height="14" rx="2" />,
  <circle key="b" cx="8" cy="10" r="1.2" />,
  <path key="c" d="M12 10h5" />,
  <path key="d" d="M7 14h10" />,
])

export const MarkdownIcon = icon("MarkdownIcon", [
  <rect key="a" x="3" y="5" width="18" height="14" rx="2" />,
  <path key="b" d="M7 15V9l2.5 3L12 9v6" />,
  <path key="c" d="M16 9v6" />,
  <path key="d" d="M14 13l2 2 2-2" />,
])
