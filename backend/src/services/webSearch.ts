// Layer 7: Web Search Retrieval
import {
  openaiClient,
  type WebSearchResult,
  type WebSearchMetadata
} from "../config/openai";
import {
  ENABLE_WEB_SEARCH,
  WEB_SEARCH_CONTEXT_SIZE,
  WEB_SEARCH_LOCATION,
  WEB_SEARCH_ALLOWED_DOMAINS
} from "../config/constants";
import { webSearchCache, normalize } from "./cache";
import { webSearchRequestsCounter, webSearchErrorsCounter, webSearchCacheHitsCounter } from "../config/metrics";

export interface WebSearchChunk extends WebSearchResult {
  score: number;
}

export interface WebSearchResponse {
  chunks: WebSearchChunk[];
  metadata: WebSearchMetadata;
}

export async function performWebSearch(
  query: string,
  maxResults = 5,
  allowedDomains?: string[]
): Promise<WebSearchResponse> {
  webSearchRequestsCounter.inc();
  if (!ENABLE_WEB_SEARCH) {
    return { chunks: [], metadata: {} };
  }

  const trimmed = query.trim();
  if (!trimmed) {
    return { chunks: [], metadata: {} };
  }

  const cacheKey = normalize(`websearch:${trimmed}:${allowedDomains?.join(",")}:${maxResults}`);
  const cached = webSearchCache.get(cacheKey);
  if (cached) {
    webSearchCacheHitsCounter.inc();
    return cached;
  }

  try {
    const { results, metadata } = await openaiClient.webSearch(trimmed, {
      maxResults,
      contextSize: WEB_SEARCH_CONTEXT_SIZE,
      location: WEB_SEARCH_LOCATION ?? undefined,
      allowedDomains: allowedDomains || (WEB_SEARCH_ALLOWED_DOMAINS.length > 0 ? WEB_SEARCH_ALLOWED_DOMAINS : undefined)
    });

    // Convert results to chunks, preserving relevance scores
    const chunks = results.map((r) => ({
      ...r,
      score: r.relevance || 1 / (results.indexOf(r) + 1)
    }));

    const response = { chunks, metadata };
    webSearchCache.set(cacheKey, response);
    return response;
  } catch (error) {
    webSearchErrorsCounter.inc();
    throw error;
  }
}

export async function performWebSearchStream(
  query: string,
  maxResults = 5,
  allowedDomains: string[] | undefined,
  onProgress: (event: { type: string; data?: any }) => void
): Promise<WebSearchResponse> {
  if (!ENABLE_WEB_SEARCH) {
    return { chunks: [], metadata: {} };
  }

  const trimmed = query.trim();
  if (!trimmed) {
    return { chunks: [], metadata: {} };
  }

  const { results, metadata } = await openaiClient.webSearchStream(
    trimmed,
    {
      maxResults,
      contextSize: WEB_SEARCH_CONTEXT_SIZE,
      location: WEB_SEARCH_LOCATION ?? undefined,
      allowedDomains: allowedDomains || (WEB_SEARCH_ALLOWED_DOMAINS.length > 0 ? WEB_SEARCH_ALLOWED_DOMAINS : undefined)
    },
    onProgress
  );

  // Convert results to chunks, preserving relevance scores
  const chunks = results.map((r) => ({
    ...r,
    score: r.relevance || 1 / (results.indexOf(r) + 1)
  }));

  return { chunks, metadata };
}
