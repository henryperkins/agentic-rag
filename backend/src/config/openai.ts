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
}

export interface WebSearchOptions {
  maxResults: number;
  contextSize: "low" | "medium" | "high";
  location?: WebSearchLocation | null;
}

interface OpenAIAdapter {
  embedTexts: (texts: string[], dims: number) => Promise<number[][]>;
  chat: (messages: Message[]) => Promise<string>;
  webSearch: (query: string, options: WebSearchOptions) => Promise<WebSearchResult[]>;
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

async function mockWebSearch(query: string, options: WebSearchOptions): Promise<WebSearchResult[]> {
  const count = Math.min(Math.max(options.maxResults, 1), 5);
  const seed = Number(strSeed(query)) || 1;
  const rng = seededRand(seed);
  return Array.from({ length: count }, (_, idx) => {
    const variant = Math.round(rng() * 1000);
    return {
      title: `Mock result ${idx + 1} for "${query}"`,
      url: `https://example.com/mock/${variant}`,
      snippet: `Synthetic snippet ${idx + 1} providing context for ${query}.`,
      publishedAt: new Date(2024, 0, (idx + 1) * 3).toISOString()
    };
  });
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
    }))
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

async function realWebSearch(query: string, options: WebSearchOptions): Promise<WebSearchResult[]> {
  if (!realOpenAI) {
    const { OpenAI } = await import("openai");
    realOpenAI = new OpenAI();
  }

  const maxResults = Math.min(Math.max(options.maxResults, 1), 8);
  const response = await realOpenAI.responses.create({
    model: "gpt-4o-mini",
    input: [
      {
        role: "system",
        content:
          "You are a web research assistant. Use the web_search tool to gather current information. Return concise structured JSON with up to the requested number of results including title, url, snippet, and optional publishedAt."
      },
      {
        role: "user",
        content: `Query: ${query}\nMax results: ${maxResults}`
      }
    ],
    tools: [
      {
        type: "web_search_preview",
        search_context_size: options.contextSize,
        user_location: options.location
          ? {
              type: "approximate" as const,
              city: options.location.city,
              region: options.location.region,
              country: options.location.country,
              timezone: options.location.timezone
            }
          : undefined
      }
    ],
    tool_choice: { type: "web_search_preview" as const },
    temperature: 0.2,
    text: {
      format: {
        type: "json_schema",
        name: "web_search_results",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            summary: {
              type: "string",
              description: "Optional short summary of the findings."
            },
            results: {
              type: "array",
              minItems: 0,
              maxItems: maxResults,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  title: { type: "string" },
                  url: { type: "string" },
                  snippet: { type: "string" },
                  publishedAt: { anyOf: [{ type: "string" }, { type: "null" }] }
                },
                required: ["title", "url", "snippet", "publishedAt"]
              }
            }
          },
          required: ["results"]
        }
      }
    }
  });

  const raw = (response.output_text || "").trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed?.results) ? parsed.results : [];
    return items.slice(0, maxResults).map((item: any) => ({
      title: String(item?.title ?? item?.url ?? query),
      url: String(item?.url ?? ""),
      snippet: String(item?.snippet ?? ""),
      publishedAt: item?.publishedAt ? String(item.publishedAt) : undefined
    }));
  } catch (error) {
    console.error("Failed to parse web search response", { raw, error });
    return [];
  }
}

export const openaiClient: OpenAIAdapter = {
  embedTexts: (texts, dims) =>
    MOCK_OPENAI ? mockEmbed(texts, dims) : realEmbed(texts, dims),
  chat: (messages) => (MOCK_OPENAI ? mockChat(messages) : realChat(messages)),
  webSearch: (query, options) =>
    MOCK_OPENAI ? mockWebSearch(query, options) : realWebSearch(query, options)
};
