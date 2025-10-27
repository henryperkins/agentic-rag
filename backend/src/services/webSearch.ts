// Layer 7: Web Search Retrieval
import { openaiClient, type WebSearchResult } from "../config/openai";
import {
  ENABLE_WEB_SEARCH,
  WEB_SEARCH_CONTEXT_SIZE,
  WEB_SEARCH_LOCATION
} from "../config/constants";

export interface WebSearchChunk extends WebSearchResult {
  score: number;
}

export async function performWebSearch(
  query: string,
  maxResults = 5
): Promise<WebSearchChunk[]> {
  if (!ENABLE_WEB_SEARCH) return [];
  const trimmed = query.trim();
  if (!trimmed) return [];

  const results = await openaiClient.webSearch(trimmed, {
    maxResults,
    contextSize: WEB_SEARCH_CONTEXT_SIZE,
    location: WEB_SEARCH_LOCATION ?? undefined
  });

  return results.map((r, idx) => ({
    ...r,
    score: 1 / (idx + 1)
  }));
}
