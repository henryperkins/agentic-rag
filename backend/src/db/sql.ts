import { EMBEDDING_DIMENSIONS } from "../config/constants";
import { query } from "./client";
import { withSpan } from "../config/otel";

export async function insertDocument(title: string | null, source: string | null) {
  return await withSpan(
    "db.insertDocument",
    async () => {
      const { rows } = await query<{ id: string }>(
        "INSERT INTO documents (title, source) VALUES ($1, $2) RETURNING id",
        [title, source]
      );
      return rows[0].id;
    },
    { hasTitle: !!title, hasSource: !!source }
  );
}

export async function insertChunk(
  documentId: string,
  chunkIndex: number,
  content: string,
  embedding: number[]
) {
  return await withSpan(
    "db.insertChunk",
    async () => {
      const { rows } = await query<{ id: string }>(
        "INSERT INTO chunks (document_id, chunk_index, content, embedding) VALUES ($1, $2, $3, $4::vector) RETURNING id",
        [documentId, chunkIndex, content, `[${embedding.join(",")}]`]
      );
      return rows[0].id;
    },
    { documentId, chunkIndex, contentLength: content.length }
  );
}

export async function listDocuments() {
  return await withSpan("db.listDocuments", async () => {
    const { rows } = await query(
      "SELECT id, title, source, created_at FROM documents ORDER BY created_at DESC"
    );
    return rows;
  });
}

export async function deleteDocument(id: string) {
  await withSpan("db.deleteDocument", () => query("DELETE FROM documents WHERE id = $1", [id]), {
    id,
  });
}
export async function getChunksForDocument(documentId: string) {
  return await withSpan("db.getChunksForDocument", async () => {
    const { rows } = await query(
      "SELECT chunk_index, content FROM chunks WHERE document_id = $1 ORDER BY chunk_index",
      [documentId]
    );
    return rows as { chunk_index: number; content: string }[];
  });
}


export async function deleteChunk(id: string) {
  await withSpan("db.deleteChunk", () => query("DELETE FROM chunks WHERE id = $1", [id]), { id });
}

export async function insertRewrite(original: string, rewritten: string) {
  await withSpan(
    "db.insertRewrite",
    () =>
      query(
        "INSERT INTO query_rewrites (original_query, rewritten_query) VALUES ($1, $2)",
        [original, rewritten]
      ),
    { originalLength: original.length, rewrittenLength: rewritten.length }
  );
}

export function buildVectorSearchSQL(k: number) {
  return `
    SELECT c.id, c.document_id, c.chunk_index, c.content, d.source,
           (1 - (c.embedding <=> $1::vector)) AS vector_sim
    FROM chunks c
    JOIN documents d ON c.document_id = d.id
    ORDER BY c.embedding <=> $1::vector ASC
    LIMIT ${k}
  `;
}

export function buildTrigramTitleSQL(k: number) {
  return `
    SELECT d.id AS document_id, d.title, d.source, similarity(d.title, $1) AS trigram_sim
    FROM documents d
    WHERE d.title % $1
    ORDER BY similarity(d.title, $1) DESC
    LIMIT ${k}
  `;
}

export async function vectorSearch(qEmbedding: number[], k: number) {
  return await withSpan(
    "db.vectorSearch",
    async () => {
      const sql = buildVectorSearchSQL(k);
      const { rows } = await query(sql, [`[${qEmbedding.join(",")}]`]);
      return rows as {
        id: string;
        document_id: string;
        chunk_index: number;
        content: string;
        source: string | null;
        vector_sim: number;
      }[];
    },
    { k }
  );
}

export async function trigramTitleSearch(queryText: string, k: number) {
  return await withSpan(
    "db.trigramTitleSearch",
    async () => {
      const sql = buildTrigramTitleSQL(k);
      const { rows } = await query(sql, [queryText]);
      return rows as {
        document_id: string;
        title: string | null;
        source: string | null;
        trigram_sim: number;
      }[];
    },
    { k, queryLength: queryText.length }
  );
}

export async function chunksByDocumentIds(docIds: string[], limitPerDoc = 2) {
  return await withSpan(
    "db.chunksByDocumentIds",
    async () => {
      if (docIds.length === 0) return [];
      const params = docIds.map((_, i) => `$${i + 1}`).join(",");
      const sql = `
    SELECT c.id, c.document_id, c.chunk_index, c.content, d.source
    FROM chunks c
    JOIN documents d ON c.document_id = d.id
    WHERE c.document_id IN (${params})
    ORDER BY c.document_id, c.chunk_index
  `;
      const { rows } = await query(sql, docIds);
      const grouped = new Map<string, any[]>();
      for (const r of rows) {
        if (!grouped.has(r.document_id)) grouped.set(r.document_id, []);
        if (grouped.get(r.document_id)!.length < limitPerDoc) {
          grouped.get(r.document_id)!.push(r);
        }
      }
      return Array.from(grouped.values()).flat();
    },
    { docIdCount: docIds.length, limitPerDoc }
  );
}

export function ensureEmbeddingDimensions(vec: number[]) {
  if (vec.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding dimension mismatch: expected ${EMBEDDING_DIMENSIONS}, got ${vec.length}`
    );
  }
}
