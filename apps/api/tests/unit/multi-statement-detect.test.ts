import { describe, expect, it } from 'vitest';
import { detectMultiStatement } from '../../src/services/multi-statement-detect.js';

/**
 * T002 — pure state-machine tests. Covers the PG-aware edge cases that a
 * naive `sql.includes(';')` would mis-flag: string literals, comments,
 * dollar quotes.
 */
describe('detectMultiStatement', () => {
  describe('single-statement', () => {
    it('plain SELECT, no semicolon', () => {
      expect(detectMultiStatement('SELECT 1')).toBe(false);
    });
    it('plain SELECT, single trailing semicolon', () => {
      expect(detectMultiStatement('SELECT 1;')).toBe(false);
    });
    it('multiple trailing semicolons', () => {
      expect(detectMultiStatement('SELECT 1;;;')).toBe(false);
    });
    it('trailing whitespace after semicolon', () => {
      expect(detectMultiStatement('SELECT 1;   \n  ')).toBe(false);
    });
    it('empty string', () => {
      expect(detectMultiStatement('')).toBe(false);
    });
    it('whitespace only', () => {
      expect(detectMultiStatement('   \n   ')).toBe(false);
    });
  });

  describe('multi-statement', () => {
    it('two SELECTs', () => {
      expect(detectMultiStatement('SELECT 1; SELECT 2')).toBe(true);
    });
    it('two SELECTs with trailing semicolon on each', () => {
      expect(detectMultiStatement('SELECT 1; SELECT 2;')).toBe(true);
    });
    it('multi with comment between statements', () => {
      expect(detectMultiStatement('SELECT 1; -- comment\nSELECT 2')).toBe(true);
    });
  });

  describe('semicolon inside string literal — NOT multi', () => {
    it('single-quoted literal', () => {
      expect(detectMultiStatement("SELECT 'a;b'")).toBe(false);
    });
    it('single-quoted literal with escaped quote', () => {
      expect(detectMultiStatement("SELECT 'it''s;fine'")).toBe(false);
    });
    it('double-quoted identifier', () => {
      expect(detectMultiStatement('SELECT "col;name" FROM x')).toBe(false);
    });
  });

  describe('semicolon inside comment — NOT multi', () => {
    it('line comment with semicolon', () => {
      expect(detectMultiStatement('SELECT 1 -- comment;\nFROM x')).toBe(false);
    });
    it('block comment with semicolon', () => {
      expect(detectMultiStatement('SELECT /* a;b */ 1')).toBe(false);
    });
    it('nested block comment with semicolon', () => {
      expect(detectMultiStatement('SELECT /* outer /* inner;here */ still in */ 1')).toBe(false);
    });
  });

  describe('semicolon inside dollar quote — NOT multi', () => {
    it('untagged dollar-quoted string', () => {
      expect(detectMultiStatement('SELECT $$a;b$$')).toBe(false);
    });
    it('tagged dollar-quoted string', () => {
      expect(detectMultiStatement('SELECT $tag$a;b$tag$')).toBe(false);
    });
    it('function body with semicolons inside dollar quote', () => {
      const sql = `CREATE FUNCTION foo() RETURNS int AS $$
        DECLARE x int;
      BEGIN
        x := 1;
        RETURN x;
      END;
      $$ LANGUAGE plpgsql`;
      expect(detectMultiStatement(sql)).toBe(false);
    });
  });

  describe('hybrid cases', () => {
    it('first stmt contains string-literal semicolon, then real semicolon, then SELECT', () => {
      expect(detectMultiStatement("SELECT 'a;b'; SELECT 2")).toBe(true);
    });
    it('first stmt contains dollar quote, real semicolon, then SELECT', () => {
      expect(detectMultiStatement('SELECT $$x;y$$; SELECT 2')).toBe(true);
    });
  });
});
