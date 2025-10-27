// Layer 3: Quality Assurance Agents
import { Grade } from "../../../shared/types";

export interface GradeResult {
  [chunkId: string]: Grade;
}

function tokenize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
}

export function gradeChunks(query: string, chunks: { id: string; content: string }[]): GradeResult {
  const qTokens = new Set(tokenize(query));
  const result: GradeResult = {};
  for (const ch of chunks) {
    const cTokens = new Set(tokenize(ch.content));
    const inter = new Set([...qTokens].filter((t) => cTokens.has(t))).size;
    const ratio = inter / Math.max(1, qTokens.size);
    const grade: Grade = ratio > 0.5 ? "high" : ratio > 0.2 ? "medium" : "low";
    result[ch.id] = grade;
  }
  return result;
}

export function verifyAnswer(answer: string, evidence: { id: string; content: string }[]) {
  // Simple support check: answer tokens must be mostly present in evidence
  const aTokens = tokenize(answer).filter((w) => w.length > 3);
  const evTokens = new Set<string>();
  for (const e of evidence) tokenize(e.content).forEach((t) => evTokens.add(t));
  const present = aTokens.filter((t) => evTokens.has(t));
  const ratio = present.length / Math.max(1, aTokens.length);
  const isValid = ratio >= 0.5;
  const feedback = isValid
    ? "Answer appears supported by evidence."
    : "Insufficient support; consider retrieving again or narrowing the question.";
  return { isValid, feedback };
}
