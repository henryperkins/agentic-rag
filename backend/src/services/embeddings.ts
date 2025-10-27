// Layer 5: Embedding
import { EMBEDDING_DIMENSIONS } from "../config/constants";
import { openaiClient } from "../config/openai";
import { ensureEmbeddingDimensions } from "../db/sql";

export async function embedText(text: string) {
  const [v] = await openaiClient.embedTexts([text], EMBEDDING_DIMENSIONS);
  ensureEmbeddingDimensions(v);
  return v;
}

export async function embedTexts(texts: string[]) {
  const vecs = await openaiClient.embedTexts(texts, EMBEDDING_DIMENSIONS);
  for (const v of vecs) ensureEmbeddingDimensions(v);
  return vecs;
}
