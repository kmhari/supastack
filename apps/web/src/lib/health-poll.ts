import { instancesApi } from './api';

/**
 * Poll the control-plane instance status until it reports `running`.
 *
 * Used by the Auth Providers page (feature 020) — after a PATCH triggers a
 * container restart, the dashboard polls this to know when to flip the
 * toast from "Restarting..." to "Settings applied".
 *
 * Backoff schedule: 500ms, 1s, 2s, 4s (capped). Total budget defaults to 60s.
 *
 * Spec: specs/020-auth-providers-dashboard/spec.md SC-007
 * Research: specs/020-auth-providers-dashboard/research.md R-003
 * Task: T010
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

interface InstanceShape {
  status?: string;
  [key: string]: unknown;
}

const BACKOFFS_MS = [500, 1000, 2000, 4000];

export async function pollUntilHealthy(
  ref: string,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const startedAt = Date.now();
  let attempt = 0;

  while (Date.now() - startedAt < timeoutMs) {
    let inst: InstanceShape;
    try {
      inst = (await instancesApi.get(ref)) as InstanceShape;
    } catch {
      // Transient — control plane may be restarting too; retry on backoff.
      inst = {};
    }
    if (inst.status === 'running') {
      return;
    }
    const delay = BACKOFFS_MS[Math.min(attempt, BACKOFFS_MS.length - 1)]!;
    attempt += 1;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  throw new TimeoutError(`Instance ${ref} did not reach 'running' within ${timeoutMs}ms`);
}
