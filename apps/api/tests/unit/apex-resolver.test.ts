import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @supastack/db before importing the module under test
vi.mock('@supastack/db', () => ({
  db: vi.fn(),
  schema: {},
}));
vi.mock('@supastack/db/schema', () => ({
  org: { apexDomain: 'apex_domain' },
}));

describe('apex-resolver', () => {
  let resolveApex: () => Promise<string | null>;
  let mockDb: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    vi.unstubAllEnvs();

    mockDb = vi.fn();
    const dbMod = await import('@supastack/db');
    (dbMod.db as ReturnType<typeof vi.fn>).mockImplementation(() => mockDb);

    const mod = await import('../../src/services/apex-resolver.js');
    resolveApex = mod.resolveApex;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns env var immediately without DB call when SUPASTACK_APEX is set', async () => {
    vi.stubEnv('SUPASTACK_APEX', 'env.example.com');
    const result = await resolveApex();
    expect(result).toBe('env.example.com');
    expect(mockDb).not.toHaveBeenCalled();
  });

  it('returns DB apex when env var is unset and DB has a value', async () => {
    vi.stubEnv('SUPASTACK_APEX', '');
    const { db } = await import('@supastack/db');
    const chain = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ apex: 'db.example.com' }]),
    };
    (db as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const result = await resolveApex();
    expect(result).toBe('db.example.com');
  });

  it('returns null when env var is unset and DB has no apex', async () => {
    vi.stubEnv('SUPASTACK_APEX', '');
    const { db } = await import('@supastack/db');
    const chain = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ apex: null }]),
    };
    (db as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const result = await resolveApex();
    expect(result).toBeNull();
  });

  it('returns null when env var is unset and DB returns empty array', async () => {
    vi.stubEnv('SUPASTACK_APEX', '');
    const { db } = await import('@supastack/db');
    const chain = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    (db as ReturnType<typeof vi.fn>).mockReturnValue(chain);

    const result = await resolveApex();
    expect(result).toBeNull();
  });
});
