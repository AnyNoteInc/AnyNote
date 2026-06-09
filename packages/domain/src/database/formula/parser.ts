// Recursive-descent parser for the database formula language. Pure, no deps.
// Precedence (loosest → tightest): || < && < comparison < additive <
// multiplicative < unary < primary. Left-associative within each binary level.

import { FormulaSyntaxError, type Token, type OperatorSymbol } from './tokenizer.ts'
import type { AstNode, BinaryOp, UnaryOp } from './ast.ts'

const COMPARISON_OPS = ['==', '!=', '>=', '<=', '>', '<'] as const
const ADDITIVE_OPS = ['+', '-'] as const
const MULTIPLICATIVE_OPS = ['*', '/'] as const

class Parser {
  private pos = 0
  private readonly tokens: Token[]

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  parse(): AstNode {
    if (this.tokens.length === 0) {
      throw new FormulaSyntaxError('Empty formula')
    }
    const node = this.parseOr()
    if (this.pos < this.tokens.length) {
      throw new FormulaSyntaxError('Unexpected trailing tokens')
    }
    return node
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos]
  }

  private next(): Token {
    const tok = this.tokens[this.pos]
    if (tok === undefined) {
      throw new FormulaSyntaxError('Unexpected end of input')
    }
    this.pos++
    return tok
  }

  private isOperator(...ops: readonly OperatorSymbol[]): boolean {
    const tok = this.peek()
    return tok?.type === 'operator' && ops.includes(tok.value)
  }

  // Generic left-associative binary level.
  private parseBinaryLeft(ops: readonly OperatorSymbol[], next: () => AstNode): AstNode {
    let left = next()
    while (this.isOperator(...ops)) {
      const op = (this.next() as { type: 'operator'; value: OperatorSymbol }).value
      const right = next()
      left = { kind: 'Binary', op: op as BinaryOp, left, right }
    }
    return left
  }

  private parseOr(): AstNode {
    return this.parseBinaryLeft(['||'], () => this.parseAnd())
  }

  private parseAnd(): AstNode {
    return this.parseBinaryLeft(['&&'], () => this.parseComparison())
  }

  private parseComparison(): AstNode {
    return this.parseBinaryLeft(COMPARISON_OPS, () => this.parseAdditive())
  }

  private parseAdditive(): AstNode {
    return this.parseBinaryLeft(ADDITIVE_OPS, () => this.parseMultiplicative())
  }

  private parseMultiplicative(): AstNode {
    return this.parseBinaryLeft(MULTIPLICATIVE_OPS, () => this.parseUnary())
  }

  private parseUnary(): AstNode {
    if (this.isOperator('!', '-')) {
      const op = (this.next() as { type: 'operator'; value: OperatorSymbol }).value
      const arg = this.parseUnary()
      return { kind: 'Unary', op: op as UnaryOp, arg }
    }
    return this.parsePrimary()
  }

  private parsePrimary(): AstNode {
    const tok = this.peek()
    if (tok === undefined) {
      throw new FormulaSyntaxError('Unexpected end of input')
    }

    if (tok.type === 'number') {
      this.next()
      return { kind: 'NumberLit', value: tok.value }
    }

    if (tok.type === 'string') {
      this.next()
      return { kind: 'StringLit', value: tok.value }
    }

    if (tok.type === 'lparen') {
      this.next() // consume '('
      const inner = this.parseOr()
      this.expect('rparen', "Expected ')'")
      return inner
    }

    if (tok.type === 'ident') {
      this.next()
      // Bare boolean literals.
      if (tok.value === 'true') return { kind: 'BoolLit', value: true }
      if (tok.value === 'false') return { kind: 'BoolLit', value: false }

      // Must be a call: an identifier is only valid as `name(...)`.
      this.expect('lparen', `Expected '(' after '${tok.value}'`)
      const args = this.parseArgs()
      this.expect('rparen', "Expected ')'")

      // prop("Name") is sugar for a property reference.
      if (tok.value === 'prop') {
        if (args.length !== 1 || args[0]?.kind !== 'StringLit') {
          throw new FormulaSyntaxError('prop() expects a single string-literal argument')
        }
        return { kind: 'PropRef', name: args[0].value }
      }

      return { kind: 'Call', fn: tok.value, args }
    }

    throw new FormulaSyntaxError(`Unexpected token '${tok.type}'`)
  }

  // Parses zero or more comma-separated argument expressions. Assumes the
  // opening paren has been consumed and stops before the closing paren.
  private parseArgs(): AstNode[] {
    const args: AstNode[] = []
    if (this.peek()?.type === 'rparen') {
      return args
    }
    args.push(this.parseOr())
    while (this.peek()?.type === 'comma') {
      this.next() // consume ','
      args.push(this.parseOr())
    }
    return args
  }

  private expect(type: Token['type'], message: string): void {
    if (this.peek()?.type !== type) {
      throw new FormulaSyntaxError(message)
    }
    this.pos++
  }
}

export function parse(tokens: Token[]): AstNode {
  return new Parser(tokens).parse()
}
