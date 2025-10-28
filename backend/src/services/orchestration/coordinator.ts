// Layer 2: Orchestration - Master Coordinator
import { SSEOutEvent, FinalEvent } from "../../../../shared/types";
import { classifyQuery } from "./classifier";
import { Agents } from "./registry";
import { withSpan, addEvent } from "../../config/otel";
import { normalize, responseCache, retrievalCache } from "../cache";
import {
  MAX_VERIFICATION_LOOPS,
  ALLOW_LOW_GRADE_FALLBACK,
  CACHE_FAILURES,
  ENABLE_QUERY_REWRITING,
  WEB_SEARCH_CONCURRENT_REQUESTS,
  WEB_SEARCH_FAILURE_THROTTLE_MS
} from "../../config/constants";
import { maybeRewriteQuery, persistRewrite } from "../query";
import type { HybridRetrieveResult, RetrievedChunk } from "../retrieval";
import * as retrieval from "../retrieval";
import * as verifierModule from "../verifier";
import { Semaphore } from "async-mutex";

const webSearchSemaphore = new Semaphore(WEB_SEARCH_CONCURRENT_REQUESTS);
const webSearchFailures = new Map<string, { count: number; lastAttempt: number }>();

type RetrievalPayload = {
  chunks: RetrievedChunk[];
  queryEmbedding?: number[];
};

async function safeHybridRetrieve(query: string, useHybrid: boolean): Promise<HybridRetrieveResult> {
  const agentFn = Agents.retrieval?.hybridRetrieve;
  if (typeof agentFn === "function") {
    const result = await agentFn(query, useHybrid);
    if (Array.isArray(result)) {
      return result as HybridRetrieveResult;
    }
  }
  return retrieval.hybridRetrieve(query, useHybrid);
}

async function safeGradeChunksWithScores(
  query: string,
  chunks: { id: string; content: string }[],
  queryEmbedding?: number[]
) {
  const agentFn = Agents.processing?.gradeChunksWithScores;
  if (typeof agentFn === "function") {
    const result = await agentFn(query, chunks, queryEmbedding);
    if (result && typeof result === "object" && "grades" in result && "metadata" in result) {
      return result;
    }
  }
  if (typeof verifierModule.gradeChunksWithScores === "function") {
    const directResult = await verifierModule.gradeChunksWithScores(query, chunks, queryEmbedding);
    if (directResult && typeof directResult === "object" && "grades" in directResult && "metadata" in directResult) {
      return directResult;
    }
  }

  const fallbackGrades: Record<string, "high" | "medium" | "low"> = {};
  const fallbackScores: Record<string, number> = {};
  for (const ch of chunks) {
    fallbackGrades[ch.id] = "medium";
    fallbackScores[ch.id] = 0;
  }

  return {
    grades: fallbackGrades,
    metadata: {
      scores: fallbackScores,
      method: "fallback" as const
    }
  };
}

async function safeVerifyAnswer(
  answer: string,
  evidence: { id: string; content: string }[]
) {
  if (process.env.MOCK_OPENAI === "1") {
    return Promise.resolve(verifierModule.verifyAnswer(answer, evidence));
  }
  const agentFn = Agents.quality?.verifyAnswer;
  if (typeof agentFn === "function") {
    const result = await agentFn(answer, evidence);
    if (result && typeof result === "object" && "isValid" in result && "confidence" in result) {
      return result;
    }
  }
  return Promise.resolve(verifierModule.verifyAnswer(answer, evidence));
}

/**
 * Cleans chunk content by removing metadata and frontmatter
 */
function cleanChunkContent(content: string): string {
  let cleaned = content;

  // Remove YAML frontmatter (between --- markers)
  cleaned = cleaned.replace(/^---\s*[\s\S]*?---\s*/m, "");

  // Remove XML-style tags like <page>, <source>, etc.
  cleaned = cleaned.replace(/<\/?[^>]+>/g, "");

  // Remove common metadata fields
  cleaned = cleaned.replace(/^(title|description|author|published|created|lastUpdated|chatbotDeprioritize|source_url|html|md):\s*.*$/gm, "");

  // Remove multiple consecutive blank lines
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

  return cleaned.trim();
}

/**
 * Smart truncate that avoids breaking markdown syntax
 */
function smartTruncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  let truncated = text.slice(0, maxLength);

  // Check if we are inside a fenced code block
  const lastCodeBlockStart = truncated.lastIndexOf("```");
  if (lastCodeBlockStart !== -1) {
    const subsequentCodeBlockEnd = truncated.indexOf("```", lastCodeBlockStart + 3);
    if (subsequentCodeBlockEnd === -1) {
      // We are inside a code block, so close it properly
      return truncated.trim() + "\n...\n```";
    }
  }

  // Try to truncate at a sentence boundary
  const lastPeriod = truncated.lastIndexOf(". ");
  const lastNewline = truncated.lastIndexOf("\n");

  // Find the best break point
  const breakPoint = Math.max(lastPeriod, lastNewline);

  if (breakPoint > maxLength * 0.7) {
    // Use sentence/paragraph break if it's not too early
    return text.slice(0, breakPoint + 1).trim() + "...";
  }

  // Otherwise just truncate but try to avoid breaking inline code
  const safePoint = truncated.lastIndexOf(" ");
  if (safePoint > maxLength * 0.8) {
    return text.slice(0, safePoint).trim() + "...";
  }

  return truncated.trim() + "...";
}

// Coordinator is a thin orchestration layer mirroring L2 with hooks to L3/L7/L8/L14.
export async function runCoordinator(
  message: string,
  sender: (e: SSEOutEvent) => void,
  opts: { useRag: boolean; useHybrid: boolean; useWeb: boolean; allowedDomains?: string[]; webMaxResults?: number }
) {
  console.log('[Coordinator] Options received:', JSON.stringify(opts));
  const decision = await classifyQuery(message, opts);
  console.log('[Coordinator] Classification result:', JSON.stringify(decision));
  sender({
    type: "agent_log",
    role: "planner",
    message: `Route: ${decision.mode}, complexity: ${decision.complexity}, targets: ${decision.targets.join(
      "+"
    )}`,
    ts: Date.now()
  });

  // Layer 7/9: semantic response cache (read-through)
  const domainsKey = opts.allowedDomains ? opts.allowedDomains.slice().sort().join(",") : "";
  const key = normalize(`resp:${opts.useRag}:${opts.useHybrid}:${opts.useWeb}:${domainsKey}:${opts.webMaxResults}:${message}`);
  const cacheEnabled = process.env.MOCK_OPENAI !== "1";
  if (cacheEnabled) {
    const cached = responseCache.get(key) as FinalEvent | undefined;
    if (cached) {
      // Replay the cached event, splitting text into token events for streaming effect
      const text = cached.text || "";
      for (const chunk of text.match(/.{1,60}/g) || []) {
        sender({ type: "tokens", text: chunk, ts: Date.now() });
      }
      sender({ ...cached, ts: Date.now() });
      return;
    }
  }

  // Handle case when no retrieval methods are enabled
  if (!opts.useRag && !opts.useWeb) {
    const text = "⚠️ No retrieval methods enabled. Please enable at least one of:\n\n- **Search Documents** (local knowledge base)\n- **Hybrid Search** (semantic + keyword)\n- **Web Search** (live internet results)";
    for (const chunk of text.match(/.{1,60}/g) || []) sender({ type: "tokens", text: chunk, ts: Date.now() });
    sender({ type: "final", text, citations: [], verified: false, ts: Date.now() });
    return;
  }

  // Allow direct mode for simple queries (greetings, etc.)
  if (decision.mode === "direct") {
    const text = `Direct mode: ${message}`;
    for (const chunk of text.match(/.{1,60}/g) || []) sender({ type: "tokens", text: chunk, ts: Date.now() });
    sender({ type: "final", text, citations: [], verified: false, ts: Date.now() });
    return;
  }

  let working = message;
  if (ENABLE_QUERY_REWRITING) {
    const { rewritten, reason } = maybeRewriteQuery(working);
    if (rewritten && rewritten !== working) {
      sender({
        type: "agent_log",
        role: "planner",
        message: `Rewriting query (${reason})…`,
        ts: Date.now()
      });
      sender({ type: "rewrite", original: message, rewritten, ts: Date.now() });
      try {
        await withSpan(
          "query.persistRewrite",
          () => persistRewrite(message, rewritten),
          { applied: true }
        );
      } catch (err) {
        console.warn("[Coordinator] Failed to persist rewrite", err);
      }
      working = rewritten;
      addEvent("query.rewrite", { enabled: true, applied: true, reason });
    } else {
      addEvent("query.rewrite", { enabled: true, applied: false, reason });
    }
  } else {
    addEvent("query.rewrite", { enabled: false, applied: false });
  }

  // Retrieve → process → generate → verify with bounded loops
  let loops = 0;
  const targetsKey = decision.targets.slice().sort().join("+");
  const allowWeb = opts.useWeb;
  // Track web search state outside span for error messages
  let usedWeb = false;
  let webChunksFound = 0;
  while (loops <= MAX_VERIFICATION_LOOPS) {
    let completed = false;
    await withSpan("retrieve", async () => {
      const modeLabel = [
        opts.useRag ? (opts.useHybrid ? "hybrid" : "vector") : null,
        decision.targets.includes("sql") ? "sql" : null,
        allowWeb ? "web" : null
      ]
        .filter(Boolean)
        .join("+");
      sender({
        type: "agent_log",
        role: "researcher",
        message: `Retrieving evidence (${modeLabel})…`,
        ts: Date.now()
      });

      const cacheKey = normalize(`ret:${targetsKey}:${working}`);
      const canUseCache = !(allowWeb && decision.targets.includes("web"));
      let payload = (canUseCache ? retrievalCache.get(cacheKey) : undefined) as RetrievalPayload | undefined;
      let webMetadata: { searchQuery?: string; domainsSearched?: string[]; allSources?: string[] } | null = null;

      if (!payload) {
        let combined: RetrievedChunk[] = [];
        let queryEmbedding: number[] | undefined;

        if (opts.useRag) {
          const vectorResults = await safeHybridRetrieve(working, opts.useHybrid);
          queryEmbedding = vectorResults.queryEmbedding;
          combined = combined.concat(vectorResults);
        }

        if (decision.targets.includes("sql")) {
          const sqlResults = await withSpan(
            "retrieve.sql",
            () => Agents.retrieval.sqlRetrieve(working),
            { enabled: decision.targets.includes("sql") }
          );
          combined = combined.concat(sqlResults);
        }

        if (allowWeb && (decision.targets.includes("web") || combined.length === 0)) {
          const failureKey = normalize(`webfailure:${working}`);
          const failureInfo = webSearchFailures.get(failureKey);
          if (failureInfo && Date.now() - failureInfo.lastAttempt < WEB_SEARCH_FAILURE_THROTTLE_MS * Math.pow(2, failureInfo.count)) {
            // Throttled
          } else {
            const [, release] = await webSearchSemaphore.acquire();
            try {
              const webResponse = await withSpan(
                "retrieve.web",
                () => Agents.retrieval.webRetrieveWithMetadataStream(
                  working,
                  opts.allowedDomains,
                  (event) => {
                    // Forward web search progress events to frontend
                    switch (event.type) {
                      case 'web_search.in_progress':
                        sender({
                          type: "agent_log",
                          role: "researcher",
                          message: "Initiating web search...",
                          ts: Date.now()
                        });
                        break;
                      case 'web_search.searching':
                        sender({
                          type: "agent_log",
                          role: "researcher",
                          message: "Searching the web...",
                          ts: Date.now()
                        });
                        break;
                      case 'web_search.completed':
                        sender({
                          type: "agent_log",
                          role: "researcher",
                          message: `Web search completed (${event.data?.resultCount || 0} results).`,
                          ts: Date.now()
                        });
                        break;
                    }
                  },
                  opts.webMaxResults
                ),
                { enabled: true }
              );
              // Track web search usage for error messages
              usedWeb = true;
              webChunksFound = webResponse.chunks.length;

              // Always capture metadata so UI can confirm a search actually ran
              webMetadata = webResponse.metadata;

              if (webResponse.chunks.length > 0) {
                combined = combined.concat(webResponse.chunks);
                webSearchFailures.delete(failureKey);
              } else {
                const info = webSearchFailures.get(failureKey) || { count: 0, lastAttempt: 0 };
                info.count++;
                info.lastAttempt = Date.now();
                webSearchFailures.set(failureKey, info);
              }
            } catch (err) {
              console.error("[Coordinator] Web search failed:", err);
              sender({
                type: "agent_log",
                role: "researcher",
                message: `Web search failed. Falling back to other retrieval methods. Error: ${err instanceof Error ? err.message : "Unknown"}`,
                ts: Date.now()
              });
              addEvent("web_search.error", { message: err instanceof Error ? err.message : String(err) });
            } finally {
              release();
            }
          }
        }

        payload = { chunks: combined, queryEmbedding };
        if (canUseCache && !usedWeb && cacheEnabled) {
          retrievalCache.set(cacheKey, payload);
        }
      }

      if (!payload) {
        payload = { chunks: [], queryEmbedding: undefined };
      }

      const retrieved = payload.chunks;
      const queryEmbedding = payload.queryEmbedding;

      if (usedWeb && webMetadata) {
        // Emit web search metadata for frontend display
        sender({
          type: "web_search_metadata",
          searchQuery: webMetadata.searchQuery || working,
          domainsSearched: webMetadata.domainsSearched,
          allSources: webMetadata.allSources,
          ts: Date.now()
        });

        sender({
          type: "agent_log",
          role: "researcher",
          message: `Augmented with ${webMetadata.allSources?.length || 0} live web sources${webMetadata.searchQuery !== working ? ` (query: "${webMetadata.searchQuery}")` : ""}.`,
          ts: Date.now()
        });
      }

      sender({
        type: "agent_log",
        role: "researcher",
        message: "Grading retrieved chunks for relevance...",
        ts: Date.now()
      });

      // Grade chunks with semantic understanding when embeddings are available
      const grades = await withSpan("grade", async () => {
        // Use gradeChunksWithScores to get both grades and metadata
        const { grades: gradeResult, metadata } = await safeGradeChunksWithScores(
          working,
          retrieved.map((r) => ({ id: r.id, content: r.content })),
          queryEmbedding
        );

        // Log grading metadata for observability
        addEvent("grade.completed", {
          method: metadata.method,
          totalChunks: retrieved.length,
          scores: Object.values(metadata.scores),
          usedEmbedding: Boolean(queryEmbedding)
        });

        return gradeResult;
      });

      const highs = retrieved.filter((r) => grades[r.id] === "high");
      const mediums = retrieved.filter((r) => grades[r.id] === "medium");
      const lows = retrieved.filter((r) => grades[r.id] === "low");

      // Log grade distribution for observability (negative feedback loop)
      addEvent("grade.distribution", {
        high: highs.length,
        medium: mediums.length,
        low: lows.length,
        total: retrieved.length,
        highIds: highs.map(h => h.id).slice(0, 5), // Sample of high-grade IDs
        lowIds: lows.map(l => l.id).slice(0, 5) // Sample of low-grade IDs for analysis
      });

      // Prefer highs, fallback to mediums
      let approved = highs.length ? highs : mediums.slice(0, 3);

      const citations = approved.map((a) => ({
        document_id: a.document_id,
        source: a.source,
        chunk_index: a.chunk_index,
        ...(a.citationStart !== undefined && { citationStart: a.citationStart }),
        ...(a.citationEnd !== undefined && { citationEnd: a.citationEnd }),
        ...(a.id.startsWith('web:') && { isWebSource: true })
      }));
      sender({ type: "citations", citations, ts: Date.now() });

      if (approved.length === 0) {
        // Enhanced fallback with graceful degradation
        addEvent("retrieval.no_approved", {
          totalRetrieved: retrieved.length,
          highCount: highs.length,
          mediumCount: mediums.length,
          lowCount: lows.length
        });

        // Try low-grade chunks if allowed
        if (ALLOW_LOW_GRADE_FALLBACK && lows.length > 0) {
          sender({
            type: "agent_log",
            role: "researcher",
            message: `No high or medium quality matches found. Using ${lows.length} low-confidence results with disclaimer.`,
            ts: Date.now()
          });

          approved = lows.slice(0, 3);
          // Continue with low-grade chunks but mark as low confidence
        } else {
          // Detect web-only mode (no local RAG)
          const isWebOnlyMode = !opts.useRag && opts.useWeb;

          // Provide detailed fallback guidance with accurate web search status
          const webSearchMsg = usedWeb
            ? (webChunksFound > 0
              ? `\n- Web search returned ${webChunksFound} results but none met quality threshold`
              : `\n- Web search returned no results`)
            : (allowWeb
              ? `\n- Web search was not invoked (local results found but low quality)`
              : `\n- Enable web search for broader coverage`);

          // Different messaging for web-only mode vs RAG mode
          let detailedFeedback: string;
          if (isWebOnlyMode) {
            detailedFeedback = [
              `No results found from web search.`,
              `\n\n**Search Status:**`,
              `\n- Web search performed: ${usedWeb ? 'Yes' : 'No'}`,
              `\n- Results retrieved: ${webChunksFound}`,
              `\n\n**Suggestions:**`,
              `\n- Try rephrasing your question with different keywords`,
              `\n- Be more specific in your query`,
              `\n- Check if your query requires very recent information`,
              `\n- Consider uploading relevant documents to the knowledge base`
            ].join("");
          } else {
            detailedFeedback = [
              `No supporting evidence found in the current knowledge base.`,
              `\n\n**Retrieved:** ${retrieved.length} chunks`,
              `\n- High quality: ${highs.length}`,
              `\n- Medium quality: ${mediums.length}`,
              `\n- Low quality: ${lows.length}`,
              `\n\n**Suggestions:**`,
              `\n- Try rephrasing your question`,
              `\n- Use different keywords or terminology`,
              `\n- Expand the document corpus`,
              webSearchMsg
            ].join("");
          }

          const verify = await safeVerifyAnswer("", []);
          addEvent("verification.completed", {
            isValid: verify.isValid,
            confidence: verify.confidence,
            approvedChunks: approved.length
          });

          sender({
            type: "verification",
            isValid: verify.isValid,
            gradeSummary: grades as any,
            feedback: verify.feedback,
            ts: Date.now()
          });

          if (!verify.isValid && loops < MAX_VERIFICATION_LOOPS) {
            sender({ type: "agent_log", role: "planner", message: "Verification failed — refining and retrying…", ts: Date.now() });
            if (verify.confidence < 0.5) {
              const original = working;
              const rewritten = await Agents.quality.rewriteQuery(working);
              sender({ type: "rewrite", original, rewritten, ts: Date.now() });
              addEvent("query.rewrite", { enabled: true, applied: true, reason: "verification" });
              try {
                await withSpan(
                  "query.persistRewrite",
                  () => persistRewrite(original, rewritten),
                  { applied: true, reason: "verification" }
                );
              } catch (err) {
                console.warn("[Coordinator] Failed to persist verification rewrite", err);
              }
              working = rewritten;
            } else {
              working = `${message} (focus: disambiguate terms)`;
            }
            return;
          }

          sender({
            type: "agent_log",
            role: "researcher",
            message: `No supporting evidence found. Returning detailed guidance.`,
            ts: Date.now()
          });

          for (const c of detailedFeedback.match(/.{1,60}/g) || []) {
            sender({ type: "tokens", text: c, ts: Date.now() });
          }

          sender({
            type: "final",
            text: detailedFeedback,
            citations: [],
            rewrittenQuery: working !== message ? working : undefined,
            verified: verify.isValid,
            ts: Date.now()
          });

          if (CACHE_FAILURES && cacheEnabled) {
            const finalEvent: FinalEvent = {
              type: "final",
              text: detailedFeedback,
              citations: [],
              rewrittenQuery: working !== message ? working : undefined,
              verified: verify.isValid,
              ts: Date.now()
            };
            responseCache.set(key, finalEvent);
          }

          completed = true;
          return;
        }
      }

      sender({
        type: "agent_log",
        role: "writer",
        message: "Composing answer from approved evidence...",
        ts: Date.now()
      });
      // Writer (simple extractive compose from approved)
      const answer = await withSpan("answer", () => {
        const parts: string[] = approved.slice(0, 3).map((ev) => {
          // Clean metadata and frontmatter
          const cleaned = cleanChunkContent(ev.content);
          // Smart truncate to avoid breaking markdown (increased limit from 260 to 500)
          const snip = smartTruncate(cleaned, 500);
          let sourceName = `document ${ev.document_id}`;
          if (ev.source) {
            try {
              sourceName = new URL(ev.source).hostname;
            } catch {
              sourceName = ev.source;
            }
          }
          return `${snip}\n\n*[Source: ${sourceName}]*`;
        });
        // If the first part is a web search summary, don't add the prefix
        if (approved[0]?.id.startsWith("web:")) {
          return parts.join("\n\n");
        }
        return `**Answer (from evidence):**\n\n${parts.join("\n\n")}`;
      });

      // Stream
      for (const c of answer.match(/.{1,60}/g) || []) sender({ type: "tokens", text: c, ts: Date.now() });

      sender({
        type: "agent_log",
        role: "critic",
        message: "Verifying answer against evidence...",
        ts: Date.now()
      });
      const verify = await withSpan("verify", () =>
        safeVerifyAnswer(answer, approved.map((a) => ({ id: a.id, content: a.content })))
      );

      // Log verification metadata
      addEvent("verification.completed", {
        isValid: verify.isValid,
        confidence: verify.confidence,
        approvedChunks: approved.length
      });

      sender({
        type: "verification",
        isValid: verify.isValid,
        gradeSummary: grades as any,
        feedback: verify.feedback,
        ts: Date.now()
      });

      if (verify.isValid || loops === MAX_VERIFICATION_LOOPS) {
        if (cacheEnabled) {
          const finalEvent: FinalEvent = {
            type: "final",
            text: answer,
            citations,
            rewrittenQuery: working !== message ? working : undefined,
            verified: verify.isValid,
            ts: Date.now()
          };
          responseCache.set(key, finalEvent);
        }
        sender({ type: "final", text: answer, citations, rewrittenQuery: working !== message ? working : undefined, verified: verify.isValid, ts: Date.now() });
        completed = true;
      } else {
        sender({ type: "agent_log", role: "planner", message: "Verification failed — refining and retrying…", ts: Date.now() });
        if (verify.confidence < 0.5) {
          const original = working;
          const rewritten = await Agents.quality.rewriteQuery(working);
          sender({ type: "rewrite", original, rewritten, ts: Date.now() });
          addEvent("query.rewrite", { enabled: true, applied: true, reason: "verification" });
          try {
            await withSpan(
              "query.persistRewrite",
              () => persistRewrite(original, rewritten),
              { applied: true, reason: "verification" }
            );
          } catch (err) {
            console.warn("[Coordinator] Failed to persist verification rewrite", err);
          }
          working = rewritten;
        } else {
          working = `${message} (focus: disambiguate terms)`;
        }
      }
    }, { loops });

    if (responseCache.get(key) || completed) break;
    loops++;
  }
}
