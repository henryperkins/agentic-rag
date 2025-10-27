// Layer 3: Quality Assurance Agents
import { Grade } from "../../../shared/types";
import { embedText } from "./embeddings";
import {
  USE_SEMANTIC_GRADING,
  GRADE_HIGH_THRESHOLD,
  GRADE_MEDIUM_THRESHOLD,
  MIN_TECHNICAL_TERM_LENGTH,
  VERIFICATION_THRESHOLD
} from "../config/constants";

export interface GradeResult {
  [chunkId: string]: Grade;
}

export interface GradeMetadata {
  scores: { [chunkId: string]: number };
  method: "semantic" | "keyword" | "hybrid";
}

// Technical terms that should not be filtered despite being short
const TECHNICAL_TERMS = new Set([
  "ai", "ml", "api", "cpu", "gpu", "sql", "aws", "gcp", "iot", "nlp",
  "llm", "ram", "ssd", "hdd", "dns", "url", "uri", "jwt", "oauth", "ssh",
  "tls", "ssl", "http", "tcp", "udp", "ip", "os", "ide", "sdk", "ui", "ux"
]);

function tokenize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
}

/**
 * Compute cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Keyword-based grading using token overlap
 */
function gradeChunksKeyword(query: string, chunks: { id: string; content: string }[]): GradeMetadata {
  const qTokens = new Set(tokenize(query));
  const scores: { [chunkId: string]: number } = {};

  for (const ch of chunks) {
    const cTokens = new Set(tokenize(ch.content));
    const inter = new Set([...qTokens].filter((t) => cTokens.has(t))).size;
    const ratio = inter / Math.max(1, qTokens.size);
    scores[ch.id] = ratio;
  }

  return { scores, method: "keyword" };
}

/**
 * Semantic grading using embedding similarity
 */
async function gradeChunksSemantic(
  query: string,
  queryEmbedding: number[],
  chunks: { id: string; content: string }[]
): Promise<GradeMetadata> {
  const scores: { [chunkId: string]: number } = {};

  // Embed all chunks in parallel
  const chunkEmbeddings = await Promise.all(
    chunks.map((ch) => embedText(ch.content))
  );

  // Compute cosine similarity for each chunk
  for (let i = 0; i < chunks.length; i++) {
    const similarity = cosineSimilarity(queryEmbedding, chunkEmbeddings[i]);
    scores[chunks[i].id] = similarity;
  }

  return { scores, method: "semantic" };
}

/**
 * Hybrid grading: 0.7 * semantic + 0.3 * keyword
 */
async function gradeChunksHybrid(
  query: string,
  queryEmbedding: number[],
  chunks: { id: string; content: string }[]
): Promise<GradeMetadata> {
  const semantic = await gradeChunksSemantic(query, queryEmbedding, chunks);
  const keyword = gradeChunksKeyword(query, chunks);

  const scores: { [chunkId: string]: number } = {};
  for (const ch of chunks) {
    scores[ch.id] = 0.7 * semantic.scores[ch.id] + 0.3 * keyword.scores[ch.id];
  }

  return { scores, method: "hybrid" };
}

/**
 * Grade chunks based on relevance to query
 * Returns both grades and metadata about scoring
 */
export async function gradeChunks(
  query: string,
  chunks: { id: string; content: string }[],
  queryEmbedding?: number[]
): Promise<GradeResult> {
  let metadata: GradeMetadata;

  if (USE_SEMANTIC_GRADING && queryEmbedding) {
    // Use hybrid semantic + keyword grading
    metadata = await gradeChunksHybrid(query, queryEmbedding, chunks);
  } else if (queryEmbedding) {
    // Use semantic only if embedding provided but flag not set
    metadata = await gradeChunksSemantic(query, queryEmbedding, chunks);
  } else {
    // Fallback to keyword-based grading
    metadata = gradeChunksKeyword(query, chunks);
  }

  // Convert scores to grades
  const result: GradeResult = {};
  for (const ch of chunks) {
    const score = metadata.scores[ch.id];
    const grade: Grade =
      score > GRADE_HIGH_THRESHOLD ? "high" :
      score > GRADE_MEDIUM_THRESHOLD ? "medium" : "low";
    result[ch.id] = grade;
  }

  return result;
}

/**
 * Enhanced version that returns both grades and scores
 */
export async function gradeChunksWithScores(
  query: string,
  chunks: { id: string; content: string }[],
  queryEmbedding?: number[]
): Promise<{ grades: GradeResult; metadata: GradeMetadata }> {
  let metadata: GradeMetadata;

  if (USE_SEMANTIC_GRADING && queryEmbedding) {
    metadata = await gradeChunksHybrid(query, queryEmbedding, chunks);
  } else if (queryEmbedding) {
    metadata = await gradeChunksSemantic(query, queryEmbedding, chunks);
  } else {
    metadata = gradeChunksKeyword(query, chunks);
  }

  const grades: GradeResult = {};
  for (const ch of chunks) {
    const score = metadata.scores[ch.id];
    const grade: Grade =
      score > GRADE_HIGH_THRESHOLD ? "high" :
      score > GRADE_MEDIUM_THRESHOLD ? "medium" : "low";
    grades[ch.id] = grade;
  }

  return { grades, metadata };
}

/**
 * Verify answer against evidence with configurable threshold
 * Now includes technical terms and provides confidence score
 */
export function verifyAnswer(
  answer: string,
  evidence: { id: string; content: string }[]
): { isValid: boolean; feedback: string; confidence: number } {
  // Tokenize answer, filtering by length or technical term whitelist
  const aTokens = tokenize(answer).filter(
    (w) => w.length >= MIN_TECHNICAL_TERM_LENGTH || TECHNICAL_TERMS.has(w)
  );

  // Build evidence token set
  const evTokens = new Set<string>();
  for (const e of evidence) {
    tokenize(e.content).forEach((t) => evTokens.add(t));
  }

  // Count present tokens
  const present = aTokens.filter((t) => evTokens.has(t));
  const ratio = present.length / Math.max(1, aTokens.length);
  const isValid = ratio >= VERIFICATION_THRESHOLD;

  // Provide more detailed feedback based on confidence
  let feedback: string;
  if (ratio >= 0.8) {
    feedback = `Answer is strongly supported by evidence (${Math.round(ratio * 100)}% token overlap).`;
  } else if (ratio >= VERIFICATION_THRESHOLD) {
    feedback = `Answer appears supported by evidence (${Math.round(ratio * 100)}% token overlap).`;
  } else if (ratio >= VERIFICATION_THRESHOLD * 0.7) {
    feedback = `Answer has moderate support (${Math.round(ratio * 100)}% overlap). Consider refining.`;
  } else {
    feedback = `Insufficient support (${Math.round(ratio * 100)}% overlap). Consider retrieving again or narrowing the question.`;
  }

  return { isValid, feedback, confidence: ratio };
}
