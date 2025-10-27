// Layer 2: Orchestration - Master Coordinator
import { SSEOutEvent } from "../../../../shared/types";
import { classifyQuery } from "./classifier";
import { Agents } from "./registry";
import { withSpan, addEvent } from "../../config/otel";
import { normalize, responseCache, retrievalCache } from "../cache";
import { MAX_VERIFICATION_LOOPS } from "../../config/constants";

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

  // Try to truncate at a sentence boundary
  const truncated = text.slice(0, maxLength);
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
  opts: { useRag: boolean; useHybrid: boolean; useWeb: boolean }
) {
  const decision = await classifyQuery(message);
  sender({
    type: "agent_log",
    role: "planner",
    message: `Route: ${decision.mode}, complexity: ${decision.complexity}, targets: ${decision.targets.join(
      "+"
    )}`,
    ts: Date.now()
  });

  // Layer 7/9: semantic response cache (read-through)
  const key = normalize(`resp:${opts.useRag}:${opts.useHybrid}:${opts.useWeb}:${message}`);
  const cached = responseCache.get(key);
  if (cached) {
    sender({ type: "tokens", text: cached, ts: Date.now() });
    sender({ type: "final", text: cached, citations: [], verified: true, ts: Date.now() });
    return;
  }

  // Allow web-only mode (when useWeb=true but useRag=false)
  if ((!opts.useRag && !opts.useWeb) || decision.mode === "direct") {
    const text = `Direct mode: ${message}`;
    for (const chunk of text.match(/.{1,60}/g) || []) sender({ type: "tokens", text: chunk, ts: Date.now() });
    sender({ type: "final", text, citations: [], verified: false, ts: Date.now() });
    return;
  }

  // Retrieve → process → generate → verify with bounded loops
  let loops = 0;
  let working = message;
  const targetsKey = decision.targets.slice().sort().join("+");
  const allowWeb = opts.useWeb;
  while (loops <= MAX_VERIFICATION_LOOPS) {
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
      let retrieved = canUseCache ? retrievalCache.get(cacheKey) : undefined;
      let usedWeb = false;
      if (!retrieved) {
        // Only retrieve from local store if useRag is enabled
        const vectorResults = opts.useRag ? await Agents.retrieval.hybridRetrieve(working, opts.useHybrid) : [];
        let combined = vectorResults.slice();

        if (decision.targets.includes("sql")) {
          const sqlResults = await withSpan(
            "retrieve.sql",
            () => Agents.retrieval.sqlRetrieve(working),
            { enabled: decision.targets.includes("sql") }
          );
          combined = combined.concat(sqlResults);
        }

        if (allowWeb && (decision.targets.includes("web") || combined.length === 0)) {
          const webResults = await withSpan(
            "retrieve.web",
            () => Agents.retrieval.webRetrieve(working),
            { enabled: true }
          );
          if (webResults.length > 0) {
            combined = combined.concat(webResults);
            usedWeb = true;
          }
        }

        retrieved = combined;
        if (canUseCache && !usedWeb) {
          retrievalCache.set(cacheKey, retrieved);
        }
      }

      if (usedWeb) {
        sender({
          type: "agent_log",
          role: "researcher",
          message: "Augmented with live web results for freshness.",
          ts: Date.now()
        });
      }

      const grades = Agents.processing.gradeChunks(
        working,
        retrieved.map((r) => ({ id: r.id, content: r.content }))
      );

      const highs = retrieved.filter((r) => grades[r.id] === "high");
      const mediums = retrieved.filter((r) => grades[r.id] === "medium");
      const approved = highs.length ? highs : mediums.slice(0, 3);

      const citations = approved.map((a) => ({
        document_id: a.document_id,
        source: a.source,
        chunk_index: a.chunk_index
      }));
      sender({ type: "citations", citations, ts: Date.now() });

      if (approved.length === 0) {
        const fallback = "No supporting evidence found in the current knowledge base. Try rephrasing, expanding the corpus, or disabling hybrid retrieval.";
        sender({ type: "agent_log", role: "researcher", message: "No supporting evidence found — returning fallback guidance.", ts: Date.now() });
        for (const c of fallback.match(/.{1,60}/g) || []) sender({ type: "tokens", text: c, ts: Date.now() });
        sender({ type: "verification", isValid: false, gradeSummary: grades as any, feedback: "No evidence retrieved for the query.", ts: Date.now() });
        sender({ type: "final", text: fallback, citations: [], rewrittenQuery: working !== message ? working : undefined, verified: false, ts: Date.now() });
        responseCache.set(key, fallback);
        return;
      }

      // Writer (simple extractive compose from approved)
      const parts: string[] = approved.slice(0, 3).map((ev) => {
        // Clean metadata and frontmatter
        const cleaned = cleanChunkContent(ev.content);
        // Smart truncate to avoid breaking markdown (increased limit from 260 to 500)
        const snip = smartTruncate(cleaned, 500);
        return `${snip}\n\n*[Source: ${ev.chunk_index + 1}]*`;
      });
      const answer = `**Answer (from evidence):**\n\n${parts.join("\n\n---\n\n")}`;

      // Stream
      for (const c of answer.match(/.{1,60}/g) || []) sender({ type: "tokens", text: c, ts: Date.now() });

      const verify = Agents.quality.verifyAnswer(answer, approved.map((a) => ({ id: a.id, content: a.content })));
      sender({ type: "verification", isValid: verify.isValid, gradeSummary: grades as any, feedback: verify.feedback, ts: Date.now() });

      if (verify.isValid || loops === MAX_VERIFICATION_LOOPS) {
        responseCache.set(key, answer);
        sender({ type: "final", text: answer, citations, rewrittenQuery: working !== message ? working : undefined, verified: verify.isValid, ts: Date.now() });
      } else {
        sender({ type: "agent_log", role: "planner", message: "Verification failed — refining and retrying…", ts: Date.now() });
        working = `${message} (focus: disambiguate terms)`;
      }
    }, { loops });

    if (responseCache.get(key)) break;
    loops++;
  }
}
