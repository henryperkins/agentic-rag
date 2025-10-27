import { MOCK_OPENAI } from "./constants";
import { createHash } from "crypto";

type Message = { role: "system" | "user" | "assistant"; content: string };

export interface WebSearchLocation {
  city?: string;
  region?: string;
  country?: string;
  timezone?: string;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  citationStart?: number;
  citationEnd?: number;
  relevance?: number;
}

export interface WebSearchMetadata {
  searchQuery?: string;
  domainsSearched?: string[];
  allSources?: string[];
}

export interface WebSearchOptions {
  maxResults: number;
  contextSize: "low" | "medium" | "high";
  location?: WebSearchLocation | null;
  allowedDomains?: string[];
}

interface OpenAIAdapter {
  embedTexts: (texts: string[], dims: number) => Promise<number[][]>;
  chat: (messages: Message[]) => Promise<string>;
  chatStream: (messages: Message[], onDelta: (text: string) => void) => Promise<string>;
  webSearch: (
    query: string,
    options: WebSearchOptions
  ) => Promise<{ results: WebSearchResult[], metadata: WebSearchMetadata }>;
  webSearchStream: (
    query: string,
    options: WebSearchOptions,
    onProgress: (event: { type: string; data?: any }) => void
  ) => Promise<{ results: WebSearchResult[], metadata: WebSearchMetadata }>;
}

// Deterministic pseudo-random number from string
function strSeed(s: string) {
  const h = createHash("sha256").update(s).digest();
  // Convert first 8 bytes to int
  return h.readBigUInt64BE(0) % BigInt(2 ** 32);
}
function seededRand(seed: number) {
  let x = seed >>> 0;
  return () => {
    // Xorshift32
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0xffffffff;
  };
}

async function mockEmbed(texts: string[], dims: number): Promise<number[][]> {
  return texts.map((t) => {
    const rng = seededRand(Number(strSeed(t)));
    const v = new Array(dims).fill(0).map(() => rng());
    // L2 normalize
    const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0));
    return v.map((x) => x / (norm || 1));
  });
}

async function mockChat(messages: Message[]): Promise<string> {
  const last = messages[messages.length - 1]?.content || "";
  return `MOCK_RESPONSE: ${last.slice(0, 120)}`;
}

async function mockChatStream(
  messages: Message[],
  onDelta: (text: string) => void
): Promise<string> {
  const last = messages[messages.length - 1]?.content || "";
  const fullResponse = `MOCK_RESPONSE: ${last.slice(0, 120)}`;

  // Simulate streaming by sending text in chunks with small delays
  const chunkSize = 10;
  for (let i = 0; i < fullResponse.length; i += chunkSize) {
    const chunk = fullResponse.slice(i, i + chunkSize);
    onDelta(chunk);
    // Small delay to simulate real streaming
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  return fullResponse;
}

async function mockWebSearch(
  query: string,
  options: WebSearchOptions
): Promise<{ results: WebSearchResult[], metadata: WebSearchMetadata }> {
  const count = Math.min(Math.max(options.maxResults, 1), 5);
  const seed = Number(strSeed(query)) || 1;
  const rng = seededRand(seed);

  const results = Array.from({ length: count }, (_, idx) => {
    const variant = Math.round(rng() * 1000);
    return {
      title: `Mock result ${idx + 1} for "${query}"`,
      url: `https://example.com/mock/${variant}`,
      snippet: `Synthetic snippet ${idx + 1} providing context for ${query}.`,
      publishedAt: new Date(2024, 0, (idx + 1) * 3).toISOString(),
      relevance: 1 / (idx + 1)
    };
  });

  const metadata: WebSearchMetadata = {
    searchQuery: query,
    domainsSearched: options.allowedDomains || ["example.com"],
    allSources: results.map(r => r.url)
  };

  return { results, metadata };
}

async function mockWebSearchStream(
  query: string,
  options: WebSearchOptions,
  onProgress: (event: { type: string; data?: any }) => void
): Promise<{ results: WebSearchResult[], metadata: WebSearchMetadata }> {
  // Emit in_progress event
  onProgress({ type: "web_search.in_progress" });
  await new Promise(resolve => setTimeout(resolve, 50));

  // Emit searching event
  onProgress({ type: "web_search.searching" });
  await new Promise(resolve => setTimeout(resolve, 100));

  // Get the actual mock results
  const response = await mockWebSearch(query, options);

  // Emit completed event
  onProgress({ type: "web_search.completed", data: { resultCount: response.results.length } });

  return response;
}

let realOpenAI: any = null;

async function realEmbed(texts: string[], dims: number): Promise<number[][]> {
  if (!realOpenAI) {
    const { OpenAI } = await import("openai");
    realOpenAI = new OpenAI();
  }
  const res = await realOpenAI.embeddings.create({
    input: texts,
    model: "text-embedding-3-small",
    dimensions: dims
  });
  return res.data.map((d: any) => d.embedding as number[]);
}

async function realChat(messages: Message[]): Promise<string> {
  if (!realOpenAI) {
    const { OpenAI } = await import("openai");
    realOpenAI = new OpenAI();
  }
  const response = await realOpenAI.responses.create({
    model: "gpt-4o-mini",
    input: messages.map((message) => ({
      role: message.role,
      content: [{ type: "text", text: message.content }]
    })),
    store: false,
    metadata: { app: "rag-chat", purpose: "answer" }
  });

  const outputText = response.output_text?.trim();
  if (outputText) {
    return outputText;
  }

  for (const item of response.output || []) {
    if (item.type === "message") {
      for (const part of item.content) {
        if (part.type === "output_text" && part.text) {
          return part.text.trim();
        }
      }
    }
  }

  return "";
}

async function realChatStream(
  messages: Message[],
  onDelta: (text: string) => void
): Promise<string> {
  if (!realOpenAI) {
    const { OpenAI } = await import("openai");
    realOpenAI = new OpenAI();
  }

  const stream = await realOpenAI.responses.create({
    model: "gpt-4o-mini",
    input: messages.map((message) => ({
      role: message.role,
      content: [{ type: "text", text: message.content }]
    })),
    stream: true,
    store: false,
    metadata: { app: "rag-chat", purpose: "answer" }
  });

  let fullText = "";
  // Prefer done text if provided; otherwise fall back to accumulated deltas
  let finalTextFromDone = "";
  // Track refusal text in case the model streams a refusal
  let refusalText = "";

  for await (const event of stream) {
    switch (event.type) {
      case 'response.created':
        console.log('[OpenAI] Response started:', event.response?.id);
        break;

      case 'response.in_progress':
        // optional: debug/trace
        break;

      case 'response.output_text.delta':
        if (event.delta) {
          fullText += event.delta;
          onDelta(event.delta);
        }
        break;

      case 'response.output_text.done':
        if ((event as any).text) {
          finalTextFromDone = (event as any).text;
        }
        break;

      case 'response.refusal.delta':
        if ((event as any).delta) {
          refusalText += (event as any).delta;
          // Stream refusal text so the UI can surface it immediately
          onDelta((event as any).delta);
        }
        break;

      case 'response.refusal.done':
        // Nothing special; refusal handled above. Could inspect (event as any).refusal if needed.
        break;

      case 'response.completed':
        console.log('[OpenAI] Response completed');
        break;

      case 'response.incomplete':
        console.error('[OpenAI] Response incomplete:', event.response?.incomplete_details);
        throw new Error(`OpenAI response incomplete: ${JSON.stringify(event.response?.incomplete_details)}`);

      case 'response.failed':
        console.error('[OpenAI] Response failed:', event.response?.error);
        throw new Error(`OpenAI response failed: ${JSON.stringify(event.response?.error)}`);

      case 'error':
        console.error('[OpenAI] Stream error:', event);
        throw new Error(`OpenAI stream error: ${JSON.stringify(event)}`);
    }
  }

  return (finalTextFromDone || fullText).trim();
}

async function realWebSearch(
  query: string,
  options: WebSearchOptions
): Promise<{ results: WebSearchResult[], metadata: WebSearchMetadata }> {
  if (!realOpenAI) {
    const { OpenAI } = await import("openai");
    realOpenAI = new OpenAI();
  }

  const maxResults = Math.min(Math.max(options.maxResults, 1), 8);

  // Build web search tool configuration
  const webSearchTool: any = {
    type: "web_search",
    search_context_size: options.contextSize,
    user_location: options.location ? {
      type: "approximate" as const,
      city: options.location.city,
      region: options.location.region,
      country: options.location.country,
      timezone: options.location.timezone
    } : undefined
  };

  // Add domain filtering if specified (max 20 domains)
  if (options.allowedDomains && options.allowedDomains.length > 0) {
    webSearchTool.filters = {
      allowed_domains: options.allowedDomains.slice(0, 20)
    };
  }

  console.log("[WebSearch] Calling OpenAI with query:", query);
  console.log("[WebSearch] Tool config:", JSON.stringify(webSearchTool, null, 2));

  let response;
  try {
    response = await realOpenAI.responses.create({
      model: "gpt-4o-mini",
      tools: [webSearchTool],
      include: ["web_search_call.action.sources"], // Get all sources consulted
      input: query,
      store: false,
      metadata: { app: "rag-chat", purpose: "web_search" }
    });
    console.log("[WebSearch] Response received, output items:", response.output?.length || 0);
  } catch (error: any) {
    console.error("[WebSearch] API call failed:", error.message);
    console.error("[WebSearch] Error details:", error);
    throw error;
  }

  const results: WebSearchResult[] = [];
  const metadata: WebSearchMetadata = {};
  const seenUrls = new Set<string>();

  console.log("[WebSearch] Processing response output...");

  // Process response items
  for (const item of response.output || []) {
    console.log("[WebSearch] Processing item type:", item.type);

    // Extract search metadata from web_search_call
    if (item.type === "web_search_call" && item.action) {
      console.log("[WebSearch] web_search_call action type:", item.action.type);
      if (item.action.type === "search") {
        metadata.searchQuery = item.action.query;
        metadata.domainsSearched = item.action.domains;
        metadata.allSources = item.action.sources?.map((s: any) => s.url) || [];
        console.log("[WebSearch] Found search metadata - sources:", metadata.allSources?.length);
      }
    }

    // Extract citations from message annotations
    if (item.type === "message") {
      console.log("[WebSearch] Message content items:", item.content?.length || 0);
      for (const content of item.content || []) {
        console.log("[WebSearch] Content type:", content.type, "annotations:", content.annotations?.length || 0);
        if (content.type === "output_text" && content.annotations) {
          for (const annotation of content.annotations) {
            console.log("[WebSearch] Annotation type:", annotation.type);
            if (annotation.type === "url_citation") {
              // Avoid duplicate URLs
              if (seenUrls.has(annotation.url)) continue;
              seenUrls.add(annotation.url);

              // Extract snippet from the cited text
              const snippet = content.text.substring(
                annotation.start_index,
                annotation.end_index
              );

              console.log("[WebSearch] Found citation:", annotation.url);
              results.push({
                title: annotation.title || new URL(annotation.url).hostname,
                url: annotation.url,
                snippet: snippet.trim(),
                citationStart: annotation.start_index,
                citationEnd: annotation.end_index,
                relevance: 1.0 / (results.length + 1) // OpenAI orders by relevance
              });

              // Stop once we have enough results
              if (results.length >= maxResults) break;
            }
          }
        }
        if (results.length >= maxResults) break;
      }
    }
    if (results.length >= maxResults) break;
  }

  console.log("[WebSearch] Extracted", results.length, "citations from annotations");

  // Fallback: If no citations found, try to extract from output_text
  if (results.length === 0 && response.output_text) {
    console.log("[WebSearch] No citations, using fallback with sources:", metadata.allSources?.length || 0);
    // Use sources from metadata if available
    const sources = metadata.allSources || [];
    for (let i = 0; i < Math.min(sources.length, maxResults); i++) {
      const url = sources[i];
      try {
        const hostname = new URL(url).hostname;
        results.push({
          title: hostname,
          url: url,
          snippet: `Information from ${hostname}`,
          relevance: 1.0 / (i + 1)
        });
        console.log("[WebSearch] Added fallback result:", hostname);
      } catch {
        console.log("[WebSearch] Skipping invalid URL:", url);
        // Skip invalid URLs
      }
    }
  }

  console.log("[WebSearch] Final results count:", results.length);
  return { results, metadata };
}

async function realWebSearchStream(
  query: string,
  options: WebSearchOptions,
  onProgress: (event: { type: string; data?: any }) => void
): Promise<{ results: WebSearchResult[], metadata: WebSearchMetadata }> {
  if (!realOpenAI) {
    const { OpenAI } = await import("openai");
    realOpenAI = new OpenAI();
  }

  const maxResults = Math.min(Math.max(options.maxResults, 1), 8);

  // Build web search tool configuration
  const webSearchTool: any = {
    type: "web_search",
    search_context_size: options.contextSize,
    user_location: options.location ? {
      type: "approximate" as const,
      city: options.location.city,
      region: options.location.region,
      country: options.location.country,
      timezone: options.location.timezone
    } : undefined
  };

  // Add domain filtering if specified (max 20 domains)
  if (options.allowedDomains && options.allowedDomains.length > 0) {
    webSearchTool.filters = {
      allowed_domains: options.allowedDomains.slice(0, 20)
    };
  }

  console.log("[WebSearch] Calling OpenAI with streaming query:", query);
  console.log("[WebSearch] Tool config:", JSON.stringify(webSearchTool, null, 2));

  const stream = await realOpenAI.responses.create({
    model: "gpt-4o-mini",
    tools: [webSearchTool],
    include: ["web_search_call.action.sources"],
    input: query,
    stream: true,
    store: false,
    metadata: { app: "rag-chat", purpose: "web_search" }
  });

  const results: WebSearchResult[] = [];
  const metadata: WebSearchMetadata = {};
  const seenUrls = new Set<string>();
  let currentTextContent = "";

  for await (const event of stream) {
    switch (event.type) {
      case 'response.created':
        // stream initiated
        break;

      case 'response.in_progress':
        // model started generating; nothing to emit to UI yet
        break;

      case 'response.web_search_call.in_progress':
        console.log('[WebSearch] Search initiated');
        onProgress({ type: 'web_search.in_progress' });
        break;

      case 'response.web_search_call.searching':
        console.log('[WebSearch] Actively searching...');
        onProgress({ type: 'web_search.searching' });
        break;

      case 'response.web_search_call.completed':
        console.log('[WebSearch] Search completed');
        // Defer user-facing completion until after results are parsed.
        // This prevents showing "0 results" before we actually compute them.
        break;

      case 'response.output_text.delta':
        if (event.delta) {
          currentTextContent += event.delta;
        }
        break;

      case 'response.incomplete':
        console.error('[WebSearch] Response incomplete:', event.response?.incomplete_details);
        throw new Error(`Web search incomplete: ${JSON.stringify(event.response?.incomplete_details)}`);

      case 'response.completed':
        console.log('[WebSearch] Response completed, processing results...');

        // Process output items to extract citations
        const response = event.response;
        for (const item of response?.output || []) {
          // Extract search metadata
          if (item.type === "web_search_call" && item.action) {
            if (item.action.type === "search") {
              metadata.searchQuery = item.action.query;
              metadata.domainsSearched = item.action.domains;
              metadata.allSources = item.action.sources?.map((s: any) => s.url) || [];
            }
          }

          // Extract citations from message annotations
          if (item.type === "message") {
            for (const content of item.content || []) {
              if (content.type === "output_text" && content.annotations) {
                for (const annotation of content.annotations) {
                  if (annotation.type === "url_citation") {
                    if (seenUrls.has(annotation.url)) continue;
                    seenUrls.add(annotation.url);

                    const snippet = content.text.substring(
                      annotation.start_index,
                      annotation.end_index
                    );

                    results.push({
                      title: annotation.title || new URL(annotation.url).hostname,
                      url: annotation.url,
                      snippet: snippet.trim(),
                      citationStart: annotation.start_index,
                      citationEnd: annotation.end_index,
                      relevance: 1.0 / (results.length + 1)
                    });

                    if (results.length >= maxResults) break;
                  }
                }
              }
              if (results.length >= maxResults) break;
            }
          }
          if (results.length >= maxResults) break;
        }

        // Fallback if no citations found
        if (results.length === 0 && metadata.allSources) {
          const sources = metadata.allSources || [];
          for (let i = 0; i < Math.min(sources.length, maxResults); i++) {
            const url = sources[i];
            try {
              const hostname = new URL(url).hostname;
              results.push({
                title: hostname,
                url: url,
                snippet: `Information from ${hostname}`,
                relevance: 1.0 / (i + 1)
              });
            } catch {
              // Skip invalid URLs
            }
          }
        }
        // Emit final progress with accurate result count
        onProgress({ type: 'web_search.completed', data: { resultCount: results.length } });
        break;

      case 'response.failed':
        console.error('[WebSearch] Search failed:', event.response?.error);
        throw new Error(`Web search failed: ${JSON.stringify(event.response?.error)}`);

      case 'error':
        console.error('[WebSearch] Stream error:', event);
        throw new Error(`Web search stream error: ${JSON.stringify(event)}`);
    }
  }

  console.log("[WebSearch] Final results count:", results.length);
  return { results, metadata };
}

export const openaiClient: OpenAIAdapter = {
  embedTexts: (texts, dims) =>
    MOCK_OPENAI ? mockEmbed(texts, dims) : realEmbed(texts, dims),
  chat: (messages) => (MOCK_OPENAI ? mockChat(messages) : realChat(messages)),
  chatStream: (messages, onDelta) =>
    MOCK_OPENAI ? mockChatStream(messages, onDelta) : realChatStream(messages, onDelta),
  webSearch: (query, options) =>
    MOCK_OPENAI ? mockWebSearch(query, options) : realWebSearch(query, options),
  webSearchStream: (query, options, onProgress) =>
    MOCK_OPENAI ? mockWebSearchStream(query, options, onProgress) : realWebSearchStream(query, options, onProgress)
};
