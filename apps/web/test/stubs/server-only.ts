// Stub for the `server-only` marker package, used only by Vitest.
//
// In Next.js, importing `server-only` resolves to a build-time shim that throws
// if a Server Component module is pulled into a Client bundle. Under Vitest
// (node env) there is no such bundler boundary and the real package is not
// installed, so we alias `server-only` to this empty no-op module via
// `resolve.alias` in apps/web/vitest.config.ts. This does NOT affect the
// Next.js build, which uses its own bundler resolution.
export {}
