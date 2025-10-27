/* Layer 5: Embedding */
import { EMBEDDING_DIMENSIONS } from "../config/constants";
import { openaiClient } from "../config/openai";
import { ensureEmbeddingDimensions } from "../db/sql";
import { withSpan } from "../config/otel";

export async function embedText(text: string) {
  return await withSpan(
    "embeddings.embedText",
    async () => {
      const [v] = await openaiClient.embedTexts([text], EMBEDDING_DIMENSIONS);
      ensureEmbeddingDimensions(v);
      return v;
    },
    { inputLength: text.length }
  );
}

export async function embedTexts(texts: string[]) {
  return await withSpan(
    "embeddings.embedTexts",
    async () => {
      const vecs = await openaiClient.embedTexts(texts, EMBEDDING_DIMENSIONS);
      for (const v of vecs) ensureEmbeddingDimensions(v);
      return vecs;
    },
    { batchSize: texts.length }
  );
}
