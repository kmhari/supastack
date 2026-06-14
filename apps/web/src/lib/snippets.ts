/**
 * Pure helper that builds the personalized copy-paste snippets shown on the
 * public /docs pages. Given the live apex (or null pre-setup) it returns the
 * CLI wrapper + `.supastack` file + the per-editor MCP configs, all with the
 * real address substituted. When apex is null every value uses the
 * `<your-apex>` placeholder so the page is useful before setup completes.
 *
 * Feature 116 (US1). Reuses the existing cli-wrapper snippet helpers.
 */
import { getWrapperSnippet, getSupastackFileContent } from './cli-wrapper';

export interface McpEditorConfig {
  /** Display label for the tab. */
  label: string;
  /** Where the config file lives for this editor. */
  file: string;
  /** Ready-to-paste JSON config. */
  json: string;
}

export interface DocsSnippets {
  /** Real apex, or the `<your-apex>` placeholder. */
  apex: string;
  /** True when no apex is configured yet (pre-setup). */
  isPlaceholder: boolean;
  /** Hosted MCP endpoint URL. */
  mcpUrl: string;
  /** Dashboard root. */
  dashboardUrl: string;
  /** Where to mint a Personal Access Token. */
  tokensUrl: string;
  /** zsh/bash wrapper to add to the shell rc. */
  wrapper: string;
  /** `.supastack` repo-root file contents (placeholder token + real domain). */
  supastackFile: string;
  /** Per-editor MCP client configs. */
  mcpConfigs: McpEditorConfig[];
}

const PLACEHOLDER = '<your-apex>';

export function buildSnippets(apex: string | null | undefined): DocsSnippets {
  const isPlaceholder = !apex;
  const host = apex || PLACEHOLDER;
  const mcpUrl = `https://mcp.${host}/mcp`;

  const claudeShape = JSON.stringify({ mcpServers: { supastack: { url: mcpUrl } } }, null, 2);
  const windsurfShape = JSON.stringify(
    { mcpServers: { supastack: { serverUrl: mcpUrl } } },
    null,
    2,
  );

  return {
    apex: host,
    isPlaceholder,
    mcpUrl,
    dashboardUrl: `https://${host}/dashboard`,
    tokensUrl: `https://${host}/dashboard/account/tokens`,
    wrapper: getWrapperSnippet(host),
    supastackFile: getSupastackFileContent('sbp_your_pat_here', host),
    mcpConfigs: [
      {
        label: 'Claude Code',
        file: '~/.claude/mcp.json (or project .mcp.json)',
        json: claudeShape,
      },
      { label: 'Cursor', file: '~/.cursor/mcp.json', json: claudeShape },
      { label: 'Windsurf', file: '~/.codeium/windsurf/mcp_config.json', json: windsurfShape },
      {
        label: 'Claude Desktop',
        file: 'claude_desktop_config.json (Settings → Developer)',
        json: claudeShape,
      },
    ],
  };
}
