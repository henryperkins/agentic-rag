import * as dotenv from "dotenv";
dotenv.config();

export const env = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  DATABASE_URL:
    process.env.DATABASE_URL || "postgresql://rag:rag@localhost:5432/ragchat",
  CORS_ORIGIN: process.env.CORS_ORIGIN || "http://localhost:5173",

  QDRANT_URL: process.env.QDRANT_URL || "http://localhost:6333",
  QDRANT_API_KEY: process.env.QDRANT_API_KEY || "",
  QDRANT_COLLECTION: process.env.QDRANT_COLLECTION || "chunks",

  EMBEDDING_MODEL:
    process.env.EMBEDDING_MODEL || "text-embedding-3-small",
  EMBEDDING_DIMENSIONS: Number(process.env.EMBEDDING_DIMENSIONS || 1536),
  CHAT_MODEL: process.env.CHAT_MODEL || "gpt-4o-mini",
  RERANKER_MODEL: process.env.RERANKER_MODEL || "BAAI/bge-reranker-base",

  HYBRID_VECTOR_WEIGHT: Number(process.env.HYBRID_VECTOR_WEIGHT || 0.7),
  HYBRID_KEYWORD_WEIGHT: Number(process.env.HYBRID_KEYWORD_WEIGHT || 0.3),
  RAG_TOP_K: Number(process.env.RAG_TOP_K || 5),
  USE_DUAL_VECTOR_STORE: process.env.USE_DUAL_VECTOR_STORE === "true",

  CHUNK_SIZE: Number(process.env.CHUNK_SIZE || 1000),
  CHUNK_OVERLAP: Number(process.env.CHUNK_OVERLAP || 100),

  MAX_AGENT_STEPS: Number(process.env.MAX_AGENT_STEPS || 3),
  MAX_VERIFICATION_LOOPS: Number(process.env.MAX_VERIFICATION_LOOPS || 2),

  MOCK_OPENAI: Number(process.env.MOCK_OPENAI || 0),

  ENABLE_SQL_AGENT: process.env.ENABLE_SQL_AGENT === "true",
  SQL_AGENT_MAX_ROWS: Number(process.env.SQL_AGENT_MAX_ROWS || 50),
  SQL_AGENT_TIMEOUT_MS: Number(process.env.SQL_AGENT_TIMEOUT_MS || 400),
  SQL_AGENT_MAX_COST: Number(process.env.SQL_AGENT_MAX_COST || 1000),
  SQL_AGENT_ALLOWLIST:
    process.env.SQL_AGENT_ALLOWLIST || "documents,chunks,query_rewrites",
  SQL_AGENT_MAX_JOIN_DEPTH: Number(process.env.SQL_AGENT_MAX_JOIN_DEPTH || 2),
  SQL_AGENT_ALLOWED_FUNCS:
    process.env.SQL_AGENT_ALLOWED_FUNCS || "count,sum,avg,min,max",

  PORT: Number(process.env.PORT_BACKEND || 8787),

  ENABLE_WEB_SEARCH: process.env.ENABLE_WEB_SEARCH === "true",
  WEB_SEARCH_CITY: process.env.WEB_SEARCH_CITY || "",
  WEB_SEARCH_REGION: process.env.WEB_SEARCH_REGION || "",
  WEB_SEARCH_COUNTRY: process.env.WEB_SEARCH_COUNTRY || "",
  WEB_SEARCH_TIMEZONE: process.env.WEB_SEARCH_TIMEZONE || "",
  WEB_SEARCH_CONTEXT_SIZE:
    (process.env.WEB_SEARCH_CONTEXT_SIZE as "low" | "medium" | "high") || "medium",
  WEB_SEARCH_CONCURRENT_REQUESTS: Number(process.env.WEB_SEARCH_CONCURRENT_REQUESTS || 3),
  WEB_SEARCH_FAILURE_THROTTLE_MS: Number(process.env.WEB_SEARCH_FAILURE_THROTTLE_MS || 5000),
  WEB_SEARCH_ALLOWED_DOMAINS: process.env.WEB_SEARCH_ALLOWED_DOMAINS || "",

  USE_LLM_CLASSIFIER: process.env.USE_LLM_CLASSIFIER === "true",

  // Grading and Verification Configuration
  USE_SEMANTIC_GRADING: process.env.USE_SEMANTIC_GRADING === "true",
  GRADE_HIGH_THRESHOLD: Number(process.env.GRADE_HIGH_THRESHOLD || 0.5),
  GRADE_MEDIUM_THRESHOLD: Number(process.env.GRADE_MEDIUM_THRESHOLD || 0.2),
  VERIFICATION_THRESHOLD: Number(process.env.VERIFICATION_THRESHOLD || 0.5),
  MIN_TECHNICAL_TERM_LENGTH: Number(process.env.MIN_TECHNICAL_TERM_LENGTH || 2),

  // Fallback Configuration
  ENABLE_QUERY_REWRITING: process.env.ENABLE_QUERY_REWRITING === "true",
  ALLOW_LOW_GRADE_FALLBACK: process.env.ALLOW_LOW_GRADE_FALLBACK === "true",
  CACHE_FAILURES: process.env.CACHE_FAILURES === "true"
};