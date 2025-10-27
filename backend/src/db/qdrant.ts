import { QdrantClient } from "@qdrant/qdrant-js";
import {
  QDRANT_URL,
  QDRANT_API_KEY,
  QDRANT_COLLECTION,
  EMBEDDING_DIMENSIONS,
} from "../config/constants";
import { withRetry } from "../utils/retry";
import { withSpan } from "../config/otel";

// Initialize Qdrant client
export const qdrantClient = new QdrantClient({
  url: QDRANT_URL,
  apiKey: QDRANT_API_KEY || undefined,
});

/**
 * Initialize Qdrant collection with proper schema
 * Creates the collection if it doesn't exist
 */
export async function initQdrantCollection() {
  return await withSpan(
    "qdrant.initCollection",
    async () => {
      try {
        const collections = await qdrantClient.getCollections();
        const exists = collections.collections.some(
          (c) => c.name === QDRANT_COLLECTION
        );

        if (!exists) {
          console.log(`Creating Qdrant collection: ${QDRANT_COLLECTION}`);
          await qdrantClient.createCollection(QDRANT_COLLECTION, {
            vectors: {
              size: EMBEDDING_DIMENSIONS,
              distance: "Cosine",
            },
            optimizers_config: {
              default_segment_number: 2,
            },
            replication_factor: 2,
          });
          console.log(`✓ Created Qdrant collection: ${QDRANT_COLLECTION}`);
        } else {
          console.log(`✓ Qdrant collection exists: ${QDRANT_COLLECTION}`);
        }
      } catch (error) {
        console.error("Failed to initialize Qdrant collection:", error);
        throw error;
      }
    },
    { collection: QDRANT_COLLECTION, url: QDRANT_URL }
  );
}

/**
 * Insert a chunk into Qdrant with retry logic
 * @param chunkId - UUID from Postgres chunks.id (used as shared identifier)
 * @param documentId - UUID from Postgres documents.id
 * @param chunkIndex - Chunk position in document
 * @param content - Text content of the chunk
 * @param embedding - Vector embedding (1536 dimensions for OpenAI)
 * @param source - Source of the document (e.g., filename, URL)
 * @throws Error if insert fails after retries
 */
export async function insertChunkQdrant(
  chunkId: string,
  documentId: string,
  chunkIndex: number,
  content: string,
  embedding: number[],
  source: string | null
): Promise<void> {
  return await withSpan(
    "qdrant.insertChunk",
    async () => {
      await withRetry(
        async () => {
          await qdrantClient.upsert(QDRANT_COLLECTION, {
            wait: true,
            points: [
              {
                id: chunkId, // Use Postgres chunk ID as Qdrant point ID
                vector: embedding,
                payload: {
                  chunk_id: chunkId,
                  document_id: documentId,
                  chunk_index: chunkIndex,
                  content: content,
                  source: source,
                },
              },
            ],
          });
        },
        { maxRetries: 3, initialDelayMs: 200 }
      );
    },
    { collection: QDRANT_COLLECTION, documentId, chunkIndex, contentLength: content.length }
  );
}

/**
 * Vector search in Qdrant
 * @param queryEmbedding - Query vector (1536 dimensions)
 * @param k - Number of results to return
 * @returns Array of results with chunk IDs and scores
 */
export interface QdrantVectorResult {
  chunk_id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  source: string | null;
  score: number;
}

export async function vectorSearchQdrant(
  queryEmbedding: number[],
  k: number
): Promise<QdrantVectorResult[]> {
  return await withSpan(
    "qdrant.search",
    async () => {
      const results = await qdrantClient.search(QDRANT_COLLECTION, {
        vector: queryEmbedding,
        limit: k,
        with_payload: true,
      });

      return results.map((hit) => ({
        chunk_id: hit.payload?.chunk_id as string,
        document_id: hit.payload?.document_id as string,
        chunk_index: hit.payload?.chunk_index as number,
        content: hit.payload?.content as string,
        source: (hit.payload?.source as string) || null,
        score: hit.score,
      }));
    },
    { collection: QDRANT_COLLECTION, k }
  );
}

/**
 * Delete a single chunk from Qdrant by chunk ID
 * Used for rollback when Postgres insert succeeds but Qdrant fails
 * @param chunkId - UUID of the chunk to delete
 */
export async function deleteChunkQdrant(chunkId: string): Promise<void> {
  await withSpan(
    "qdrant.deleteChunk",
    async () => {
      try {
        await qdrantClient.delete(QDRANT_COLLECTION, {
          wait: true,
          points: [chunkId],
        });
      } catch (error) {
        console.error(`Failed to delete chunk ${chunkId} from Qdrant:`, error);
        // Don't throw - this is best-effort cleanup
      }
    },
    { collection: QDRANT_COLLECTION, chunkId }
  );
}

/**
 * Delete all points for a document from Qdrant with retry
 * @param documentId - UUID of the document to delete
 */
export async function deleteDocumentQdrant(documentId: string): Promise<void> {
  return await withSpan(
    "qdrant.deleteDocument",
    async () => {
      await withRetry(
        async () => {
          await qdrantClient.delete(QDRANT_COLLECTION, {
            wait: true,
            filter: {
              must: [
                {
                  key: "document_id",
                  match: {
                    value: documentId,
                  },
                },
              ],
            },
          });
        },
        { maxRetries: 3, initialDelayMs: 200 }
      );
    },
    { collection: QDRANT_COLLECTION, documentId }
  );
}

/**
 * Get collection info and stats
 */
export async function getQdrantStats() {
  return await withSpan(
    "qdrant.getStats",
    async () => {
      const info = await qdrantClient.getCollection(QDRANT_COLLECTION);
      return {
        vectors_count: info.vectors_count,
        points_count: info.points_count,
        status: info.status,
      };
    },
    { collection: QDRANT_COLLECTION }
  );
}
