import { afterEach } from 'vitest'

// Shared teardown drain for every editor test file.
//
// Tests that mount a TipTap `Editor` (even the schema-only variants) leave a
// deferred focus/selection callback behind: on `editor.destroy()` ProseMirror
// schedules a `selectionToDOM`, and TipTap 3.27 defers focus via
// requestAnimationFrame (happy-dom backs rAF with a ~16ms timer). If that
// callback fires after Vitest has torn the happy-dom environment down, it hits
// a missing `document` and throws `ReferenceError: document is not defined` —
// an unhandled error that fails the run even though every assertion passed.
//
// A single `setTimeout(0)` tick is not wide enough to cover the rAF, and under
// the parallel `pnpm test` load the gap widens. Draining a window that clears
// the rAF here — once, centrally, for all editor tests — lets the (guarded)
// callback run while `document` still exists, deterministically.
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 30))
})
