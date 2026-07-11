/** Canonical UUID validator for API-route input gating. Security-relevant —
 *  keep the single definition here instead of per-route copies that can drift. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
