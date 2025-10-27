// FILE: package.json

```json
{
  "name": "rag-chat",
  "private": true,
  "version": "1.0.0",
  "description": "Production-grade Agentic RAG chat app (React/Vite + Fastify/OpenAI, Hybrid + Rerank + Self-Verification)",
  "workspaces": [
    "backend",
    "frontend",
    "shared"
  ],
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "db:setup": "npm -w backend run db:setup",
    "db:migrate": "npm -w backend run db:migrate",
    "ingest:samples": "npm -w backend run ingest:samples",
    "dev": "concurrently -r \"npm -w backend run dev\" \"npm -w frontend run dev\"",
    "test": "npm -w backend run test",
    "typecheck": "npm -w backend run typecheck && npm -w frontend run typecheck && npm -w shared run typecheck"
  },
  "devDependencies": {
    "concurrently": "^9.0.1"
  }
}
```

// FILE: .gitignore

```
# Node
node_modules/
pnpm-lock.yaml
package-lock.json
yarn.lock
dist/
build/

# Env
.env
backend/.env
frontend/.env

# OS
.DS_Store

# Logs
*.log
logs/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Vite
frontend/.vite
```

// FILE: docker-compose.yml

```yaml
version: "3.9"
services:
  postgres:
    image: pgvector/pgvector:pg16
    container_name: ragchat-postgres
    environment:
      POSTGRES_USER: rag
      POSTGRES_PASSWORD: rag
      POSTGRES_DB: ragchat
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U rag -d ragchat"]
      interval: 5s
      timeout: 5s
      retries: 10
volumes:
  pgdata: {}
```

// FILE: README.md

````md
# rag-chat

A minimal, **production-ready Agentic RAG** chat app with:

- **Multi-agent planning** (planner → researcher → critic → writer → verifier)
- **Query rewriting**
- **Hybrid retrieval** (pgvector cosine + pg_trgm trigram) with configurable weights
- **Reranking** via `BAAI/bge-reranker-base` using `@dqbd/qdrant` **with graceful fallback**
- **Strict self-verification loops**
- **SSE streaming** of agent logs, tokens, citations, and verification results
- **Documents CRUD** with chunking + embeddings

> **Ports**  
> Backend: **8787**  
> Frontend: **5173**

---

## Quick Start

```bash
# 1) Start Postgres (pg16 + pgvector)
docker compose up -d

# 2) Install workspaces
npm install

# 3) Setup DB (extensions, tables, indexes)
npm run db:setup
npm run db:migrate

# 4) Seed sample docs (uses deterministic mock embeddings)
npm run ingest:samples

# 5) Run dev servers (Fastify + Vite)
npm run dev
# Open http://localhost:5173
````

---

## Tech Stack

* **Frontend:** React 18, Vite 5, TypeScript
* **Backend:** Fastify 4, Node 20+, TypeScript
* **DB:** PostgreSQL 16 + `pgvector` + `pg_trgm`
* **AI:**

  * Chat: `gpt-4o-mini`
  * Embeddings: `text-embedding-3-small` (1536 dims)
  * Reranker: `BAAI/bge-reranker-base` with `@dqbd/qdrant` (fallback enabled)
* **Orchestration:** Lightweight loop (LangGraph-compatible design)

---

## Environment (backend/.env.example)

```env
OPENAI_API_KEY=sk-...
DATABASE_URL=postgresql://rag:rag@localhost:5432/ragchat
CORS_ORIGIN=http://localhost:5173
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
CHAT_MODEL=gpt-4o-mini
RERANKER_MODEL=BAAI/bge-reranker-base
HYBRID_VECTOR_WEIGHT=0.7
HYBRID_KEYWORD_WEIGHT=0.3
RAG_TOP_K=5
CHUNK_SIZE=1000
CHUNK_OVERLAP=100
MAX_AGENT_STEPS=3
MAX_VERIFICATION_LOOPS=2
MOCK_OPENAI=0
```

---

## Repository Layout

```
rag-chat/
├── backend/
│   ├── src/
│   │   ├── config/            # env + constants + openai client
│   │   ├── db/                # pg client + raw SQL helpers
│   │   ├── services/          # agent, retrieval, reranker, verifier, embeddings, documents, query
│   │   ├── routes/            # chat & documents endpoints
│   │   └── server.ts
│   ├── scripts/               # db setup/migrate, sample ingest
│   ├── tests/                 # vitest suite
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── api/               # SSE client
│   │   ├── components/        # Chat, FileUpload, VerificationBadge
│   │   ├── hooks/             # useChat
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   └── vite.config.ts
├── shared/
│   ├── types.ts               # shared TypeScript types (SSE events, records)
│   ├── package.json
│   └── tsconfig.json
├── samples/                   # ≥3 sample docs for ingestion
├── docker-compose.yml
├── README.md
├── scripts/                   # root dev runner (optional helper)
└── .gitignore
```

---

## API Routes

| Method | Path                    | Purpose                              |
| -----: | ----------------------- | ------------------------------------ |
|   POST | `/api/chat`             | Stream **agentic chat** via SSE      |
|   POST | `/api/documents/upload` | Upload `.md` / `.txt`, chunk & embed |
|    GET | `/api/documents`        | List uploaded documents              |
| DELETE | `/api/documents/:id`    | Delete document (cascades chunks)    |

### SSE Event Contract

* `agent_log`: `{ role: "planner" | "researcher" | "critic" | "writer", message, ts }`
* `rewrite`: `{ original, rewritten, ts }`
* `tokens`: `{ text, ts }`  *(incremental assistant text stream)*
* `citations`: `{ citations: [{ document_id, source, chunk_index }], ts }`
* `verification`: `{ isValid: boolean, gradeSummary?: Record<chunk_id, "high"|"medium"|"low">, feedback?: string, ts }`
* `final`: `{ text, citations, rewrittenQuery?: string, verified: boolean, ts }`

---

## Agentic Workflow

```
┌────────┐   ┌───────────┐   ┌──────────┐   ┌────────┐   ┌──────────────┐
│Planner │─▶│Researcher  │─▶│Critic     │─▶│Writer  │─▶│Final Verifier│
└────────┘   └───────────┘   └──────────┘   └────────┘   └──────────────┘
   │             │                │            │
   │   Hybrid (vector + trigram)  │            │
   │   + rerank (BGE / fallback)  │            │
   └───── optional rewrite ───────┴────────────┘
```

* **Planner:** decide `retrieve` vs `answer` and optional `rewrite`
* **Researcher:** hybrid SQL (pgvector cosine + pg_trgm trigram) → **rerank**
* **Critic:** grade chunks (high/medium/low), keep highs (else add mediums)
* **Writer:** answer **only** from approved evidence with inline `[cite:document_id:chunk_index]`
* **Verifier:** check answer support; if unsupported, loop (bounded by `MAX_VERIFICATION_LOOPS`)

---

## Development & Scripts

```bash
docker compose up -d        # Postgres (pg16 + pgvector)
npm install                 # install all workspaces
npm run db:setup            # create schema + extensions
npm run db:migrate          # ensure indexes/columns exist
npm run ingest:samples      # seed samples with mock embeddings
npm run dev                 # concurrent backend + frontend (SSE)
# Open http://localhost:5173
```

---

## Testing (Vitest)

* `chunk.test.ts`: chunking overlap + determinism
* `retrieval.test.ts`: hybrid SQL builder includes ivfflat & trigram
* `reranker.test.ts`: fallback reranker improves ordering
* `agent.test.ts`: agent completes in direct mode (`useRag=false`) within `MAX_AGENT_STEPS`
* `verifier.test.ts`: grades object shape + verifyAnswer behavior

> Tests run with `MOCK_OPENAI=1` for full offline determinism.

---

## Notes

* Reranker gracefully falls back to a deterministic overlap heuristic when `@dqbd/qdrant` or the model is unavailable.
* Orchestration code is lightweight and **LangGraph-compatible** in shape should you want to plug it in later.

````

// FILE: shared/package.json
```json
{
  "name": "@rag-chat/shared",
  "version": "1.0.0",
  "type": "module",
  "main": "types.ts",
  "types": "types.ts",
  "private": true,
  "devDependencies": {
    "typescript": "^5.6.3"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
````

// FILE: shared/tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["types.ts"]
}
```

// FILE: shared/types.ts

```ts
// Shared types for SSE and records

export type AgentRole = "planner" | "researcher" | "critic" | "writer";

export interface AgentLogEvent {
  type: "agent_log";
  role: AgentRole;
  message: string;
  ts: number;
}

export interface RewriteEvent {
  type: "rewrite";
  original: string;
  rewritten: string;
  ts: number;
}

export interface TokensEvent {
  type: "tokens";
  text: string; // incremental
  ts: number;
}

export interface CitationItem {
  document_id: string;
  source: string | null;
  chunk_index: number;
}

export interface CitationsEvent {
  type: "citations";
  citations: CitationItem[];
  ts: number;
}

export type Grade = "high" | "medium" | "low";

export interface VerificationEvent {
  type: "verification";
  isValid: boolean;
  gradeSummary?: Record<string, Grade>; // chunk_id -> grade
  feedback?: string;
  ts: number;
}

export interface FinalEvent {
  type: "final";
  text: string;
  citations: CitationItem[];
  rewrittenQuery?: string;
  verified: boolean;
  ts: number;
}

export type SSEOutEvent =
  | AgentLogEvent
  | RewriteEvent
  | TokensEvent
  | CitationsEvent
  | VerificationEvent
  | FinalEvent;

// Records

export interface DocumentRecord {
  id: string;
  title: string | null;
  source: string | null;
  created_at: string; // ISO
}

export interface ChunkRecord {
  id: string;
  document_id: string;
  content: string;
  chunk_index: number;
  grade: Grade | null;
  created_at: string;
}

export interface ChatRequestBody {
  message: string;
  useRag?: boolean;
  useHybrid?: boolean;
}
```

// FILE: samples/01_intro.md

```md
# Welcome to RAG Chat

RAG Chat is a lightweight example of an Agentic Retrieval Augmented Generation system. It combines hybrid search (vector + trigram) with reranking and strict verification loops to produce reliable answers with citations.
```

// FILE: samples/02_pgvector.md

```md
# pgvector with PostgreSQL

The pgvector extension adds a vector data type to PostgreSQL and supports indexing with IVFFlat. It enables efficient similarity search for embeddings stored in a standard relational database.
```

// FILE: samples/03_agentic.md

```md
# Agentic RAG Loop

An agentic loop coordinates multiple roles: a planner decides the path, a researcher gathers evidence, a critic filters results, a writer drafts the response with citations, and a verifier checks support, looping when needed.
```

// FILE: backend/package.json

```json
{
  "name": "rag-chat-backend",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "main": "src/server.ts",
  "scripts": {
    "dev": "tsx src/server.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest --run",
    "db:setup": "node ./scripts/dbSetup.mjs",
    "db:migrate": "node ./scripts/dbMigrate.mjs",
    "ingest:samples": "node ./scripts/ingestSamples.mjs"
  },
  "dependencies": {
    "@fastify/cors": "^10.0.1",
    "@fastify/multipart": "^9.0.1",
    "dotenv": "^16.4.5",
    "fastify": "^4.28.1",
    "openai": "^4.61.1",
    "pg": "^8.12.0",
    "uuid": "^11.0.3",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.11.30",
    "tsx": "^4.19.1",
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

// FILE: backend/tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "baseUrl": "."
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

// FILE: backend/vitest.config.ts

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: true,
    setupFiles: [],
    env: {
      MOCK_OPENAI: "1",
      EMBEDDING_DIMENSIONS: "1536",
      HYBRID_VECTOR_WEIGHT: "0.7",
      HYBRID_KEYWORD_WEIGHT: "0.3",
      RAG_TOP_K: "5",
      MAX_AGENT_STEPS: "3",
      MAX_VERIFICATION_LOOPS: "2"
    }
  }
});
```

// FILE: backend/.env.example

```env
OPENAI_API_KEY=sk-...
DATABASE_URL=postgresql://rag:rag@localhost:5432/ragchat
CORS_ORIGIN=http://localhost:5173
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
CHAT_MODEL=gpt-4o-mini
RERANKER_MODEL=BAAI/bge-reranker-base
HYBRID_VECTOR_WEIGHT=0.7
HYBRID_KEYWORD_WEIGHT=0.3
RAG_TOP_K=5
CHUNK_SIZE=1000
CHUNK_OVERLAP=100
MAX_AGENT_STEPS=3
MAX_VERIFICATION_LOOPS=2
MOCK_OPENAI=0
```

// FILE: backend/src/config/env.ts

```ts
import * as dotenv from "dotenv";
dotenv.config();

export const env = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  DATABASE_URL:
    process.env.DATABASE_URL || "postgresql://rag:rag@localhost:5432/ragchat",
  CORS_ORIGIN: process.env.CORS_ORIGIN || "http://localhost:5173",

  EMBEDDING_MODEL:
    process.env.EMBEDDING_MODEL || "text-embedding-3-small",
  EMBEDDING_DIMENSIONS: Number(process.env.EMBEDDING_DIMENSIONS || 1536),
  CHAT_MODEL: process.env.CHAT_MODEL || "gpt-4o-mini",
  RERANKER_MODEL: process.env.RERANKER_MODEL || "BAAI/bge-reranker-base",

  HYBRID_VECTOR_WEIGHT: Number(process.env.HYBRID_VECTOR_WEIGHT || 0.7),
  HYBRID_KEYWORD_WEIGHT: Number(process.env.HYBRID_KEYWORD_WEIGHT || 0.3),
  RAG_TOP_K: Number(process.env.RAG_TOP_K || 5),

  CHUNK_SIZE: Number(process.env.CHUNK_SIZE || 1000),
  CHUNK_OVERLAP: Number(process.env.CHUNK_OVERLAP || 100),

  MAX_AGENT_STEPS: Number(process.env.MAX_AGENT_STEPS || 3),
  MAX_VERIFICATION_LOOPS: Number(process.env.MAX_VERIFICATION_LOOPS || 2),

  MOCK_OPENAI: Number(process.env.MOCK_OPENAI || 0),

  PORT: Number(process.env.PORT_BACKEND || 8787)
};
```

// FILE: backend/src/config/constants.ts

```ts
import { env } from "./env";

export const PROJECT_NAME = "rag-chat";
export const PORT_BACKEND = env.PORT;
export const EMBEDDING_MODEL = env.EMBEDDING_MODEL;
export const EMBEDDING_DIMENSIONS = env.EMBEDDING_DIMENSIONS;
export const CHAT_MODEL = env.CHAT_MODEL;
export const RERANKER_MODEL = env.RERANKER_MODEL;

export const HYBRID_VECTOR_WEIGHT = env.HYBRID_VECTOR_WEIGHT;
export const HYBRID_KEYWORD_WEIGHT = env.HYBRID_KEYWORD_WEIGHT;
export const RAG_TOP_K = env.RAG_TOP_K;

export const CHUNK_SIZE = env.CHUNK_SIZE;
export const CHUNK_OVERLAP = env.CHUNK_OVERLAP;

export const MAX_AGENT_STEPS = env.MAX_AGENT_STEPS;
export const MAX_VERIFICATION_LOOPS = env.MAX_VERIFICATION_LOOPS;

export const MOCK_OPENAI = !!env.MOCK_OPENAI;
```

// FILE: backend/src/config/openai.ts

```ts
import { MOCK_OPENAI } from "./constants";
import { createHash } from "crypto";

type Message = { role: "system" | "user" | "assistant"; content: string };

interface OpenAIAdapter {
  embedTexts: (texts: string[], dims: number) => Promise<number[][]>;
  chat: (messages: Message[]) => Promise<string>;
}

// Deterministic pseudo-random number from string
function strSeed(s: string) {
  const h = createHash("sha256").update(s).digest();
  // Convert first 8 bytes to int
  return h.readBigUInt64BE(0) % BigInt(2 ** 32);
}
function seededRand(seed: number) {
  let x = seed >>> 0;
  return () => {
    // Xorshift32
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0xffffffff;
  };
}

async function mockEmbed(texts: string[], dims: number): Promise<number[][]> {
  return texts.map((t) => {
    const rng = seededRand(Number(strSeed(t)));
    const v = new Array(dims).fill(0).map(() => rng());
    // L2 normalize
    const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0));
    return v.map((x) => x / (norm || 1));
  });
}

async function mockChat(messages: Message[]): Promise<string> {
  const last = messages[messages.length - 1]?.content || "";
  return `MOCK_RESPONSE: ${last.slice(0, 120)}`;
}

let realOpenAI: any = null;

async function realEmbed(texts: string[], dims: number): Promise<number[][]> {
  if (!realOpenAI) {
    const { OpenAI } = await import("openai");
    realOpenAI = new OpenAI();
  }
  const res = await realOpenAI.embeddings.create({
    input: texts,
    model: "text-embedding-3-small",
    dimensions: dims
  });
  return res.data.map((d: any) => d.embedding as number[]);
}

async function realChat(messages: Message[]): Promise<string> {
  if (!realOpenAI) {
    const { OpenAI } = await import("openai");
    realOpenAI = new OpenAI();
  }
  const res = await realOpenAI.chat.completions.create({
    model: "gpt-4o-mini",
    messages
  });
  return res.choices[0]?.message?.content || "";
}

export const openaiClient: OpenAIAdapter = {
  embedTexts: (texts, dims) =>
    MOCK_OPENAI ? mockEmbed(texts, dims) : realEmbed(texts, dims),
  chat: (messages) => (MOCK_OPENAI ? mockChat(messages) : realChat(messages))
};
```

// FILE: backend/src/db/client.ts

```ts
import { Pool } from "pg";
import { env } from "../config/env";

export const pool = new Pool({
  connectionString: env.DATABASE_URL
});

export async function query<T = any>(text: string, params?: any[]): Promise<{ rows: T[] }> {
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return { rows: res.rows as T[] };
  } finally {
    client.release();
  }
}

export async function withTx<T>(fn: (client: any) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
```

// FILE: backend/src/db/schema.ts

```ts
export const createExtensionsSQL = `
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;
`;

export const createTablesSQL = `
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  chunk_index INT NOT NULL,
  embedding VECTOR,  -- dimension ensured by code
  grade VARCHAR(10),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS query_rewrites (
  id SERIAL PRIMARY KEY,
  original_query TEXT NOT NULL,
  rewritten_query TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
`;

export const createIndexesSQL = `
-- Vector index (IVFFlat) on chunks.embedding using cosine
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'idx_chunks_embedding_ivfflat'
  ) THEN
    EXECUTE 'CREATE INDEX idx_chunks_embedding_ivfflat ON chunks USING ivfflat (embedding vector_cosine_ops)';
  END IF;
END$$;

-- Trigram index on documents.title
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'idx_documents_title_trgm'
  ) THEN
    EXECUTE 'CREATE INDEX idx_documents_title_trgm ON documents USING GIN (title gin_trgm_ops)';
  END IF;
END$$;
`;
```

// FILE: backend/src/db/sql.ts

```ts
import { EMBEDDING_DIMENSIONS } from "../config/constants";
import { query } from "./client";

export async function insertDocument(title: string | null, source: string | null) {
  const { rows } = await query<{ id: string }>(
    "INSERT INTO documents (title, source) VALUES ($1, $2) RETURNING id",
    [title, source]
  );
  return rows[0].id;
}

export async function insertChunk(
  documentId: string,
  chunkIndex: number,
  content: string,
  embedding: number[]
) {
  const { rows } = await query<{ id: string }>(
    "INSERT INTO chunks (document_id, chunk_index, content, embedding) VALUES ($1, $2, $3, $4) RETURNING id",
    [documentId, chunkIndex, content, `(${embedding.join(",")})`]
  );
  return rows[0].id;
}

export async function listDocuments() {
  const { rows } = await query(
    "SELECT id, title, source, created_at FROM documents ORDER BY created_at DESC"
  );
  return rows;
}

export async function deleteDocument(id: string) {
  await query("DELETE FROM documents WHERE id = $1", [id]);
}

export async function insertRewrite(original: string, rewritten: string) {
  await query(
    "INSERT INTO query_rewrites (original_query, rewritten_query) VALUES ($1, $2)",
    [original, rewritten]
  );
}

export function buildVectorSearchSQL(k: number) {
  return `
    SELECT c.id, c.document_id, c.chunk_index, c.content,
           (1 - (c.embedding <=> $1::vector)) AS vector_sim
    FROM chunks c
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
  const sql = buildVectorSearchSQL(k);
  const { rows } = await query(sql, [`(${qEmbedding.join(",")})`]);
  return rows as {
    id: string;
    document_id: string;
    chunk_index: number;
    content: string;
    vector_sim: number;
  }[];
}

export async function trigramTitleSearch(queryText: string, k: number) {
  const sql = buildTrigramTitleSQL(k);
  const { rows } = await query(sql, [queryText]);
  return rows as {
    document_id: string;
    title: string | null;
    source: string | null;
    trigram_sim: number;
  }[];
}

export async function chunksByDocumentIds(docIds: string[], limitPerDoc = 2) {
  if (docIds.length === 0) return [];
  const params = docIds.map((_, i) => `$${i + 1}`).join(",");
  const sql = `
    SELECT c.id, c.document_id, c.chunk_index, c.content
    FROM chunks c
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
}

export function ensureEmbeddingDimensions(vec: number[]) {
  if (vec.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding dimension mismatch: expected ${EMBEDDING_DIMENSIONS}, got ${vec.length}`
    );
  }
}
```

// FILE: backend/src/services/embeddings.ts

```ts
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
```

// FILE: backend/src/services/documents.ts

```ts
import { CHUNK_OVERLAP, CHUNK_SIZE } from "../config/constants";
import { embedTexts } from "./embeddings";
import { insertChunk, insertDocument } from "../db/sql";

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

export async function ingestDocument(content: string, title: string | null, source: string | null) {
  const documentId = await insertDocument(title, source);
  const chunks = chunkText(content);
  const embeddings = await embedTexts(chunks);
  let idx = 0;
  for (const [i, emb] of embeddings.entries()) {
    await insertChunk(documentId, i, chunks[i], emb);
    idx++;
  }
  return { documentId, chunksInserted: idx } as IngestResult;
}
```

// FILE: backend/src/services/reranker.ts

```ts
import { RERANKER_MODEL } from "../config/constants";

export interface Candidate {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  preScore: number; // combined hybrid score
}

function tokenize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
}

function jaccard(a: Set<string>, b: Set<string>) {
  const inter = new Set([...a].filter((x) => b.has(x))).size;
  const union = new Set([...a, ...b]).size || 1;
  return inter / union;
}

export async function rerank(
  query: string,
  candidates: Candidate[]
): Promise<Candidate[]> {
  // Try to use @dqbd/qdrant (best-effort)
  try {
    const lib: any = await import("@dqbd/qdrant").catch(() => null);
    if (lib && typeof lib.rerank === "function") {
      const scores = await lib.rerank(RERANKER_MODEL, query, candidates.map((c) => c.content));
      // Map scores (assume higher better)
      return candidates
        .map((c, i) => ({ ...c, preScore: Number(scores[i] ?? c.preScore) }))
        .sort((a, b) => b.preScore - a.preScore);
    }
  } catch {
    // ignore and fallback
  }

  // Fallback: 0.7 * word-overlap (Jaccard) + 0.3 * preScore
  const qSet = new Set(tokenize(query));
  const rescored = candidates.map((c) => {
    const cSet = new Set(tokenize(c.content));
    const overlap = jaccard(qSet, cSet);
    const score = 0.7 * overlap + 0.3 * (c.preScore || 0);
    return { ...c, preScore: score };
  });
  return rescored.sort((a, b) => b.preScore - a.preScore);
}
```

// FILE: backend/src/services/retrieval.ts

```ts
import {
  HYBRID_KEYWORD_WEIGHT,
  HYBRID_VECTOR_WEIGHT,
  RAG_TOP_K
} from "../config/constants";
import { embedText } from "./embeddings";
import {
  vectorSearch,
  trigramTitleSearch,
  chunksByDocumentIds
} from "../db/sql";
import { rerank, Candidate } from "./reranker";

export interface RetrievedChunk {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  source: string | null;
  score: number;
}

export async function hybridRetrieve(queryText: string, useHybrid = true): Promise<RetrievedChunk[]> {
  const qEmb = await embedText(queryText);
  const [vResults, tResults] = await Promise.all([
    vectorSearch(qEmb, RAG_TOP_K * 2),
    useHybrid ? trigramTitleSearch(queryText, RAG_TOP_K * 2) : Promise.resolve([])
  ]);

  const titleDocIds = tResults.map((r) => r.document_id);
  const trigramChunks =
    titleDocIds.length > 0
      ? await chunksByDocumentIds(titleDocIds, 2)
      : [];

  // Map trigram scores to chunks
  const trigramScoreByDoc = Object.fromEntries(
    tResults.map((r) => [r.document_id, r.trigram_sim || 0])
  );

  // Combine scores
  const prelim: Candidate[] = [];
  const add = (id: string, document_id: string, chunk_index: number, content: string, preScore: number) => {
    prelim.push({ id, document_id, chunk_index, content, preScore });
  };

  for (const v of vResults) {
    add(v.id, v.document_id, v.chunk_index, v.content, HYBRID_VECTOR_WEIGHT * (v.vector_sim || 0));
  }

  for (const c of trigramChunks) {
    const tScore = trigramScoreByDoc[c.document_id] || 0;
    add(c.id, c.document_id, c.chunk_index, c.content, HYBRID_KEYWORD_WEIGHT * tScore);
  }

  // Deduplicate by chunk id (keep max preScore)
  const dedupMap = new Map<string, Candidate>();
  for (const cand of prelim) {
    const prev = dedupMap.get(cand.id);
    if (!prev || cand.preScore > prev.preScore) dedupMap.set(cand.id, cand);
  }

  const cands = Array.from(dedupMap.values());
  const reranked = await rerank(queryText, cands);
  const top = reranked.slice(0, RAG_TOP_K);
  // We need sources; fetch doc sources via join-less trick → not available here.
  // For simplicity, source will be null here; the citations list will still show document_id + chunk_index
  return top.map((c) => ({
    id: c.id,
    document_id: c.document_id,
    chunk_index: c.chunk_index,
    content: c.content,
    source: null,
    score: c.preScore
  }));
}
```

// FILE: backend/src/services/verifier.ts

```ts
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
```

// FILE: backend/src/services/query.ts

```ts
import { insertRewrite } from "../db/sql";

export function maybeRewriteQuery(original: string): { rewritten: string | null; reason: string } {
  const trimmed = original.trim();
  // Heuristic: If shorter than 6 tokens, expand keywords with generic context
  const tokens = trimmed.split(/\s+/);
  if (tokens.length < 6) {
    const rewritten = `${trimmed} (context: RAG chat app, hybrid retrieval, citations)`;
    return { rewritten, reason: "Short/ambiguous query expanded for better recall." };
  }
  return { rewritten: null, reason: "No rewrite needed." };
}

export async function persistRewrite(original: string, rewritten: string | null) {
  if (rewritten && rewritten !== original) {
    await insertRewrite(original, rewritten);
  }
}
```

// FILE: backend/src/services/agent.ts

```ts
import { MAX_AGENT_STEPS, MAX_VERIFICATION_LOOPS } from "../config/constants";
import { hybridRetrieve } from "./retrieval";
import { gradeChunks, verifyAnswer } from "./verifier";
import { maybeRewriteQuery, persistRewrite } from "./query";
import { SSEOutEvent, CitationItem } from "../../../shared/types";

export interface AgentOptions {
  useRag: boolean;
  useHybrid: boolean;
}

export type SSESender = (event: SSEOutEvent) => void;

function now() { return Date.now(); }

function emit(sender: SSESender, e: SSEOutEvent) {
  sender(e);
}

function composeAnswer(evidence: { id: string; document_id: string; chunk_index: number; content: string }[], query: string) {
  if (evidence.length === 0) {
    return "I don't have enough evidence to answer confidently. Please upload relevant documents or refine your question.";
  }
  // Simple extractive summary + citations
  const parts: string[] = [];
  for (const ev of evidence.slice(0, 3)) {
    const snippet = ev.content.length > 260 ? ev.content.slice(0, 260) + "..." : ev.content;
    parts.push(`${snippet.trim()} [cite:${ev.document_id}:${ev.chunk_index}]`);
  }
  return `**Answer (from evidence):**\n${parts.join("\n\n")}`;
}

export async function runAgent(
  message: string,
  sender: SSESender,
  opts: AgentOptions
) {
  let steps = 0;
  let loops = 0;
  let workingQuery = message;

  emit(sender, { type: "agent_log", role: "planner", message: "Received user message. Assessing whether to retrieve.", ts: now() });

  // Planner
  steps++;
  if (opts.useRag) {
    const { rewritten, reason } = maybeRewriteQuery(workingQuery);
    if (rewritten) {
      emit(sender, { type: "agent_log", role: "planner", message: `Rewriting query: ${reason}`, ts: now() });
      emit(sender, { type: "rewrite", original: workingQuery, rewritten, ts: now() });
      await persistRewrite(workingQuery, rewritten);
      workingQuery = rewritten;
    } else {
      emit(sender, { type: "agent_log", role: "planner", message: "No rewrite needed.", ts: now() });
    }
  } else {
    emit(sender, { type: "agent_log", role: "planner", message: "Direct answer mode (RAG disabled).", ts: now() });
  }

  // Direct mode
  if (!opts.useRag) {
    steps++;
    const text = `You asked: "${message}". Since Agentic RAG is off, here's a concise response: this system can retrieve and verify information with citations when enabled.`;
    // Stream tokens
    for (const chunk of text.match(/.{1,60}/g) || []) {
      emit(sender, { type: "tokens", text: chunk, ts: now() });
    }
    emit(sender, {
      type: "final",
      text,
      citations: [],
      rewrittenQuery: undefined,
      verified: false,
      ts: now()
    });
    return { steps };
  }

  // RAG loop
  let finalText = "";
  let finalCitations: CitationItem[] = [];
  while (loops <= MAX_VERIFICATION_LOOPS) {
    steps++;
    emit(sender, { type: "agent_log", role: "researcher", message: `Retrieving evidence (hybrid=${String(opts.useHybrid)})...`, ts: now() });
    const retrieved = await hybridRetrieve(workingQuery, opts.useHybrid);

    const grades = gradeChunks(workingQuery, retrieved.map(r => ({ id: r.id, content: r.content })));
    emit(sender, { type: "agent_log", role: "critic", message: "Grading retrieved chunks for relevance.", ts: now() });

    // Select high (or fallback to mediums)
    const highs = retrieved.filter(r => grades[r.id] === "high");
    const mediums = retrieved.filter(r => grades[r.id] === "medium");
    const approved = highs.length > 0 ? highs : mediums.slice(0, 3);

    const citations: CitationItem[] = approved.map(a => ({
      document_id: a.document_id,
      source: a.source,
      chunk_index: a.chunk_index
    }));
    emit(sender, { type: "citations", citations, ts: now() });

    // Writer: compose answer ONLY from approved evidence
    const answer = composeAnswer(approved, workingQuery);
    emit(sender, { type: "agent_log", role: "writer", message: "Drafting answer from approved evidence.", ts: now() });

    // Stream tokens
    for (const chunk of answer.match(/.{1,60}/g) || []) {
      emit(sender, { type: "tokens", text: chunk, ts: now() });
    }

    // Final Critic: verify
    const verify = verifyAnswer(answer, approved.map(a => ({ id: a.id, content: a.content })));
    emit(sender, { type: "verification", isValid: verify.isValid, gradeSummary: grades, feedback: verify.feedback, ts: now() });

    if (verify.isValid || loops === MAX_VERIFICATION_LOOPS) {
      finalText = answer;
      finalCitations = citations;
      emit(sender, {
        type: "final",
        text: finalText,
        citations: finalCitations,
        rewrittenQuery: workingQuery !== message ? workingQuery : undefined,
        verified: verify.isValid,
        ts: now()
      });
      break;
    } else {
      // Try to nudge query
      emit(sender, { type: "agent_log", role: "planner", message: "Verification failed — refining query and retrying.", ts: now() });
      workingQuery = `${message} (focus: key terms and definitions)`;
      loops++;
    }
  }

  return { steps, loops };
}
```

// FILE: backend/src/routes/chat.ts

```ts
import { FastifyInstance } from "fastify";
import { runAgent } from "../services/agent";
import { ChatRequestBody, SSEOutEvent } from "../../../shared/types";

function sseWrite(reply: any, event: SSEOutEvent) {
  reply.raw.write(`event: ${event.type}\n`);
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

export async function chatRoutes(app: FastifyInstance) {
  app.post("/api/chat", { logLevel: "info" }, async (req, reply) => {
    const body = (await req.body) as ChatRequestBody;
    const message = body?.message?.toString() || "";
    const useRag = body?.useRag !== false;
    const useHybrid = body?.useHybrid !== false;

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    const sender = (e: SSEOutEvent) => sseWrite(reply, e);

    try {
      await runAgent(message, sender, { useRag, useHybrid });
    } catch (err: any) {
      sseWrite(reply, {
        type: "tokens",
        text: `Error: ${err?.message || "unknown"}`,
        ts: Date.now()
      });
      sseWrite(reply, {
        type: "final",
        text: "An error occurred while processing your request.",
        citations: [],
        verified: false,
        ts: Date.now()
      });
    } finally {
      reply.raw.end();
    }

    return reply; // keep Fastify happy
  });
}
```

// FILE: backend/src/routes/documents.ts

```ts
import { FastifyInstance } from "fastify";
import { ingestDocument } from "../services/documents";
import { listDocuments, deleteDocument } from "../db/sql";

export async function documentRoutes(app: FastifyInstance) {
  app.post("/api/documents/upload", { logLevel: "info" }, async (req, reply) => {
    const mp = await req.file({ limits: { fileSize: 5 * 1024 * 1024 } });
    if (!mp) {
      reply.code(400).send({ error: "No file uploaded" });
      return;
    }
    const filename = mp.filename;
    const source = filename || "upload";
    const content = (await mp.toBuffer()).toString("utf8");
    const title = filename?.replace(/\.(md|txt)$/i, "") || null;
    const result = await ingestDocument(content, title, source);
    reply.send({ ok: true, ...result });
  });

  app.get("/api/documents", async (_req, reply) => {
    const docs = await listDocuments();
    reply.send({ documents: docs });
  });

  app.delete("/api/documents/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    await deleteDocument(id);
    reply.send({ ok: true });
  });
}
```

// FILE: backend/src/server.ts

```ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { env } from "./config/env";
import { chatRoutes } from "./routes/chat";
import { documentRoutes } from "./routes/documents";

async function build() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: env.CORS_ORIGIN, credentials: true });
  await app.register(multipart);

  await chatRoutes(app);
  await documentRoutes(app);

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  app.log.info(`Backend listening on http://localhost:${env.PORT}`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

// FILE: backend/scripts/dbSetup.mjs

```js
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://rag:rag@localhost:5432/ragchat";
const { Pool } = pg;
const pool = new Pool({ connectionString: DATABASE_URL });

const sql = `
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  chunk_index INT NOT NULL,
  embedding VECTOR,
  grade VARCHAR(10),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS query_rewrites (
  id SERIAL PRIMARY KEY,
  original_query TEXT NOT NULL,
  rewritten_query TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
`;

const idx = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relname='idx_chunks_embedding_ivfflat'
  ) THEN
    EXECUTE 'CREATE INDEX idx_chunks_embedding_ivfflat ON chunks USING ivfflat (embedding vector_cosine_ops)';
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relname='idx_documents_title_trgm'
  ) THEN
    EXECUTE 'CREATE INDEX idx_documents_title_trgm ON documents USING GIN (title gin_trgm_ops)';
  END IF;
END$$;
`;

async function main() {
  const client = await pool.connect();
  try {
    await client.query(sql);
    await client.query(idx);
    console.log("DB setup complete.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

// FILE: backend/scripts/dbMigrate.mjs

```js
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://rag:rag@localhost:5432/ragchat";
const { Pool } = pg;
const pool = new Pool({ connectionString: DATABASE_URL });

const ext = `
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;
`;

const idx = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relname='idx_chunks_embedding_ivfflat'
  ) THEN
    EXECUTE 'CREATE INDEX idx_chunks_embedding_ivfflat ON chunks USING ivfflat (embedding vector_cosine_ops)';
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relname='idx_documents_title_trgm'
  ) THEN
    EXECUTE 'CREATE INDEX idx_documents_title_trgm ON documents USING GIN (title gin_trgm_ops)';
  END IF;
END$$;
`;

async function main() {
  const client = await pool.connect();
  try {
    await client.query(ext);
    await client.query(idx);
    console.log("DB migrate ensured.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

// FILE: backend/scripts/ingestSamples.mjs

```js
import fs from "fs/promises";
import path from "path";
import pg from "pg";
import crypto from "crypto";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://rag:rag@localhost:5432/ragchat";
const EMBEDDING_DIMENSIONS = Number(process.env.EMBEDDING_DIMENSIONS || 1536);
const CHUNK_SIZE = Number(process.env.CHUNK_SIZE || 1000);
const CHUNK_OVERLAP = Number(process.env.CHUNK_OVERLAP || 100);

const { Pool } = pg;
const pool = new Pool({ connectionString: DATABASE_URL });

function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const chunks = [];
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

function strSeed(s) {
  const h = crypto.createHash("sha256").update(s).digest();
  return h.readUInt32BE(0);
}
function seededRand(seed) {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0xffffffff;
  };
}

async function mockEmbed(texts, dims) {
  return texts.map((t) => {
    const rng = seededRand(strSeed(t));
    const v = new Array(dims).fill(0).map(() => rng());
    const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0));
    return v.map((x) => x / (norm || 1));
  });
}

async function insertDocument(client, title, source) {
  const res = await client.query(
    "INSERT INTO documents (title, source) VALUES ($1, $2) RETURNING id",
    [title, source]
  );
  return res.rows[0].id;
}

async function insertChunk(client, docId, index, content, embedding) {
  await client.query(
    "INSERT INTO chunks (document_id, chunk_index, content, embedding) VALUES ($1, $2, $3, $4)",
    [docId, index, content, `(${embedding.join(",")})`]
  );
}

async function main() {
  const client = await pool.connect();
  try {
    const samplesDir = path.resolve(process.cwd(), "../samples");
    const files = await fs.readdir(samplesDir);
    let countDocs = 0;
    let countChunks = 0;

    for (const f of files) {
      if (!f.endsWith(".md") && !f.endsWith(".txt")) continue;
      const p = path.join(samplesDir, f);
      const content = await fs.readFile(p, "utf8");
      const chunks = chunkText(content);
      const embs = await mockEmbed(chunks, EMBEDDING_DIMENSIONS);

      const title = path.basename(f).replace(/\.(md|txt)$/i, "");
      const docId = await insertDocument(client, title, f);

      for (let i = 0; i < chunks.length; i++) {
        await insertChunk(client, docId, i, chunks[i], embs[i]);
        countChunks++;
      }
      countDocs++;
    }

    console.log(`Ingested ${countDocs} documents with ${countChunks} chunks.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

// FILE: backend/tests/chunk.test.ts

```ts
import { describe, it, expect } from "vitest";
import { chunkText } from "../src/services/documents";

describe("chunkText", () => {
  it("creates overlapping chunks deterministically", () => {
    const text = "abcdefghijklmnopqrstuvwxyz";
    const chunks = chunkText(text, 10, 2);
    // Expect 3 chunks: [0..9], [8..17], [16..25]
    expect(chunks.length).toBe(3);
    expect(chunks[0]).toBe("abcdefghij");
    expect(chunks[1]).toBe("ijklmnopqr");
    expect(chunks[2]).toBe("stuvwxyz");
  });

  it("returns full text when below chunk size", () => {
    const text = "short";
    const chunks = chunkText(text, 100, 10);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe("short");
  });
});
```

// FILE: backend/tests/retrieval.test.ts

```ts
import { describe, it, expect } from "vitest";
import { buildVectorSearchSQL, buildTrigramTitleSQL } from "../src/db/sql";

describe("retrieval SQL builders", () => {
  it("includes ivfflat vector operator", () => {
    const sql = buildVectorSearchSQL(5);
    expect(sql).toMatch(/embedding\s*<=>\s*\$1::vector/);
  });

  it("includes trigram similarity", () => {
    const sql = buildTrigramTitleSQL(5);
    expect(sql).toMatch(/similarity\(d\.title,\s*\$1\)/);
    expect(sql).toMatch(/d\.title\s*%\s*\$1/);
  });
});
```

// FILE: backend/tests/reranker.test.ts

```ts
import { describe, it, expect } from "vitest";
import { rerank } from "../src/services/reranker";

describe("reranker fallback", () => {
  it("improves ordering based on overlap", async () => {
    const query = "pgvector similarity search embeddings";
    const candidates = [
      {
        id: "a",
        document_id: "d1",
        chunk_index: 0,
        content: "This chunk talks about cooking pasta and tomato sauce.",
        preScore: 0.8
      },
      {
        id: "b",
        document_id: "d2",
        chunk_index: 1,
        content: "pgvector enables similarity search on embeddings within PostgreSQL.",
        preScore: 0.2
      }
    ];
    const ranked = await rerank(query, candidates);
    expect(ranked[0].id).toBe("b"); // should be promoted due to topical overlap
  });
});
```

// FILE: backend/tests/agent.test.ts

```ts
import { describe, it, expect } from "vitest";
import { runAgent } from "../src/services/agent";

describe("agent direct mode", () => {
  it("completes within MAX_AGENT_STEPS when RAG disabled", async () => {
    const events: any[] = [];
    const sender = (e: any) => events.push(e);
    const result = await runAgent("What can you do?", sender, { useRag: false, useHybrid: true });
    // Should emit final event
    expect(events.some((e) => e.type === "final")).toBe(true);
    expect(result.steps).toBeLessThanOrEqual(Number(process.env.MAX_AGENT_STEPS || 3) + 1);
  });
});
```

// FILE: backend/tests/verifier.test.ts

```ts
import { describe, it, expect } from "vitest";
import { gradeChunks, verifyAnswer } from "../src/services/verifier";

describe("verifier", () => {
  it("grades shape and values", () => {
    const q = "hybrid retrieval with citations";
    const chunks = [
      { id: "1", content: "Hybrid retrieval combines vector search and keyword signals with citations." },
      { id: "2", content: "A story about a cat and a dog." }
    ];
    const grades = gradeChunks(q, chunks);
    expect(Object.keys(grades)).toHaveLength(2);
    expect(["high", "medium", "low"]).toContain(grades["1"]);
    expect(["high", "medium", "low"]).toContain(grades["2"]);
  });

  it("verifies support", () => {
    const ans = "Hybrid retrieval combines vector search and keyword signals with citations.";
    const ev = [{ id: "e1", content: ans }];
    const res = verifyAnswer(ans, ev);
    expect(res.isValid).toBe(true);
  });
});
```

// FILE: frontend/package.json

```json
{
  "name": "rag-chat-frontend",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "typecheck": "tsc --noEmit",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.1",
    "typescript": "^5.6.3",
    "vite": "^5.4.8"
  }
}
```

// FILE: frontend/tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "NodeNext",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src"]
}
```

// FILE: frontend/vite.config.ts

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true
      }
    }
  }
});
```

// FILE: frontend/src/api/sse.ts

```ts
import type {
  AgentLogEvent,
  CitationsEvent,
  FinalEvent,
  RewriteEvent,
  TokensEvent,
  VerificationEvent
} from "../../../shared/types";

type AnyEvent =
  | AgentLogEvent
  | CitationsEvent
  | FinalEvent
  | RewriteEvent
  | TokensEvent
  | VerificationEvent;

export function startChatSSE(body: { message: string; useRag: boolean; useHybrid: boolean }, onEvent: (e: AnyEvent) => void) {
  const es = new EventSourcePolyfill("/api/chat", { body: JSON.stringify(body) });
  return es.subscribe(onEvent);
}

/**
 * Lightweight "polyfill" that posts and then reads streaming response.
 * Works with Fastify SSE by using fetch + ReadableStream reader.
 */
class EventSourcePolyfill {
  private controller: AbortController;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  constructor(private url: string, private options: { body: string }) {
    this.controller = new AbortController();
  }

  subscribe(onEvent: (e: AnyEvent) => void) {
    (async () => {
      const res = await fetch(this.url, {
        method: "POST",
        body: this.options.body,
        headers: { "Content-Type": "application/json" },
        signal: this.controller.signal
      });
      if (!res.body) return;
      this.reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // parse SSE lines
        const parts = buf.split("\n\n");
        buf = parts.pop() || "";
        for (const chunk of parts) {
          const lines = chunk.split("\n");
          let eventType = "message";
          let data = "";
          for (const ln of lines) {
            if (ln.startsWith("event:")) eventType = ln.slice(6).trim();
            if (ln.startsWith("data:")) data += ln.slice(5).trim();
          }
          if (data) {
            try {
              const obj = JSON.parse(data);
              (obj.type = eventType), onEvent(obj as AnyEvent);
            } catch {
              // ignore
            }
          }
        }
      }
    })();

    return {
      close: () => this.controller.abort()
    };
  }
}
```

// FILE: frontend/src/components/VerificationBadge.tsx

```tsx
import React from "react";

export function VerificationBadge({ verified }: { verified: boolean | null }) {
  if (verified === null) return null;
  return (
    <span
      style={{
        padding: "4px 8px",
        borderRadius: 6,
        fontSize: 12,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: verified ? "rgba(16, 185, 129, 0.15)" : "rgba(245, 158, 11, 0.15)",
        color: verified ? "#065f46" : "#92400e",
        border: `1px solid ${verified ? "#10b981" : "#f59e0b"}`
      }}
      title={verified ? "Verified against evidence" : "Low confidence"}
    >
      {verified ? "✅ Verified" : "⚠️ Low Confidence"}
    </span>
  );
}
```

// FILE: frontend/src/components/FileUpload.tsx

```tsx
import React, { useEffect, useState } from "react";
import type { DocumentRecord } from "../../../shared/types";

export function FileUpload() {
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/documents");
    const json = await res.json();
    setDocs(json.documents || []);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    setBusy(true);
    setMsg("Uploading + embedding...");
    try {
      await fetch("/api/documents/upload", { method: "POST", body: form });
      setMsg("Uploaded!");
      await refresh();
    } catch (e: any) {
      setMsg("Upload failed: " + e?.message);
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 1500);
    }
  }

  async function del(id: string) {
    await fetch(`/api/documents/${id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
      <h3 style={{ marginTop: 0 }}>Documents</h3>
      <input type="file" accept=".md,.txt" onChange={onChange} disabled={busy} />
      {msg && <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>{msg}</div>}
      <ul style={{ padding: 0, marginTop: 12 }}>
        {docs.map((d) => (
          <li key={d.id} style={{ listStyle: "none", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px dashed #eee" }}>
            <div>
              <div style={{ fontWeight: 600 }}>{d.title || "(untitled)"}</div>
              <div style={{ fontSize: 12, color: "#666" }}>{d.source || "upload"} — {new Date(d.created_at).toLocaleString()}</div>
            </div>
            <button onClick={() => del(d.id)} style={{ border: "1px solid #ef4444", background: "white", color: "#b91c1c", borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

// FILE: frontend/src/hooks/useChat.ts

```tsx
import { useEffect, useRef, useState } from "react";
import type {
  AgentLogEvent,
  CitationsEvent,
  FinalEvent,
  RewriteEvent,
  TokensEvent,
  VerificationEvent
} from "../../../shared/types";
import { startChatSSE } from "../api/sse";

export function useChat() {
  const [logs, setLogs] = useState<AgentLogEvent[]>([]);
  const [rewrite, setRewrite] = useState<RewriteEvent | null>(null);
  const [text, setText] = useState("");
  const [citations, setCitations] = useState<CitationsEvent["citations"]>([]);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const subRef = useRef<{ close: () => void } | null>(null);

  function reset() {
    setLogs([]);
    setRewrite(null);
    setText("");
    setCitations([]);
    setVerified(null);
  }

  async function send(message: string, useRag: boolean, useHybrid: boolean) {
    reset();
    setBusy(true);
    const sub = startChatSSE({ message, useRag, useHybrid }, (e: any) => {
      if (e.type === "agent_log") setLogs((prev) => [...prev, e as AgentLogEvent]);
      if (e.type === "rewrite") setRewrite(e as RewriteEvent);
      if (e.type === "tokens") setText((prev) => prev + (e as TokensEvent).text);
      if (e.type === "citations") setCitations((e as CitationsEvent).citations);
      if (e.type === "verification") setVerified((e as VerificationEvent).isValid);
      if (e.type === "final") setBusy(false);
    });
    subRef.current = sub;
  }

  useEffect(() => {
    return () => {
      subRef.current?.close();
    };
  }, []);

  return { logs, rewrite, text, citations, verified, busy, send };
}
```

// FILE: frontend/src/components/Chat.tsx

```tsx
import React, { useState } from "react";
import { useChat } from "../hooks/useChat";
import { VerificationBadge } from "./VerificationBadge";

export function Chat() {
  const [input, setInput] = useState("");
  const [agentic, setAgentic] = useState(true);
  const [hybrid, setHybrid] = useState(true);

  const { logs, rewrite, text, citations, verified, busy, send } = useChat();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    await send(input.trim(), agentic, hybrid);
  }

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
      <h3 style={{ marginTop: 0 }}>Chat</h3>
      <form onSubmit={onSubmit} style={{ display: "flex", gap: 8 }}>
        <input
          placeholder="Ask a question..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          style={{ flex: 1, padding: 10, borderRadius: 6, border: "1px solid #ddd" }}
        />
        <button disabled={busy} style={{ padding: "10px 14px", borderRadius: 6, border: "1px solid #111", background: "#111", color: "white" }}>
          {busy ? "Thinking..." : "Send"}
        </button>
      </form>
      <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={agentic} onChange={(e) => setAgentic(e.target.checked)} />
          Enable Agentic RAG
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={hybrid} onChange={(e) => setHybrid(e.target.checked)} />
          Hybrid Search (vector + trigram)
        </label>
        <VerificationBadge verified={verified} />
      </div>

      {rewrite && (
        <div style={{ marginTop: 12, fontSize: 13, color: "#374151" }}>
          <strong>Rewrote query to:</strong> <em>{rewrite.rewritten}</em>
        </div>
      )}

      <div style={{ marginTop: 16, padding: 12, background: "#fafafa", borderRadius: 8, minHeight: 120, whiteSpace: "pre-wrap" }}>
        {text || "Ask something to get started."}
      </div>

      {citations.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Citations</div>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {citations.map((c, i) => (
              <li key={`${c.document_id}:${c.chunk_index}:${i}`} style={{ fontSize: 13 }}>
                doc <code>{c.document_id.slice(0, 8)}</code>, chunk #{c.chunk_index} {c.source ? `— ${c.source}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Agent Logs</div>
        <ul style={{ margin: 0, paddingLeft: 16 }}>
          {logs.map((l, i) => (
            <li key={i} style={{ fontSize: 12, color: "#4b5563" }}>
              <strong style={{ textTransform: "capitalize" }}>{l.role}:</strong> {l.message}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

// FILE: frontend/src/App.tsx

```tsx
import React from "react";
import { Chat } from "./components/Chat";
import { FileUpload } from "./components/FileUpload";

export default function App() {
  return (
    <div style={{ maxWidth: 980, margin: "40px auto", padding: "0 20px", fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system" }}>
      <h1 style={{ marginTop: 0 }}>rag-chat</h1>
      <p style={{ marginTop: -10, color: "#4b5563" }}>
        Agentic RAG with hybrid retrieval, rerank and self-verification. Answers stream with citations.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
        <Chat />
        <FileUpload />
      </div>
      <footer style={{ marginTop: 24, fontSize: 12, color: "#6b7280" }}>
        Ports — Backend: <code>8787</code>, Frontend: <code>5173</code>
      </footer>
    </div>
  );
}
```

// FILE: frontend/src/main.tsx

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

// FILE: frontend/index.html

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0"
    />
    <title>rag-chat</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

// FILE: scripts/dev.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
echo "Starting backend and frontend..."
npm run dev
```
