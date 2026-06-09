// Public entry point for the database formula engine. Sandboxed by construction:
// tokenize → parse → evaluate against a plain scope object and a function
// whitelist. There is NO eval/Function/global access anywhere in this module.
//
// `runFormula(expression, scope)` is the single call the view-model uses; all
// errors (syntax or evaluation) surface as a `{ __error }` sentinel value.

import { tokenize, FormulaSyntaxError } from './tokenizer.ts'
import { parse } from './parser.ts'
import { evaluate } from './evaluator.ts'
import type { FormulaValue } from './functions.ts'

export { tokenize, FormulaSyntaxError } from './tokenizer.ts'
export { parse } from './parser.ts'
export { evaluate } from './evaluator.ts'
export { FUNCTIONS, isFormulaError } from './functions.ts'
export type { FormulaValue, FormulaFunction } from './functions.ts'
export type { Token, OperatorSymbol } from './tokenizer.ts'
export type { AstNode } from './ast.ts'
export { astNodeSchema } from './ast.ts'

/**
 * Tokenize, parse, and evaluate a formula expression against a scope.
 * Any syntax or evaluation failure is caught and returned as `{ __error }`.
 */
export function runFormula(
  expression: string,
  scope: Record<string, unknown>,
): FormulaValue {
  try {
    const ast = parse(tokenize(expression))
    return evaluate(ast, scope)
  } catch (e) {
    if (e instanceof FormulaSyntaxError) {
      return { __error: e.message }
    }
    return { __error: e instanceof Error ? e.message : 'formula error' }
  }
}
