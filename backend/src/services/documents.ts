/* Layer 4: Data Ingestion */
import { CHUNK_OVERLAP, CHUNK_SIZE, USE_DUAL_VECTOR_STORE } from "../config/constants";
import { embedTexts } from "./embeddings";
import { insertChunk, insertDocument, deleteChunk, deleteDocument } from "../db/sql";
import { insertChunkQdrant, deleteChunkQdrant } from "../db/qdrant";
import { withSpan, addEvent } from "../config/otel";

export interface IngestResult {
  documentId: string;
  chunksInserted: number;
}

export function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(text.length, i + size);
    const chunk = text.slice(i, end);
    chunks.push(chunk);
    if (end === text.length) break;
    i = end - overlap;
    if (i < 0) i = 0;
  }
  return chunks;
}

export async function ingestDocument(
  content: string,
  title: string | null,
  source: string | null
): Promise<IngestResult> {
  return await withSpan(
    "ingest.document",
    async () => {
      const documentId = await insertDocument(title, source);
      const chunks = chunkText(content);
      const embeddings = await embedTexts(chunks);

      const insertedChunkIds: string[] = [];
      let idx = 0;

      try {
        for (const [i, emb] of embeddings.entries()) {
          // Step 1: Insert into Postgres (source of truth)
          const chunkId = await insertChunk(documentId, i, chunks[i], emb);
          insertedChunkIds.push(chunkId);

          // Step 2: Insert into Qdrant if dual-store is enabled
          if (USE_DUAL_VECTOR_STORE) {
            try {
              await insertChunkQdrant(chunkId, documentId, i, chunks[i], emb, source);
            } catch (qdrantError) {
              // Qdrant insert failed - perform compensating delete from Postgres
              console.error(
                `Qdrant insert failed for chunk ${chunkId}, rolling back Postgres insert:`,
                qdrantError
              );
              await deleteChunk(chunkId);

              // Also remove from tracking array
              insertedChunkIds.pop();

              throw new Error(
                `Failed to sync chunk ${i} to Qdrant after retries. Rolled back Postgres insert. Original error: ${
                  (qdrantError as Error).message
                }`
              );
            }
          }

          idx++;
        }

        addEvent("ingest.document.completed", { documentId, chunksInserted: idx });
        return { documentId, chunksInserted: idx } as IngestResult;
      } catch (error) {
        // Cleanup: Delete entire document if any chunk failed
        console.error("Ingestion failed, cleaning up:", error);
        addEvent("ingest.document.failed", { message: (error as Error).message });

        // Delete from Postgres (cascades to chunks)
        await deleteDocument(documentId);

        // Also cleanup any chunks that made it to Qdrant
        if (USE_DUAL_VECTOR_STORE) {
          for (const chunkId of insertedChunkIds) {
            await deleteChunkQdrant(chunkId);
          }
        }

        throw error;
      }
    },
    { titlePresent: !!title, source: source || null, contentLength: content.length }
  );
}
