/**
 * T024 — multi-statement detector (pure). Companion to the existing
 * tests/unit/multi-statement-detect.test.ts; covers extra edge-cases to keep
 * the file ≥90%.
 */
import { describe, expect, it } from 'vitest';
import { detectMultiStatement } from '../../../src/services/multi-statement-detect.js';

describe('detectMultiStatement (extras)', () => {
  const single = [
    'select 1',
    'select 1;',
    'select 1;   ',
    '   select 1   ;   \n\n',
    `select ';' from x`,
    `select '''quoted''' from x`,
    'select "weird;col" from x',
    'select 1 -- ignored ; comment\n',
    'select 1 /* ignored ; block */',
    'select 1 /* nest /* deep ; */ outer */',
    `select $tag$body with ; semicolon$tag$`,
    `insert into t values ('a;b'), ('c;d')`,
    '',
  ];
  for (const sql of single) {
    it(`single statement: ${JSON.stringify(sql).slice(0, 50)}`, () => {
      expect(detectMultiStatement(sql)).toBe(false);
    });
  }

  const multi = [
    'select 1; select 2',
    'select 1; select 2;',
    'create table x(); drop table x',
    `select '; in string'; select 2`,
    `select 1 /* comment */; select 2`,
    `select $a$ body $a$; select 2`,
  ];
  for (const sql of multi) {
    it(`multi statement: ${JSON.stringify(sql).slice(0, 50)}`, () => {
      expect(detectMultiStatement(sql)).toBe(true);
    });
  }
});
