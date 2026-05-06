import { Fragment } from 'react'

const REGEX_META = /[.*+?^${}()|[\]\\]/g

function escapeRegex(input: string): string {
  return input.replaceAll(REGEX_META, String.raw`\$&`)
}

type Props = Readonly<{ text: string; query: string }>

export function HighlightMatches({ text, query }: Props) {
  const trimmed = query.trim()
  if (!trimmed) return <>{text}</>

  const re = new RegExp(`(${escapeRegex(trimmed)})`, 'gi')
  const parts = text.split(re)

  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <mark key={`m-${index}-${part}`}>{part}</mark>
        ) : (
          <Fragment key={`p-${index}-${part}`}>{part}</Fragment>
        ),
      )}
    </>
  )
}
