/**
 * Contract test — drift guard between the pinned upstream OpenAPI snapshot
 * and selfbase's auth-config status map.
 *
 * Spec: specs/020-auth-providers-dashboard/spec.md FR-008, SC-006
 * Plan: specs/020-auth-providers-dashboard/plan.md §A3
 * Task: T007
 *
 * Fails CI when:
 *   - upstream introduces a new auth-config field that env-field-mapper.ts
 *     does not classify, OR
 *   - env-field-mapper.ts classifies a field that no longer exists upstream.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AUTH_CONFIG_FIELD_STATUS } from '../../src/services/env-field-mapper.js';

const SNAPSHOT_PATH = resolve(
  __dirname,
  '../fixtures/upstream/openapi-snapshot-009-runtime-config.json',
);

describe('upstream UpdateAuthConfigBody snapshot ↔ AUTH_CONFIG_FIELD_STATUS', () => {
  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
  const upstreamFields: string[] = Object.keys(
    snapshot.components.schemas.UpdateAuthConfigBody.properties,
  );
  const mapFields: string[] = Object.keys(AUTH_CONFIG_FIELD_STATUS);

  it('every upstream field is classified', () => {
    const missing = upstreamFields.filter((f) => !mapFields.includes(f));
    expect(missing, `Unclassified upstream fields: ${missing.join(', ')}`).toEqual([]);
  });

  it('no extra fields in status map that do not exist upstream', () => {
    const extras = mapFields.filter((f) => !upstreamFields.includes(f));
    expect(extras, `Fields in map but not upstream: ${extras.join(', ')}`).toEqual([]);
  });

  it('snapshot has exactly 234 fields', () => {
    // Sentinel — if upstream rev bumps the count, this test forces an explicit
    // status-map review before the count change can land.
    expect(upstreamFields.length).toBe(234);
  });
});
