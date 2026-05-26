/**
 * Build a SupabasePlatform that points at selfbase's internal management API.
 *
 * Per spec FR-016 + research.md Decision 1: use upstream
 * `@supabase/mcp-server-supabase` AS-IS, but strip operation-group members
 * for deferred tools so the LLM never sees a tool that would 501.
 *
 * Strips (v1 deferred):
 *   - debugging.getAdvisors
 *   - storage.getStorageConfig + storage.updateStorageConfig
 *   - account.createProject + account.getCost + account.confirmCost
 *   - branching (entire group)
 *
 * Keeps:
 *   - account: list_projects, get_project, list_organizations, get_organization,
 *              pause_project, restore_project
 *   - database: full feature 013 surface
 *   - development: get_project_url, get_publishable_keys, generate_typescript_types
 *   - functions: list_edge_functions, get_edge_function, deploy_edge_function
 *   - debugging: get_logs (US4)
 *   - storage: list_storage_buckets (US5)
 *   - docs: search_docs
 */
import { createSupabaseApiPlatform } from '@supabase/mcp-server-supabase/platform/api';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPlatform = any;

export interface BuildPlatformArgs {
  accessToken: string;
  apiUrl: string;
}

export function buildPlatform(args: BuildPlatformArgs): AnyPlatform {
  const platform: AnyPlatform = createSupabaseApiPlatform({
    accessToken: args.accessToken,
    apiUrl: args.apiUrl,
  });

  // Strip individual methods (per-tool exclusions)
  if (platform.debugging) {
    // Upstream exposes getSecurityAdvisors + getPerformanceAdvisors (not a
    // single getAdvisors). Both strip per FR-016.
    delete platform.debugging.getSecurityAdvisors;
    delete platform.debugging.getPerformanceAdvisors;
  }
  if (platform.storage) {
    // Keep listAllBuckets (US5). Strip the write surface.
    delete platform.storage.getStorageConfig;
    delete platform.storage.updateStorageConfig;
  }
  if (platform.account) {
    // Keep list/get + pause/restore (US6). Strip create + cost tools.
    delete platform.account.createProject;
    delete platform.account.getCost;
    delete platform.account.confirmCost;
  }

  // Strip entire branching group (Cloud-only, paid plan)
  delete platform.branching;

  return platform;
}
