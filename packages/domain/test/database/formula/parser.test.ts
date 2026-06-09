import { describe, it, expect } from 'vitest'

import { tokenize, FormulaSyntaxError } from '../../../src/database/formula/tokenizer.ts'
import { parse } from '../../../src/database/formula/parser.ts'
import { astNodeSchema } from '../../../src/database/formula/ast.ts'

const p = (src: string) => parse(tokenize(src))

describe('parse — literals', () => {
  it('parses a number literal', () => {
    expect(p('42')).toEqual({ kind: 'NumberLit', value: 42 })
  })

  it('parses a string literal', () => {
    expect(p('"hi"')).toEqual({ kind: 'StringLit', value: 'hi' })
  })

  it('parses true/false as BoolLit', () => {
    expect(p('true')).toEqual({ kind: 'BoolLit', value: true })
    expect(p('false')).toEqual({ kind: 'BoolLit', value: false })
  })
})

describe('parse — prop refs', () => {
  it('parses prop("A") to a PropRef', () => {
    expect(p('prop("A")')).toEqual({ kind: 'PropRef', name: 'A' })
  })

  it('parses prop with a multi-word name', () => {
    expect(p('prop("Due Date")')).toEqual({ kind: 'PropRef', name: 'Due Date' })
  })

  it('rejects prop() without a string argument', () => {
    expect(() => p('prop(1)')).toThrow(FormulaSyntaxError)
    expect(() => p('prop()')).toThrow(FormulaSyntaxError)
  })
})

describe('parse — arithmetic precedence', () => {
  it('binds * tighter than +', () => {
    expect(p('1 + 2 * 3')).toEqual({
      kind: 'Binary',
      op: '+',
      left: { kind: 'NumberLit', value: 1 },
      right: {
        kind: 'Binary',
        op: '*',
        left: { kind: 'NumberLit', value: 2 },
        right: { kind: 'NumberLit', value: 3 },
      },
    })
  })

  it('lets parens override precedence', () => {
    expect(p('(1 + 2) * 3')).toEqual({
      kind: 'Binary',
      op: '*',
      left: {
        kind: 'Binary',
        op: '+',
        left: { kind: 'NumberLit', value: 1 },
        right: { kind: 'NumberLit', value: 2 },
      },
      right: { kind: 'NumberLit', value: 3 },
    })
  })

  it('treats + and - as left-associative', () => {
    expect(p('1 - 2 - 3')).toEqual({
      kind: 'Binary',
      op: '-',
      left: {
        kind: 'Binary',
        op: '-',
        left: { kind: 'NumberLit', value: 1 },
        right: { kind: 'NumberLit', value: 2 },
      },
      right: { kind: 'NumberLit', value: 3 },
    })
  })
})

describe('parse — logical and comparison precedence', () => {
  it('binds && tighter than ||', () => {
    // a || b && c  ==  a || (b && c)
    expect(p('prop("a") || prop("b") && prop("c")')).toEqual({
      kind: 'Binary',
      op: '||',
      left: { kind: 'PropRef', name: 'a' },
      right: {
        kind: 'Binary',
        op: '&&',
        left: { kind: 'PropRef', name: 'b' },
        right: { kind: 'PropRef', name: 'c' },
      },
    })
  })
})

describe('parse — comparison vs arithmetic', () => {
  it('binds arithmetic tighter than comparison', () => {
    expect(p('1 + 2 > 3')).toEqual({
      kind: 'Binary',
      op: '>',
      left: {
        kind: 'Binary',
        op: '+',
        left: { kind: 'NumberLit', value: 1 },
        right: { kind: 'NumberLit', value: 2 },
      },
      right: { kind: 'NumberLit', value: 3 },
    })
  })
})

describe('parse — unary', () => {
  it('parses logical not over a call', () => {
    expect(p('!empty(prop("x"))')).toEqual({
      kind: 'Unary',
      op: '!',
      arg: {
        kind: 'Call',
        fn: 'empty',
        args: [{ kind: 'PropRef', name: 'x' }],
      },
    })
  })

  it('parses unary minus', () => {
    expect(p('-5')).toEqual({
      kind: 'Unary',
      op: '-',
      arg: { kind: 'NumberLit', value: 5 },
    })
  })
})

describe('parse — calls', () => {
  it('parses if(prop("x") > 1, "hi", "lo")', () => {
    expect(p('if(prop("x") > 1, "hi", "lo")')).toEqual({
      kind: 'Call',
      fn: 'if',
      args: [
        {
          kind: 'Binary',
          op: '>',
          left: { kind: 'PropRef', name: 'x' },
          right: { kind: 'NumberLit', value: 1 },
        },
        { kind: 'StringLit', value: 'hi' },
        { kind: 'StringLit', value: 'lo' },
      ],
    })
  })

  it('parses a zero-argument call', () => {
    expect(p('now()')).toEqual({ kind: 'Call', fn: 'now', args: [] })
  })
})

describe('parse — errors', () => {
  it('throws on an empty token stream', () => {
    expect(() => parse([])).toThrow(FormulaSyntaxError)
  })

  it('throws on unbalanced parens', () => {
    expect(() => p('(1 + 2')).toThrow(FormulaSyntaxError)
  })

  it('throws on trailing tokens', () => {
    expect(() => p('1 2')).toThrow(FormulaSyntaxError)
  })

  it('throws on a dangling operator', () => {
    expect(() => p('1 +')).toThrow(FormulaSyntaxError)
  })

  it('rejects a deeply-nested expression instead of overflowing the stack', () => {
    const deepParens = `${'('.repeat(500)}1${')'.repeat(500)}`
    expect(() => p(deepParens)).toThrow(FormulaSyntaxError)
    const deepUnary = `${'!'.repeat(500)}1`
    expect(() => p(deepUnary)).toThrow(FormulaSyntaxError)
  })
})

describe('astNodeSchema', () => {
  it('validates a parsed AST', () => {
    const ast = p('if(prop("x") > 1, "hi", "lo")')
    expect(astNodeSchema.safeParse(ast).success).toBe(true)
  })

  it('rejects a malformed AST node', () => {
    expect(astNodeSchema.safeParse({ kind: 'Nope' }).success).toBe(false)
  })
})
