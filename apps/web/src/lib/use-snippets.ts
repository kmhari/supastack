import { useQuery } from '@tanstack/react-query';
import { apexApi } from './api';
import { buildSnippets, type DocsSnippets } from './snippets';

/**
 * Fetch the live apex (public GET /apex) and build the personalized docs
 * snippets. Pre-setup (apex null) yields placeholder snippets, never an error.
 * Feature 116 (US1).
 */
export function useSnippets(): { snippets: DocsSnippets; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ['apex'],
    queryFn: () => apexApi.status(),
    retry: 0,
  });
  return { snippets: buildSnippets(data?.apex ?? null), isLoading };
}
