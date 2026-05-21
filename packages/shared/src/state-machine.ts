export const INSTANCE_STATES = [
  'provisioning',
  'running',
  'paused',
  'stopped',
  'failed',
  'deleting',
] as const;
export type InstanceState = (typeof INSTANCE_STATES)[number];

/**
 * Allowed transitions for `supabase_instances.status`. Any transition not
 * listed here must be rejected by the API/worker. Permissive `*→deleting`
 * because deletion can be requested from any state.
 */
const TRANSITIONS: Record<InstanceState, ReadonlyArray<InstanceState>> = {
  provisioning: ['running', 'failed', 'deleting'],
  running: ['paused', 'stopped', 'deleting'],
  paused: ['running', 'deleting'],
  stopped: ['running', 'failed', 'deleting'],
  failed: ['deleting'],
  deleting: [], // terminal — row removed after cleanup
};

export function canTransition(from: InstanceState, to: InstanceState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextStates(from: InstanceState): ReadonlyArray<InstanceState> {
  return TRANSITIONS[from] ?? [];
}
