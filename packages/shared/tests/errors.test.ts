import { describe, it, expect } from 'vitest';
import { AppError, errors } from '../src/errors';

describe('AppError', () => {
  it('constructs with details + toBody envelope', () => {
    const e = new AppError(400, 'invalid_input', 'm', { f: 1 });
    expect(e).toBeInstanceOf(Error);
    expect(e.statusCode).toBe(400);
    expect(e.code).toBe('invalid_input');
    expect(e.message).toBe('m');
    expect(e.toBody()).toEqual({
      error: { code: 'invalid_input', message: 'm', details: { f: 1 } },
    });
    expect(e.name).toBe('AppError');
  });
});

describe('errors factory', () => {
  const cases: Array<[
    () => AppError,
    number,
    AppError['code'],
  ]> = [
    [() => errors.invalidInput('m'), 400, 'invalid_input'],
    [() => errors.unauthenticated(), 401, 'unauthenticated'],
    [() => errors.reauthRequired(), 401, 'reauth_required'],
    [() => errors.forbidden(), 403, 'forbidden'],
    [() => errors.notFound(), 404, 'not_found'],
    [() => errors.conflict('m'), 409, 'conflict'],
    [() => errors.setupComplete(), 410, 'setup_complete'],
    [() => errors.gone('m'), 410, 'gone'],
    [() => errors.rateLimited(), 429, 'rate_limited'],
    [() => errors.internal(), 500, 'internal'],
    [() => errors.masterKeyMissing(), 500, 'master_key_missing'],
    [() => errors.portPoolExhausted(), 503, 'port_pool_exhausted'],
    [() => errors.invalidStateTransition('a', 'b'), 409, 'invalid_state_transition'],
  ];

  for (const [make, status, code] of cases) {
    it(`${code} → ${status}`, () => {
      const e = make();
      expect(e.statusCode).toBe(status);
      expect(e.code).toBe(code);
      const body = e.toBody();
      expect(body.error.code).toBe(code);
      expect(typeof body.error.message).toBe('string');
      expect(body.error.message.length).toBeGreaterThan(0);
    });
  }

  it('invalidStateTransition embeds from/to', () => {
    expect(errors.invalidStateTransition('running', 'provisioning').message).toContain('running');
    expect(errors.invalidStateTransition('running', 'provisioning').message).toContain(
      'provisioning',
    );
  });

  it('invalidInput carries details', () => {
    expect(errors.invalidInput('m', { x: 1 }).details).toEqual({ x: 1 });
  });
});
