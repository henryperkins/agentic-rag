// Layer 2/3: Agent Registry
import { createHash } from "crypto";
import { hybridRetrieve, type RetrievedChunk } from "../retrieval";
import { gradeChunks, verifyAnswer } from "../verifier";
import { openaiClient } from "../../config/openai";
import { runSqlAgent } from "../executors/sql";
import { performWebSearch } from "../webSearch";
import {
  ENABLE_SQL_AGENT,
  ENABLE_WEB_SEARCH,
  SQL_AGENT_ALLOWLIST
} from "../../config/constants";

export const Agents = {
  retrieval: {
    hybridRetrieve,
    async sqlRetrieve(query: string): Promise<RetrievedChunk[]> {
      if (!ENABLE_SQL_AGENT) return [];
      if (SQL_AGENT_ALLOWLIST.length === 0) return [];

      const rows = await runSqlAgent({ message: query });
      if (!rows.length) return [];

      return rows.map((row, idx) => ({
        id: row.id ?? `${row.source ?? "sql"}:${idx}`,
        document_id: row.document_id ?? row.source ?? "sql",
        chunk_index: row.chunk_index ?? idx,
        content: row.content,
        source: row.source ?? "sql",
        score: row.score ?? 0
      }));
    },
    async webRetrieve(query: string): Promise<RetrievedChunk[]> {
      if (!ENABLE_WEB_SEARCH) return [];
      const webResults = await performWebSearch(query, 5);
      return webResults.map((res, idx) => {
        const hash = createHash("sha1")
          .update(res.url || `${query}-${idx}`)
          .digest("hex");
        let docId = res.url || `web:${idx}`;
        if (res.url) {
          try {
            const url = new URL(res.url);
            docId = url.hostname;
          } catch {
            docId = res.url;
          }
        }
        return {
          id: `web:${hash}`,
          document_id: docId,
          chunk_index: idx,
          content: `${res.title}\n\n${res.snippet}`,
          source: res.url || res.title,
          score: res.score
        };
      });
    }
  },
  processing: {
    gradeChunks,
    async summarize(text: string) {
      const content = await openaiClient.chat([
        { role: "system", content: "Summarize succinctly." },
        { role: "user", content: text }
      ]);
      return content;
    }
  },
  quality: {
    verifyAnswer
  }
};
