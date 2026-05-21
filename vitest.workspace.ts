import { defineWorkspace } from 'vitest/config';

// Glob-based — picks up packages/* and apps/* as they land. Apps/packages
// without a vitest config are skipped quietly by Vitest.
export default defineWorkspace(['packages/*', 'apps/*']);
