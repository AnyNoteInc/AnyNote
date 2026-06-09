import { describe, it, expect } from 'vitest'

import { tokenize, FormulaSyntaxError } from '../../../src/database/formula/tokenizer.ts'

describe('tokenize — numbers', () => {
  it('tokenizes a single integer', () => {
    expect(tokenize('42')).toEqual([{ type: 'number', value: 42 }])
  })

  it('tokenizes a decimal number', () => {
    expect(tokenize('3.14')).toEqual([{ type: 'number', value: 3.14 }])
  })

  it('tokenizes a simple addition expression', () => {
    expect(tokenize('1 + 2')).toEqual([
      { type: 'number', value: 1 },
      { type: 'operator', value: '+' },
      { type: 'number', value: 2 },
    ])
  })
})

describe('tokenize — strings', () => {
  it('tokenizes a double-quoted string', () => {
    expect(tokenize('"abc"')).toEqual([{ type: 'string', value: 'abc' }])
  })

  it('tokenizes an empty string', () => {
    expect(tokenize('""')).toEqual([{ type: 'string', value: '' }])
  })

  it('supports escaped quotes and backslashes inside strings', () => {
    expect(tokenize('"a\\"b\\\\c"')).toEqual([{ type: 'string', value: 'a"b\\c' }])
  })

  it('throws FormulaSyntaxError on an unterminated string', () => {
    expect(() => tokenize('"abc')).toThrow(FormulaSyntaxError)
  })
})

describe('tokenize — identifiers and calls', () => {
  it('tokenizes a bare identifier', () => {
    expect(tokenize('foo')).toEqual([{ type: 'ident', value: 'foo' }])
  })

  it('tokenizes prop("Name") as ident + lparen + string + rparen', () => {
    expect(tokenize('prop("Name")')).toEqual([
      { type: 'ident', value: 'prop' },
      { type: 'lparen' },
      { type: 'string', value: 'Name' },
      { type: 'rparen' },
    ])
  })

  it('tokenizes a function call with comma-separated args', () => {
    expect(tokenize('if(a, b, c)')).toEqual([
      { type: 'ident', value: 'if' },
      { type: 'lparen' },
      { type: 'ident', value: 'a' },
      { type: 'comma' },
      { type: 'ident', value: 'b' },
      { type: 'comma' },
      { type: 'ident', value: 'c' },
      { type: 'rparen' },
    ])
  })
})

describe('tokenize — operators', () => {
  it('tokenizes every supported operator', () => {
    expect(tokenize('+ - * / == != >= <= > < && || !')).toEqual([
      { type: 'operator', value: '+' },
      { type: 'operator', value: '-' },
      { type: 'operator', value: '*' },
      { type: 'operator', value: '/' },
      { type: 'operator', value: '==' },
      { type: 'operator', value: '!=' },
      { type: 'operator', value: '>=' },
      { type: 'operator', value: '<=' },
      { type: 'operator', value: '>' },
      { type: 'operator', value: '<' },
      { type: 'operator', value: '&&' },
      { type: 'operator', value: '||' },
      { type: 'operator', value: '!' },
    ])
  })

  it('distinguishes > from >= and ! from !=', () => {
    expect(tokenize('a>=1')).toEqual([
      { type: 'ident', value: 'a' },
      { type: 'operator', value: '>=' },
      { type: 'number', value: 1 },
    ])
    expect(tokenize('a>1')).toEqual([
      { type: 'ident', value: 'a' },
      { type: 'operator', value: '>' },
      { type: 'number', value: 1 },
    ])
  })
})

describe('tokenize — whitespace and errors', () => {
  it('skips arbitrary whitespace including tabs and newlines', () => {
    expect(tokenize('  1\t+\n2  ')).toEqual([
      { type: 'number', value: 1 },
      { type: 'operator', value: '+' },
      { type: 'number', value: 2 },
    ])
  })

  it('returns an empty array for an empty source', () => {
    expect(tokenize('')).toEqual([])
  })

  it('throws FormulaSyntaxError on an unknown character', () => {
    expect(() => tokenize('1 @ 2')).toThrow(FormulaSyntaxError)
  })

  it('throws FormulaSyntaxError on a lone ampersand', () => {
    expect(() => tokenize('a & b')).toThrow(FormulaSyntaxError)
  })
})
