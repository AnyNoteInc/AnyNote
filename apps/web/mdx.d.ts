// Pulls in @types/mdx's ambient `declare module '*.md' | '*.mdx'` so `.md`
// imports (e.g. the @docs/* developer-portal and legal documents) type-check.
// Needed explicitly since TypeScript 6.0 changed the `types` compiler option to
// default to `[]`, which stopped auto-including @types/mdx from node_modules.
// A triple-slash reference is honored regardless of that default.
/// <reference types="mdx" />
