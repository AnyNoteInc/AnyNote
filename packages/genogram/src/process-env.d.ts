// This browser package has no `@types/node` in its tsconfig `types`, but a dev
// debug hook reads `process.env.NODE_ENV` (which Next inlines into the client
// bundle at build time). Declare the minimal shape so tsc accepts it without
// dragging in the full Node global surface. Previously this typed itself through
// a @hocuspocus/provider transitive dependency; v4 dropped it.
declare const process: { readonly env: { readonly NODE_ENV?: string } }
