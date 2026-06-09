// Tree-walking evaluator for the formula AST. Sandboxed by construction: it only
// reads from the provided `scope` and the FUNCTIONS whitelist — there is no eval,
// no Function constructor, no access to host globals. Errors surface as a
// `{ __error }` sentinel value rather than thrown exceptions.

import type { AstNode } from './ast.ts'
import { FUNCTIONS, isFormulaError, type FormulaValue } from './functions.ts'

function err(message: string): { __error: string } {
  return { __error: message }
}

// Map a raw scope entry into the FormulaValue domain. Unknown/undefined → null.
function coerceScopeValue(raw: unknown): FormulaValue {
  if (raw === undefined || raw === null) return null
  if (
    typeof raw === 'string' ||
    typeof raw === 'number' ||
    typeof raw === 'boolean' ||
    raw instanceof Date
  ) {
    return raw
  }
  if (isFormulaError(raw)) return raw
  // Arrays are kept as-is so empty()/length() can inspect them; everything else
  // collapses to a string for forgiving Notion-like behavior.
  if (Array.isArray(raw)) return raw as unknown as FormulaValue
  return null
}

function toNum(v: FormulaValue): number {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isNaN(n) ? NaN : n
  }
  return NaN
}

function toBool(v: FormulaValue): boolean {
  if (typeof v === 'boolean') return v
  if (v === null) return false
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') return v.length > 0
  if (Array.isArray(v)) return (v as unknown[]).length > 0
  return Boolean(v)
}

function looseEquals(a: FormulaValue, b: FormulaValue): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (a === null || b === null) return a === b
  if (typeof a === 'number' || typeof b === 'number') {
    const na = toNum(a)
    const nb = toNum(b)
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb
  }
  return a === b
}

function evalBinary(
  op: string,
  left: FormulaValue,
  right: FormulaValue,
): FormulaValue {
  // Error propagation: any error operand short-circuits.
  if (isFormulaError(left)) return left
  if (isFormulaError(right)) return right

  switch (op) {
    case '+':
      return toNum(left) + toNum(right)
    case '-':
      return toNum(left) - toNum(right)
    case '*':
      return toNum(left) * toNum(right)
    case '/': {
      const divisor = toNum(right)
      if (divisor === 0) return err('division by zero')
      return toNum(left) / divisor
    }
    case '==':
      return looseEquals(left, right)
    case '!=':
      return !looseEquals(left, right)
    case '>':
      return toNum(left) > toNum(right)
    case '>=':
      return toNum(left) >= toNum(right)
    case '<':
      return toNum(left) < toNum(right)
    case '<=':
      return toNum(left) <= toNum(right)
    case '&&':
      return toBool(left) && toBool(right)
    case '||':
      return toBool(left) || toBool(right)
    default:
      return err(`unknown operator: ${op}`)
  }
}

export function evaluate(node: AstNode, scope: Record<string, unknown>): FormulaValue {
  switch (node.kind) {
    case 'NumberLit':
      return node.value
    case 'StringLit':
      return node.value
    case 'BoolLit':
      return node.value

    case 'PropRef': {
      // Own-property lookup only — never reaches prototype members like
      // `constructor`/`__proto__`, keeping the sandbox intact.
      if (!Object.prototype.hasOwnProperty.call(scope, node.name)) return null
      return coerceScopeValue(scope[node.name])
    }

    case 'Unary': {
      const arg = evaluate(node.arg, scope)
      if (isFormulaError(arg)) return arg
      if (node.op === '!') return !toBool(arg)
      // unary '-'
      return -toNum(arg)
    }

    case 'Binary': {
      const left = evaluate(node.left, scope)
      if (isFormulaError(left)) return left
      const right = evaluate(node.right, scope)
      return evalBinary(node.op, left, right)
    }

    case 'Call': {
      const fn = FUNCTIONS[node.fn]
      if (fn === undefined) return err(`unknown function: ${node.fn}`)
      const args: FormulaValue[] = []
      for (const argNode of node.args) {
        const v = evaluate(argNode, scope)
        // Propagate the first error operand without calling the function.
        if (isFormulaError(v)) return v
        args.push(v)
      }
      return fn(args)
    }

    default: {
      // Exhaustiveness guard.
      const _never: never = node
      return err('unknown node')
    }
  }
}
