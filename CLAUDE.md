# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **production-ready 14-layer Agentic RAG** system implementing multi-agent orchestration with hybrid retrieval (vector + keyword), reranking, and self-verification loops. The system uses **dual vector stores** (PostgreSQL/pgvector + Qdrant Cloud) for enhanced recall, Fastify for backend API, React for frontend, and OpenAI for embeddings/generation.

### Key Features
- **Dual-Source Vector Retrieval**: Parallel querying of Postgres and Qdrant with deduplication
- **Transactional Sync**: Compensating transactions ensure both stores stay in sync
- **Self-Verification**: Bounded loops with hallucination detection (≥50% token overlap)
- **Hybrid Search**: 70% semantic (vector) + 30% keyword (trigram)
- **Real-time Streaming**: SSE events for agent logs, citations, and token streaming

## Development Commands

### Initial Setup
```bash
# Install all workspace dependencies
npm install

# Start PostgreSQL + Qdrant (Docker)
docker compose up -d

# Configure Qdrant Cloud (alternative to local)
# Edit backend/.env:
#   QDRANT_URL=https://your-cluster.eastus-0.azure.cloud.qdrant.io:6333
#   QDRANT_API_KEY=your-api-key
#   USE_DUAL_VECTOR_STORE=true

# Create database schema (extensions, tables, indexes)
npm run db:setup
npm run db:migrate

# Seed sample documents with embeddings (populates both Postgres + Qdrant)
npm run ingest:samples

# Verify sync health
curl http://localhost:8787/api/health
```

### Development Workflow
```bash
# Run both backend (8787) and frontend (5173) in watch mode
npm run dev

# Run backend only
npm -w backend run dev

# Run frontend only
npm -w frontend run dev
```

### Testing & Type Checking
```bash
# Run all backend tests (vitest)
npm test

# Run tests in watch mode
npm -w backend run test

# Type-check all workspaces
npm run typecheck
```

### Database Management
```bash
# Re-run schema setup (idempotent)
npm run db:setup

# Run migrations
npm run db:migrate

# Re-ingest sample documents
npm run ingest:samples
```

## Architecture Overview

### Core Request Flow

```
User Query → Rate Limit → Auth → Coordinator
  ↓
Classifier (route: retrieve vs direct)
  ↓
Response Cache Check
  ↓
Verification Loop (max 2 iterations):
  1. Retrieval Agent: hybridRetrieve()
     - Embed query (OpenAI)
     - Dual-source vector search (if USE_DUAL_VECTOR_STORE=true):
       ├─ Postgres: pgvector IVFFlat cosine similarity
       └─ Qdrant:   client.search() with retry
     - Trigram search (pg_trgm GIN on document titles)
     - Deduplicate by chunk_id (keep higher score)
     - Rerank (Jaccard fallback)
  2. Processing Agent: gradeChunks()
     - Token overlap scoring
  3. Writer Agent: Compose answer
     - Extract top chunks with citations
  4. Verifier Agent: verifyAnswer()
     - Token-based hallucination check
  ↓
SSE Stream Events (agent_log, citations, tokens, verification, final)
```

### Orchestration Layer (Layer 2)

Located in `backend/src/services/orchestration/`:

- **coordinator.ts**: Master orchestrator managing the retrieval → verify → refine loop with bounded retries
- **classifier.ts**: Heuristic-based query router (no LLM cost) deciding "retrieve" vs "direct" mode
- **registry.ts**: Service locator pattern binding agents (retrieval, processing, quality)

**Key Pattern**: Agents are lightweight functional modules, not classes. The coordinator invokes them sequentially and manages state.

### Agent Architecture (Layer 3)

Agents are implemented as composable functions registered in `registry.ts`:

| Agent Role | Function | Purpose |
|-----------|----------|---------|
| Planner | Coordinator + Classifier | Route decision, loop management |
| Researcher | `hybridRetrieve()` | Semantic + keyword search fusion |
| Critic | `gradeChunks()` | Relevance scoring via token overlap |
| Writer | Extractive composition | Answer synthesis with citations |
| Verifier | `verifyAnswer()` | Hallucination detection (≥50% token overlap) |

### Service Boundaries

- **embeddings.ts** (Layer 5): OpenAI text-embedding-3-small with mock mode for testing
- **retrieval.ts** (Layer 7): Dual-source hybrid search (Postgres + Qdrant in parallel when enabled)
- **reranker.ts** (Layer 7): Qdrant library with graceful Jaccard fallback
- **cache.ts** (Layer 7/9): TTL-based caching (response cache: 5min, retrieval cache: 2min)
- **documents.ts** (Layer 4): Document chunking, batch embedding, dual-store ingestion with rollback
- **verifier.ts** (Layer 3): Token-based verification and chunk grading
- **db/qdrant.ts** (Layer 6): Qdrant client with retry, collection management, sync operations
- **utils/retry.ts**: Exponential backoff retry utility for transient failures
- **routes/health.ts** (Layer 10/14): Health checks, sync monitoring, drift detection

### Database Schema

**PostgreSQL 16** with extensions:
- **pgvector**: Vector similarity search with IVFFlat indexing
- **pg_trgm**: Trigram-based fuzzy text matching

Core tables:
```sql
documents (id, title, source, created_at)
chunks (id, document_id, content, chunk_index, embedding VECTOR(1536), grade, created_at)
query_rewrites (id, original_query, rewritten_query, created_at)
feedback (id, rating, comment, trace_id, question, created_at)
```

Indexes:
- IVFFlat index on `chunks.embedding` for vector cosine similarity
- GIN trigram index on `documents.title` for fuzzy matching

**Qdrant** collection schema:
```json
{
  "collection": "chunks",
  "vectors": { "size": 1536, "distance": "Cosine" },
  "points": [
    {
      "id": "chunk_id (UUID from Postgres)",
      "vector": [1536 floats],
      "payload": {
        "chunk_id": "UUID",
        "document_id": "UUID",
        "chunk_index": 0,
        "content": "chunk text"
      }
    }
  ]
}
```

**Shared Identifier Contract**: `chunks.id` in Postgres = Qdrant point `id`

### Configuration (backend/.env)

Key environment variables:

```env
# Qdrant Configuration (Layer 6 - Dual Vector Store)
QDRANT_URL=http://localhost:6333                    # Local Docker
# QDRANT_URL=https://xxx.eastus-0.azure.cloud.qdrant.io:6333  # Cloud
QDRANT_API_KEY=                                     # Empty for local, JWT for cloud
QDRANT_COLLECTION=chunks
USE_DUAL_VECTOR_STORE=true                          # Enable parallel Postgres + Qdrant

# Models
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
CHAT_MODEL=gpt-4o-mini
RERANKER_MODEL=BAAI/bge-reranker-base

# Retrieval Tuning
HYBRID_VECTOR_WEIGHT=0.7      # Semantic search weight
HYBRID_KEYWORD_WEIGHT=0.3     # Keyword search weight
RAG_TOP_K=5                    # Top chunks to retrieve

# Chunking
CHUNK_SIZE=1000                # Characters per chunk
CHUNK_OVERLAP=100              # Sliding window overlap

# Flow Control
MAX_AGENT_STEPS=3              # Max agent iterations
MAX_VERIFICATION_LOOPS=2       # Max verify→refine loops

# Testing
MOCK_OPENAI=0|1                # Use deterministic mock embeddings
```

## Key Implementation Details

### Dual-Store Architecture (Layer 6)

The system maintains two vector databases in parallel for enhanced reliability and recall:

**Architecture**:
```
Ingestion:
  User Upload → Chunks → OpenAI Embedding
    ↓
  INSERT Postgres (chunks table) → get chunk_id
    ↓
  INSERT Qdrant (using chunk_id as point ID)
    ↓
  If Qdrant fails → DELETE from Postgres (compensating transaction)

Retrieval:
  Query Embedding
    ↓
  Parallel Search:
    ├─ Postgres: SELECT ... ORDER BY embedding <=> $1
    └─ Qdrant:   client.search(collection, vector, limit)
    ↓
  Deduplicate by chunk_id (keep higher score)
    ↓
  Rerank → Top K
```

**Sync Safeguards** (6 layers of protection):

1. **Startup Validation** (`server.ts:18-40`): Validates Qdrant Cloud credentials at server startup
   - Detects cloud URLs (containing "cloud.qdrant.io")
   - Enforces QDRANT_API_KEY requirement for cloud deployments
   - Fast-fails with clear error message before accepting traffic
2. **Retry Logic** (`utils/retry.ts`): Exponential backoff for transient failures (3 retries, 200ms→800ms)
3. **Compensating Transactions** (`services/documents.ts:38-86`):
   - Insert Postgres → Insert Qdrant
   - If Qdrant fails → Delete from Postgres
   - Ensures all-or-nothing consistency
4. **Partial Failure Handling** (`routes/documents.ts:32-54`):
   - Deletion uses `Promise.allSettled` for both stores
   - Returns HTTP 207 if one store fails with detailed breakdown
5. **Health Monitoring** (`GET /api/health`):
   ```json
   {
     "status": "healthy|degraded",
     "postgres": { "chunks": 3 },
     "qdrant": { "points": 3 },
     "sync": { "inSync": true, "drift": 0, "driftPercentage": "0%" }
   }
   ```
6. **Best-Effort Cleanup**: Rollback operations never fail silently

**Benefits of Dual-Store**:
- Higher recall: If one store misses a chunk, the other might find it
- Redundancy: Data persists even if one service is down
- Flexibility: Can toggle `USE_DUAL_VECTOR_STORE=false` for Postgres-only mode

**File Locations**:
- `db/qdrant.ts`: Client, collection init, CRUD with retry
- `utils/retry.ts`: Generic retry utility with exponential backoff
- `routes/health.ts`: Sync verification and drift detection

### Hybrid Retrieval Algorithm

The system combines two retrieval methods in parallel:

1. **Vector Search**: Cosine similarity using pgvector IVFFlat index
2. **Keyword Search**: Trigram similarity on document titles using pg_trgm

Results are deduplicated by chunk ID (keeping max score), then reranked using either:
- Qdrant BGE reranker (if available)
- Jaccard token overlap fallback (70% overlap + 30% pre-score)

### Verification Loop

The system implements bounded self-verification to prevent hallucinations:

1. Grader scores chunks as "high", "medium", or "low" relevance
2. Writer composes answer from top chunks
3. Verifier checks if ≥50% of answer tokens appear in evidence
4. If verification fails and loops < MAX_VERIFICATION_LOOPS, refine and retry
5. Final response includes `verified: true|false` flag

### Semantic Caching

Two-tier cache strategy:
- **Response cache**: Stores complete answers (5min TTL, 200 max entries)
- **Retrieval cache**: Stores retrieved chunks (2min TTL, 200 max entries)

Cache keys are normalized (lowercase, trimmed, single-space) for semantic equivalence.

### SSE Event Streaming

The `/api/chat` endpoint streams real-time events:
- `agent_log`: Progress updates from planner/researcher/critic/writer
- `rewrite`: Query rewriting events
- `tokens`: Incremental answer text
- `citations`: Document references (format: `[cite:doc_id:chunk_index]`)
- `verification`: Hallucination check results
- `final`: Complete answer with verified flag

Event contracts are defined in `shared/types.ts`.

## Adding New Features

### To Add a New Agent

1. Implement function in `backend/src/services/`
2. Register in `services/orchestration/registry.ts` under appropriate category
3. Invoke from coordinator: `Agents.<category>.<method>()`

### To Modify Query Flow

Edit `services/orchestration/coordinator.ts` main loop (lines 37-88). Keep SSE events consistent with `shared/types.ts`.

### To Tune Retrieval Behavior

- Adjust hybrid weights in `backend/.env`: `HYBRID_VECTOR_WEIGHT`, `HYBRID_KEYWORD_WEIGHT`
- Modify reranker formula in `services/reranker.ts` (currently 70/30 Jaccard/preScore)
- Change top-K value: `RAG_TOP_K`

## Testing Strategy

Tests use `MOCK_OPENAI=1` for deterministic embeddings and responses:

- **chunk.test.ts**: Chunking overlap and determinism
- **retrieval.test.ts**: Hybrid SQL includes IVFFlat + trigram
- **reranker.test.ts**: Fallback reranker ordering
- **agent.test.ts**: Direct mode completion within MAX_AGENT_STEPS
- **verifier.test.ts**: Grade shape and verifyAnswer behavior

Run with `npm test` at root or `npm -w backend run test` for watch mode.

## Monitoring & Troubleshooting

### Health Check Endpoint

```bash
# Check sync status
curl http://localhost:8787/api/health | jq

# Example response:
{
  "status": "healthy",
  "postgres": { "documents": 3, "chunks": 12 },
  "qdrant": { "connected": true, "status": "green", "points": 12 },
  "sync": { "inSync": true, "drift": 0, "driftPercentage": "0%" }
}
```

**Monitoring Recommendations**:
- Call `/api/health` every 5 minutes
- Alert if `status != "healthy"` or `drift > 0`
- Track logs for "rollback" and "compensating" keywords

### Common Issues

**Drift Detected**:
```bash
# Response:
{
  "status": "degraded",
  "sync": { "inSync": false, "drift": 5 },
  "warning": "Detected 5 chunks out of sync"
}

# Troubleshoot:
1. Check Qdrant connectivity
2. Review backend logs for failed insertions
3. Consider manual reconciliation (future: POST /api/health/repair)
```

**Qdrant Connection Failed**:
```bash
# System automatically falls back to Postgres-only mode
# Health endpoint shows:
{
  "status": "degraded",
  "qdrant": { "connected": false, "error": "Network timeout" },
  "warning": "Qdrant connection failed - running on Postgres only"
}
```

**Ingestion Failures**:
- Check logs for "Qdrant insert failed for chunk..." messages
- System automatically rolls back Postgres insert
- User sees error: "Failed to sync chunk N to Qdrant after retries"
- No orphaned data - both stores remain consistent

## Production Considerations

Current implementation is "production-ready" with dual-store safeguards:

**Scaling Recommendations**:
- Replace in-memory cache with Redis Cluster for distributed deployments
- Implement real JWT/OIDC auth (currently stubbed in `middleware/security.ts`)
- Add OpenTelemetry SDK + exporters (Jaeger/Zipkin) for distributed tracing
- Deploy with Kubernetes + service mesh for multi-region
- Use connection pooling for PostgreSQL (pg-pool)
- Add `POST /api/health/repair` endpoint for automated drift repair

**Known Limitations**:
- Rate limiter is in-memory (not shared across instances)
- Token-based verification may fail on technical content with low term overlap
- Cache normalization is naive (minor query variations may miss cache)
- Classifier uses heuristics (consider LLM-based routing for complex domains)
- **Dual-Store**: Perfect consistency impossible without 2PC (current: fail-loud with compensating deletes)

## File Locations Reference

```
backend/src/
├── config/              # env.ts, constants.ts, openai.ts (mock/real), otel.ts
├── db/
│   ├── client.ts       # PostgreSQL connection pool
│   ├── qdrant.ts       # ✨ Qdrant client with retry logic
│   ├── schema.ts       # Database schema definitions
│   └── sql.ts          # Postgres queries with pgvector
├── middleware/          # security.ts (auth, rate-limit, policy stubs)
├── services/
│   ├── orchestration/  # coordinator.ts, classifier.ts, registry.ts
│   ├── cache.ts        # TTL-based caching
│   ├── embeddings.ts   # OpenAI embedding wrapper
│   ├── documents.ts    # ✨ Dual-store ingestion with compensating transactions
│   ├── retrieval.ts    # ✨ Parallel Postgres + Qdrant hybrid search
│   ├── reranker.ts     # Reranking with fallback
│   └── verifier.ts     # Verification and grading
├── routes/
│   ├── chat.ts         # SSE streaming chat endpoint
│   ├── documents.ts    # ✨ Upload/delete with dual-store sync
│   ├── feedback.ts     # User ratings
│   └── health.ts       # ✨ Sync monitoring and drift detection
├── utils/
│   └── retry.ts        # ✨ Exponential backoff retry utility
└── server.ts           # ✨ Fastify entry point with Qdrant init

backend/scripts/
├── dbSetup.mjs         # Create extensions and tables
├── dbMigrate.mjs       # Run schema migrations
└── ingestSamples.mjs   # ✨ Seed both Postgres + Qdrant

frontend/src/
├── api/                # SSE client
├── components/         # Chat, FileUpload, Feedback
├── hooks/              # useChat
└── App.tsx

shared/
└── types.ts            # SSE events, database records, API contracts
```

**✨ = Modified for dual-store integration**

## Workspace Commands

This is a pnpm/npm workspace monorepo with three packages:

```bash
# Run command in specific workspace
npm -w backend run <script>
npm -w frontend run <script>
npm -w shared run <script>

# Example: Type-check backend only
npm -w backend run typecheck
```
