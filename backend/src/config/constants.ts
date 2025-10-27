import { env } from "./env";

export const PROJECT_NAME = "rag-chat";
export const PORT_BACKEND = env.PORT;

export const QDRANT_URL = env.QDRANT_URL;
export const QDRANT_API_KEY = env.QDRANT_API_KEY;
export const QDRANT_COLLECTION = env.QDRANT_COLLECTION;

export const EMBEDDING_MODEL = env.EMBEDDING_MODEL;
export const EMBEDDING_DIMENSIONS = env.EMBEDDING_DIMENSIONS;
export const CHAT_MODEL = env.CHAT_MODEL;
export const RERANKER_MODEL = env.RERANKER_MODEL;

export const HYBRID_VECTOR_WEIGHT = env.HYBRID_VECTOR_WEIGHT;
export const HYBRID_KEYWORD_WEIGHT = env.HYBRID_KEYWORD_WEIGHT;
export const RAG_TOP_K = env.RAG_TOP_K;
export const USE_DUAL_VECTOR_STORE = env.USE_DUAL_VECTOR_STORE;

export const CHUNK_SIZE = env.CHUNK_SIZE;
export const CHUNK_OVERLAP = env.CHUNK_OVERLAP;

export const MAX_AGENT_STEPS = env.MAX_AGENT_STEPS;
export const MAX_VERIFICATION_LOOPS = env.MAX_VERIFICATION_LOOPS;

export const MOCK_OPENAI = !!env.MOCK_OPENAI;

export const ENABLE_SQL_AGENT = env.ENABLE_SQL_AGENT;
export const SQL_AGENT_MAX_ROWS = env.SQL_AGENT_MAX_ROWS;
export const SQL_AGENT_TIMEOUT_MS = env.SQL_AGENT_TIMEOUT_MS;
export const SQL_AGENT_ALLOWLIST = env.SQL_AGENT_ALLOWLIST.split(",")
  .map((t: string) => t.trim())
  .filter((t: string) => Boolean(t));
export const SQL_AGENT_MAX_JOIN_DEPTH = env.SQL_AGENT_MAX_JOIN_DEPTH;
export const SQL_AGENT_ALLOWED_FUNCS = env.SQL_AGENT_ALLOWED_FUNCS.split(",")
  .map((t: string) => t.trim().toLowerCase())
  .filter((t: string) => Boolean(t));

export const ENABLE_WEB_SEARCH = env.ENABLE_WEB_SEARCH;
export const WEB_SEARCH_CONTEXT_SIZE = (["low", "medium", "high"].includes(
  env.WEB_SEARCH_CONTEXT_SIZE
) ? env.WEB_SEARCH_CONTEXT_SIZE : "medium") as "low" | "medium" | "high";
export const WEB_SEARCH_LOCATION = env.WEB_SEARCH_CITY ||
  env.WEB_SEARCH_REGION ||
  env.WEB_SEARCH_COUNTRY ||
  env.WEB_SEARCH_TIMEZONE
  ? {
      city: env.WEB_SEARCH_CITY || undefined,
      region: env.WEB_SEARCH_REGION || undefined,
      country: env.WEB_SEARCH_COUNTRY || undefined,
      timezone: env.WEB_SEARCH_TIMEZONE || undefined
    }
  : null;
export const WEB_SEARCH_ALLOWED_DOMAINS = env.WEB_SEARCH_ALLOWED_DOMAINS
  .split(",")
  .map((d: string) => d.trim())
  .filter((d: string) => Boolean(d));

export const USE_LLM_CLASSIFIER = env.USE_LLM_CLASSIFIER;

// Grading and Verification Configuration
export const USE_SEMANTIC_GRADING = env.USE_SEMANTIC_GRADING;
export const GRADE_HIGH_THRESHOLD = env.GRADE_HIGH_THRESHOLD;
export const GRADE_MEDIUM_THRESHOLD = env.GRADE_MEDIUM_THRESHOLD;
export const VERIFICATION_THRESHOLD = env.VERIFICATION_THRESHOLD;
export const MIN_TECHNICAL_TERM_LENGTH = env.MIN_TECHNICAL_TERM_LENGTH;

// Fallback Configuration
export const ENABLE_QUERY_REWRITING = env.ENABLE_QUERY_REWRITING;
export const ALLOW_LOW_GRADE_FALLBACK = env.ALLOW_LOW_GRADE_FALLBACK;
export const CACHE_FAILURES = env.CACHE_FAILURES;
