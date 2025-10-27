// Layer 2: Orchestration - Master Coordinator
import { SSEOutEvent } from "../../../../shared/types";
import { classifyQuery } from "./classifier";
import { Agents } from "./registry";
import { withSpan, addEvent } from "../../config/otel";
import { normalize, responseCache, retrievalCache } from "../cache";
import { MAX_VERIFICATION_LOOPS } from "../../config/constants";

// Coordinator is a thin orchestration layer mirroring L2 with hooks to L3/L7/L8/L14.
export async function runCoordinator(
  message: string,
  sender: (e: SSEOutEvent) => void,
  opts: { useRag: boolean; useHybrid: boolean; useWeb: boolean }
) {
  const decision = classifyQuery(message);
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

  if (!opts.useRag || decision.mode === "direct") {
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
        opts.useHybrid ? "hybrid" : "vector",
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
        const vectorResults = await Agents.retrieval.hybridRetrieve(working, opts.useHybrid);
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
        const snip = ev.content.length > 260 ? ev.content.slice(0, 260) + "..." : ev.content;
        return `${snip.trim()} [cite:${ev.document_id}:${ev.chunk_index}]`;
      });
      const answer = `**Answer (from evidence):**\n${parts.join("\n\n")}`;

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
