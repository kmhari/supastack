/**
 * Feature 116 — re-export of the shared secret redactor. The canonical
 * implementation lives in `@supastack/shared` so the worker observer (which
 * cannot import from apps/api) shares the exact same masking. Used here by the
 * admin Queues inspector (failed-job reasons, FR-022).
 */
export { redactSensitive } from '@supastack/shared';
