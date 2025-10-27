// Layer 2/3: Agent Registry
import { createHash } from "crypto";
import { hybridRetrieve, type RetrievedChunk } from "../retrieval";
import { gradeChunks, gradeChunksWithScores, verifyAnswer } from "../verifier";
import { openaiClient } from "../../config/openai";
import { runSqlAgent } from "../executors/sql";
import { performWebSearch, performWebSearchStream } from "../webSearch";
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
      const { chunks: webResults } = await performWebSearch(query, 5);
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
          score: res.score,
          citationStart: res.citationStart,
          citationEnd: res.citationEnd
        };
      });
    },
    async webRetrieveWithMetadata(
      query: string,
      allowedDomains?: string[]
    ): Promise<{
      chunks: RetrievedChunk[];
      metadata: { searchQuery?: string; domainsSearched?: string[]; allSources?: string[] };
    }> {
      if (!ENABLE_WEB_SEARCH) return { chunks: [], metadata: {} };
      const { chunks: webResults, metadata } = await performWebSearch(query, 5, allowedDomains);

      const chunks = webResults.map((res, idx) => {
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
          score: res.score,
          citationStart: res.citationStart,
          citationEnd: res.citationEnd
        };
      });

      return { chunks, metadata };
    },
    async webRetrieveWithMetadataStream(
      query: string,
      allowedDomains: string[] | undefined,
      onProgress: (event: { type: string; data?: any }) => void
    ): Promise<{
      chunks: RetrievedChunk[];
      metadata: { searchQuery?: string; domainsSearched?: string[]; allSources?: string[] };
    }> {
      if (!ENABLE_WEB_SEARCH) return { chunks: [], metadata: {} };
      const { chunks: webResults, metadata } = await performWebSearchStream(query, 5, allowedDomains, onProgress);

      const chunks = webResults.map((res, idx) => {
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
          score: res.score,
          citationStart: res.citationStart,
          citationEnd: res.citationEnd
        };
      });

      return { chunks, metadata };
    }
  },
  processing: {
    gradeChunks,
    gradeChunksWithScores,
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
