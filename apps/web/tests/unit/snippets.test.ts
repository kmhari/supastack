import { describe, it, expect } from 'vitest';
import { buildSnippets } from '../../src/lib/snippets';

describe('buildSnippets', () => {
  it('personalizes every snippet with the live apex', () => {
    const s = buildSnippets('supaviser.dev');
    expect(s.isPlaceholder).toBe(false);
    expect(s.apex).toBe('supaviser.dev');
    expect(s.mcpUrl).toBe('https://mcp.supaviser.dev/mcp');
    expect(s.dashboardUrl).toBe('https://supaviser.dev/dashboard');
    expect(s.tokensUrl).toBe('https://supaviser.dev/dashboard/account/tokens');
    expect(s.supastackFile).toContain('domain=supaviser.dev');
  });

  it('falls back to <your-apex> when apex is null (pre-setup), no throw', () => {
    const s = buildSnippets(null);
    expect(s.isPlaceholder).toBe(true);
    expect(s.apex).toBe('<your-apex>');
    expect(s.mcpUrl).toBe('https://mcp.<your-apex>/mcp');
    expect(s.tokensUrl).toContain('<your-apex>');
  });

  it('treats empty string apex as placeholder', () => {
    expect(buildSnippets('').isPlaceholder).toBe(true);
    expect(buildSnippets(undefined).isPlaceholder).toBe(true);
  });

  it('provides ready-to-paste configs for all four editors with the mcp url', () => {
    const s = buildSnippets('supaviser.dev');
    const labels = s.mcpConfigs.map((c) => c.label);
    expect(labels).toEqual(['Claude Code', 'Cursor', 'Windsurf', 'Claude Desktop']);
    for (const cfg of s.mcpConfigs) {
      expect(cfg.json).toContain('https://mcp.supaviser.dev/mcp');
      expect(cfg.file.length).toBeGreaterThan(0);
    }
    // Windsurf uses serverUrl; the others use url.
    const windsurf = s.mcpConfigs.find((c) => c.label === 'Windsurf')!;
    expect(windsurf.json).toContain('serverUrl');
    const claudeCode = s.mcpConfigs.find((c) => c.label === 'Claude Code')!;
    expect(claudeCode.json).toContain('"url"');
  });

  it('embeds the cli wrapper + .supastack file format', () => {
    const s = buildSnippets('supaviser.dev');
    expect(s.wrapper).toContain('supabase()');
    expect(s.supastackFile).toBe('token=sbp_your_pat_here\ndomain=supaviser.dev');
  });
});
