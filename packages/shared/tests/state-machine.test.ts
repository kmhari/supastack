import { describe, it, expect } from 'vitest';
import {
  INSTANCE_STATES,
  canTransition,
  nextStates,
  type InstanceState,
} from '../src/state-machine';

const ALLOWED: Record<InstanceState, InstanceState[]> = {
  provisioning: ['running', 'failed', 'deleting'],
  running: ['paused', 'stopped', 'deleting'],
  paused: ['running', 'deleting'],
  stopped: ['running', 'failed', 'deleting'],
  failed: ['deleting'],
  deleting: [],
};

describe('state machine', () => {
  it('every allowed transition accepted', () => {
    for (const from of INSTANCE_STATES) {
      for (const to of ALLOWED[from]) {
        expect(canTransition(from, to)).toBe(true);
      }
    }
  });
  it('every disallowed transition rejected', () => {
    for (const from of INSTANCE_STATES) {
      for (const to of INSTANCE_STATES) {
        if (ALLOWED[from].includes(to)) continue;
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });
  it('nextStates matches matrix', () => {
    for (const from of INSTANCE_STATES) {
      expect([...nextStates(from)]).toEqual(ALLOWED[from]);
    }
  });
  it('unknown from-state', () => {
    expect(canTransition('ghost' as InstanceState, 'running')).toBe(false);
    expect(nextStates('ghost' as InstanceState)).toEqual([]);
  });
});
