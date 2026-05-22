import { describe, expect, it } from 'vitest';
import { isEszipMagic } from '../../src/services/function-deploy.js';

/**
 * T003a (c): eszip magic-byte check.
 *
 * The default `supabase functions deploy` path uploads a raw eszip body with
 * `Content-Type: application/vnd.denoland.eszip`. Selfbase MUST validate the
 * `ESZIP` magic header before persisting to disk, otherwise a stray multipart
 * boundary or a JSON body sent with the wrong content-type would land at
 * `volumes/functions/<slug>/bundle.eszip` and crash the runtime on next load.
 */
describe('isEszipMagic', () => {
  it('accepts a buffer starting with ESZIP2.3 (current runtime version)', () => {
    const bytes = Buffer.from('ESZIP2.3\x00\x00\x00\x04', 'binary');
    expect(isEszipMagic(bytes)).toBe(true);
  });

  it('accepts other ESZIP2.x version markers', () => {
    expect(isEszipMagic(Buffer.from('ESZIP2.2\x00', 'binary'))).toBe(true);
    expect(isEszipMagic(Buffer.from('ESZIP2.1\x00', 'binary'))).toBe(true);
  });

  it('rejects a buffer that does NOT start with the ESZIP magic', () => {
    expect(isEszipMagic(Buffer.from('NOTAZIPHEADER', 'utf8'))).toBe(false);
    expect(isEszipMagic(Buffer.from('PK\x03\x04', 'binary'))).toBe(false); // zip
    expect(isEszipMagic(Buffer.from('{"foo":"bar"}', 'utf8'))).toBe(false);
  });

  it('rejects an empty buffer', () => {
    expect(isEszipMagic(Buffer.alloc(0))).toBe(false);
  });

  it('rejects a buffer shorter than the magic length', () => {
    expect(isEszipMagic(Buffer.from('ESZ', 'utf8'))).toBe(false);
  });
});
