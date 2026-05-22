declare module 'plantuml-encoder' {
  export function encode(text: string): string
  export function decode(encoded: string): string
  const _default: { encode: (text: string) => string; decode: (encoded: string) => string }
  export default _default
}
