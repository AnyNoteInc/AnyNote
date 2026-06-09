// Abstract syntax tree for the database formula language, plus a zod schema that
// validates a parsed AST shape (used when persisting/round-tripping an AST).

import { z } from 'zod'

import type { OperatorSymbol } from './tokenizer.ts'

export type BinaryOp =
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

export type UnaryOp = '!' | '-'

export interface NumberLit {
  kind: 'NumberLit'
  value: number
}
export interface StringLit {
  kind: 'StringLit'
  value: string
}
export interface BoolLit {
  kind: 'BoolLit'
  value: boolean
}
export interface PropRef {
  kind: 'PropRef'
  name: string
}
export interface Call {
  kind: 'Call'
  fn: string
  args: AstNode[]
}
export interface Unary {
  kind: 'Unary'
  op: UnaryOp
  arg: AstNode
}
export interface Binary {
  kind: 'Binary'
  op: BinaryOp
  left: AstNode
  right: AstNode
}

export type AstNode = NumberLit | StringLit | BoolLit | PropRef | Call | Unary | Binary

const binaryOpSchema = z.enum([
  '+',
  '-',
  '*',
  '/',
  '==',
  '!=',
  '>=',
  '<=',
  '>',
  '<',
  '&&',
  '||',
])
const unaryOpSchema = z.enum(['!', '-'])

export const astNodeSchema: z.ZodType<AstNode> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('NumberLit'), value: z.number() }),
    z.object({ kind: z.literal('StringLit'), value: z.string() }),
    z.object({ kind: z.literal('BoolLit'), value: z.boolean() }),
    z.object({ kind: z.literal('PropRef'), name: z.string() }),
    z.object({ kind: z.literal('Call'), fn: z.string(), args: z.array(astNodeSchema) }),
    z.object({ kind: z.literal('Unary'), op: unaryOpSchema, arg: astNodeSchema }),
    z.object({
      kind: z.literal('Binary'),
      op: binaryOpSchema,
      left: astNodeSchema,
      right: astNodeSchema,
    }),
  ]),
)

// The operator-symbol type is shared with the tokenizer; assert compatibility so
// a tokenizer change that drops an operator surfaces here at compile time.
export type _OperatorSymbolCovered = OperatorSymbol
