// Pure, dependency-free tokenizer for the database formula language.
// Sandboxed by construction: produces a flat token stream only — no eval, no
// access to globals. Source → Token[]; malformed input throws FormulaSyntaxError.

/** Thrown for any lexical or (later) syntactic error in a formula source. */
export class FormulaSyntaxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FormulaSyntaxError'
  }
}

export type Token =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'ident'; value: string }
  | { type: 'operator'; value: OperatorSymbol }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'comma' }

export type OperatorSymbol =
  | '+'
  | '-'
  | '*'
  | '/'
  | '=='
  | '!='
  | '>='
  | '<='
  | '>'
  | '<'
  | '&&'
  | '||'
  | '!'

// Two-character operators are matched before their single-character prefixes.
const TWO_CHAR_OPERATORS = ['==', '!=', '>=', '<=', '&&', '||'] as const
const ONE_CHAR_OPERATORS = ['+', '-', '*', '/', '>', '<', '!'] as const

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9'
}

function isIdentStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_'
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch)
}

export function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const n = src.length

  while (i < n) {
    const ch = src[i] as string

    // Whitespace.
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++
      continue
    }

    // Parens and comma.
    if (ch === '(') {
      tokens.push({ type: 'lparen' })
      i++
      continue
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen' })
      i++
      continue
    }
    if (ch === ',') {
      tokens.push({ type: 'comma' })
      i++
      continue
    }

    // Strings (double-quoted, with \\ and \" escapes).
    if (ch === '"') {
      let value = ''
      i++ // consume opening quote
      let closed = false
      while (i < n) {
        const c = src[i] as string
        if (c === '\\') {
          const next = src[i + 1]
          if (next === undefined) {
            throw new FormulaSyntaxError('Unterminated string literal')
          }
          value += next
          i += 2
          continue
        }
        if (c === '"') {
          closed = true
          i++
          break
        }
        value += c
        i++
      }
      if (!closed) {
        throw new FormulaSyntaxError('Unterminated string literal')
      }
      tokens.push({ type: 'string', value })
      continue
    }

    // Numbers (integer or decimal).
    if (isDigit(ch) || (ch === '.' && isDigit(src[i + 1] ?? ''))) {
      let raw = ''
      while (i < n && isDigit(src[i] as string)) {
        raw += src[i]
        i++
      }
      if (src[i] === '.') {
        raw += '.'
        i++
        while (i < n && isDigit(src[i] as string)) {
          raw += src[i]
          i++
        }
      }
      tokens.push({ type: 'number', value: Number(raw) })
      continue
    }

    // Identifiers / function names.
    if (isIdentStart(ch)) {
      let raw = ''
      while (i < n && isIdentPart(src[i] as string)) {
        raw += src[i]
        i++
      }
      tokens.push({ type: 'ident', value: raw })
      continue
    }

    // Two-character operators (must be tried before single-char ones).
    const twoChar = src.slice(i, i + 2)
    if ((TWO_CHAR_OPERATORS as readonly string[]).includes(twoChar)) {
      tokens.push({ type: 'operator', value: twoChar as OperatorSymbol })
      i += 2
      continue
    }

    // Single-character operators.
    if ((ONE_CHAR_OPERATORS as readonly string[]).includes(ch)) {
      tokens.push({ type: 'operator', value: ch as OperatorSymbol })
      i++
      continue
    }

    throw new FormulaSyntaxError(`Unexpected character '${ch}' at position ${i}`)
  }

  return tokens
}
