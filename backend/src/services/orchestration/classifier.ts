// Layer 2: Orchestration - Query Classifier
import { openaiClient } from "../../config/openai";
import { USE_LLM_CLASSIFIER } from "../../config/constants";

export type RetrievalTarget = "vector" | "sql" | "web";

export type RouteDecision = {
  mode: "retrieve" | "direct";
  complexity: "low" | "medium" | "high";
  targets: RetrievalTarget[];
};

/**
 * Heuristic-based query classification (fast, no API cost)
 */
export function classifyQueryHeuristic(
  q: string,
  opts: { useRag: boolean; useWeb: boolean }
): RouteDecision {
  const len = q.split(/\s+/).length;
  const hasOps = /join|aggregate|compare|timeline|pipeline|why|how/i.test(q);
  const sqlIndicators = /\b(select|from|table|column|join|where|group by|order by|count|sum|avg|max|min)\b/i.test(
    q
  );
  const recencyIndicators = /\b(latest|today|yesterday|current|news|update|recent|202[4-9]|2025)\b/i.test(
    q
  );
  const trimmed = q.trim();
  const isGreeting = /^(hi|hello|hey|thanks|thank you|good\s+(morning|afternoon|evening)|hola|yo)\b/i.test(
    trimmed
  );
  const complexity = hasOps ? (len > 12 ? "high" : "medium") : len < 6 ? "low" : "medium";

  let mode: "retrieve" | "direct";
  if (hasOps || len > 6) {
    mode = "retrieve";
  } else if (isGreeting) {
    mode = "direct";
  } else if (!opts.useRag && opts.useWeb) {
    // Web-only retrieval: allow retrieve mode when RAG is off but Web is enabled
    mode = "retrieve";
  } else if (recencyIndicators && opts.useWeb) {
    // Temporal queries should retrieve when web search is available
    mode = "retrieve";
  } else if (!opts.useRag) {
    mode = "direct";
  } else {
    mode = "retrieve";
  }

  const targets: RetrievalTarget[] = [];
  // Respect user's choice for RAG
  if (opts.useRag) {
    targets.push("vector");
  }
  // Respect user's choice for Web, but also allow heuristic trigger if not explicitly disabled
  if (opts.useWeb) {
    targets.push("web");
  } else if (recencyIndicators && opts.useWeb !== false) {
    targets.push("web");
  }
  if (sqlIndicators) {
    targets.push("sql");
  }

  // If no targets are selected for a retrieval query, default to vector search.
  // This maintains original behavior for simple queries with default settings.
  if (targets.length === 0 && mode === "retrieve") {
    targets.push("vector");
  }

  const uniqueTargets = Array.from(new Set(targets));
  return { mode, complexity, targets: uniqueTargets };
}

/**
 * LLM-based query classification (intelligent, uses API)
 */
async function classifyQueryLLM(
  q: string,
  opts: { useRag: boolean; useWeb: boolean }
): Promise<RouteDecision> {
  const prompt = `You are a query router for a RAG system. Analyze this user query and determine:
1. MODE: Should we retrieve documents ("retrieve") or answer directly ("direct")?
   - Use "retrieve" for questions requiring factual lookup, technical details, or domain knowledge
   - Use "direct" for greetings, simple calculations, or general knowledge

2. COMPLEXITY: Rate as "low", "medium", or "high"
   - "low": Simple factual questions (who, what, when)
   - "medium": Questions requiring synthesis or comparison
   - "high": Multi-step reasoning, aggregation, or complex analysis

3. TARGETS: Which retrieval sources to use (array of: "vector", "sql", "web")
   - "vector": Use for semantic search in document corpus. This is ${opts.useRag ? "ENABLED" : "DISABLED"}.
   - "sql": Use if query asks for structured data, counts, aggregations, or database operations.
   - "web": Use if query asks for recent events, news, current information, or real-time data. This is ${opts.useWeb ? "ENABLED" : "DISABLED"}.

You MUST respect the ENABLED/DISABLED state. Do not include a disabled target in your response.

Query: "${q}"

Respond with ONLY valid JSON in this exact format:
{
  "mode": "retrieve",
  "complexity": "medium",
  "targets": ["vector", "web"]
}`;

  const response = await openaiClient.chat([
    { role: "system", content: "You are a precise query classifier. Respond only with valid JSON." },
    { role: "user", content: prompt }
  ]);

  // Parse JSON response
  const cleaned = response.trim().replace(/^```json\n?/, "").replace(/\n?```$/, "");
  const parsed = JSON.parse(cleaned);

  // Validate and normalize
  const mode = ["retrieve", "direct"].includes(parsed.mode) ? parsed.mode : "retrieve";
  const complexity = ["low", "medium", "high"].includes(parsed.complexity) ? parsed.complexity : "medium";
  const rawTargets: string[] = Array.isArray(parsed.targets)
    ? parsed.targets.filter((t: string) => ["vector", "sql", "web"].includes(t))
    : [];

  // Enforce feature flags by intersecting with enabled targets
  const filtered = rawTargets.filter((t: string) => {
    if (t === "vector") return opts.useRag;
    if (t === "web") return opts.useWeb;
    return true; // "sql"
  });

  let finalTargets = Array.from(new Set(filtered)) as RetrievalTarget[];

  // Fallback: ensure at least one target when in retrieve mode
  if (finalTargets.length === 0 && mode === "retrieve") {
    if (opts.useRag) finalTargets = ["vector"];
    else if (opts.useWeb) finalTargets = ["web"];
  }

  return {
    mode,
    complexity,
    targets: finalTargets
  };
}

/**
 * Timeout wrapper to prevent hanging API calls
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

/**
 * Main classifier with LLM support and fallback to heuristics
 */
export async function classifyQuery(
  q: string,
  opts: { useRag: boolean; useWeb: boolean }
): Promise<RouteDecision> {
  if (!USE_LLM_CLASSIFIER) {
    return classifyQueryHeuristic(q, opts);
  }

  try {
    // Add 10 second timeout to LLM classifier to prevent hanging
    return await withTimeout(
      classifyQueryLLM(q, opts),
      10000,
      "LLM classifier timed out after 10 seconds"
    );
  } catch (error) {
    console.warn("LLM classifier failed, falling back to heuristics:", error);
    return classifyQueryHeuristic(q, opts);
  }
}
