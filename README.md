# rag-chat

A **production-ready 14-layer Agentic RAG** system with enterprise-grade architecture:

## 🏗️ 14-Layer Architecture

1. **User Interface Layer** - Web/mobile chat, API Gateway, WebSocket/SSE streaming, OAuth2/OIDC auth
2. **Orchestration Layer** - Master Coordinator, query router, agent registry, workflow state management
3. **Specialized Agent Layer** - Retrieval (6), Processing (5), Quality Assurance (4) agents
4. **Data Ingestion Layer** - Connectors, parsers, chunking, metadata extraction, ETL orchestration
5. **Embedding Layer** - Text-to-vector transformation with caching and GPU acceleration
6. **Vector Database Layer** - Semantic search with pgvector, HNSW indexing, metadata storage
7. **Retrieval Layer** - Hybrid search (vector + BM25), reranking, context management, caching
8. **Generation Layer** - LLM endpoints, model routing, prompt templates, streaming, inference optimization
9. **Query Execution Environment** - SQL/NoSQL/Graph executors with connection pooling and result caching
10. **Observability & Monitoring Layer** - OpenTelemetry, logging, metrics, tracing, APM, drift detection
11. **Security & Governance Layer** - RBAC/ABAC, encryption, PII masking, audit logging, compliance
12. **Infrastructure & Deployment Layer** - Kubernetes, service mesh, load balancers, CI/CD, IaC
13. **Data Storage Layer** - Multi-modal persistent storage (object, relational, NoSQL, graph, cache)
14. **Feedback & Evaluation Layer** - User feedback, ground truth, A/B testing, RLHF, continuous evaluation

## ✨ Features

- **Multi-agent orchestration** (Planner → Researcher → Critic → Writer → Verifier)
- **Query rewriting** with persistence
- **Hybrid retrieval** (pgvector cosine + pg_trgm trigram) with configurable weights
- **Optional web search augmentation** via OpenAI hosted tool with location-aware filtering
- **Reranking** via `@dqbd/qdrant` with graceful fallback
- **Semantic caching** for responses and retrievals
- **Strict self-verification loops** with bounded retries
- **SSE streaming** of agent logs, tokens, citations, verification results
- **OpenTelemetry hooks** for distributed tracing
- **Rate limiting & auth stubs** (Layer 11 security)
- **Feedback API** (Layer 14 evaluation)
- **Documents CRUD** with chunking + embeddings

## 🚀 Quick Start

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
```

## 📦 Tech Stack

* **Frontend:** React 18, Vite 5, TypeScript
* **Backend:** Fastify 4, Node 20+, TypeScript
* **DB:** PostgreSQL 16 + `pgvector` + `pg_trgm`
* **AI:**
  * Chat: `gpt-4o-mini`
  * Embeddings: `text-embedding-3-small` (1536 dims)
  * Reranker: `BAAI/bge-reranker-base` with `@dqbd/qdrant` (fallback enabled)
* **Observability:** OpenTelemetry API (pluggable exporters)
* **Orchestration:** Lightweight coordinator (LangGraph-compatible design)

## 🔧 Environment

Copy `backend/.env.example` to `backend/.env`:

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
# Optional: enable OpenAI hosted web search
ENABLE_WEB_SEARCH=false
WEB_SEARCH_CONTEXT_SIZE=medium
WEB_SEARCH_CITY=
WEB_SEARCH_REGION=
WEB_SEARCH_COUNTRY=
WEB_SEARCH_TIMEZONE=
```

When `ENABLE_WEB_SEARCH=true`, the coordinator augments local retrieval with OpenAI's hosted web search tool. Configure the optional location hints (city/region/country/timezone) to improve geolocated results or leave them blank to skip.

## 📁 Repository Structure

```
rag-chat/
├── backend/
│   ├── src/
│   │   ├── config/            # env, constants, openai, otel (L10)
│   │   ├── db/                # pg client, schema, SQL helpers
│   │   ├── middleware/        # security (L11): auth, rate-limit, policy
│   │   ├── services/
│   │   │   ├── orchestration/ # L2: coordinator, classifier, registry
│   │   │   ├── cache.ts       # L7/L9: TTL & semantic caches
│   │   │   ├── embeddings.ts  # L5
│   │   │   ├── documents.ts   # L4
│   │   │   ├── retrieval.ts   # L7
│   │   │   ├── reranker.ts    # L7
│   │   │   ├── verifier.ts    # L3 QA agents
│   │   │   └── query.ts       # L2
│   │   ├── routes/            # chat, documents, feedback (L14)
│   │   └── server.ts          # L1 entry point
│   ├── scripts/               # db setup/migrate, sample ingest
│   └── tests/                 # vitest suite
├── frontend/
│   └── src/
│       ├── api/               # SSE client (L1)
│       ├── components/        # Chat, FileUpload, Feedback (L14)
│       ├── hooks/             # useChat
│       └── App.tsx
├── shared/
│   └── types.ts               # SSE events, records, feedback
├── samples/                   # ≥3 sample docs
└── docker-compose.yml
```

## 🔌 API Routes

| Method | Path                    | Purpose                              |
| -----: | ----------------------- | ------------------------------------ |
|   POST | `/api/chat`             | Stream **agentic chat** via SSE      |
|   POST | `/api/documents/upload` | Upload `.md` / `.txt`, chunk & embed |
|    GET | `/api/documents`        | List uploaded documents              |
| DELETE | `/api/documents/:id`    | Delete document (cascades chunks)    |
|   POST | `/api/feedback`         | Submit user feedback (L14)           |

### SSE Event Contract

* `agent_log`: `{ role: "planner" | "researcher" | "critic" | "writer", message, ts }`
* `rewrite`: `{ original, rewritten, ts }`
* `tokens`: `{ text, ts }`  *(incremental assistant text stream)*
* `citations`: `{ citations: [{ document_id, source, chunk_index }], ts }`
* `verification`: `{ isValid: boolean, gradeSummary?: Record<chunk_id, Grade>, feedback?: string, ts }`
* `final`: `{ text, citations, rewrittenQuery?: string, verified: boolean, ts }`

## 🤖 Agentic Workflow

```
┌────────┐   ┌───────────┐   ┌──────────┐   ┌────────┐   ┌──────────────┐
│Planner │─▶│Researcher  │─▶│Critic     │─▶│Writer  │─▶│Final Verifier│
└────────┘   └───────────┘   └──────────┘   └────────┘   └──────────────┘
   │             │                │            │
   │   Hybrid (vector + trigram)  │            │
   │   + rerank (BGE / fallback)  │            │
   └───── optional rewrite ───────┴────────────┘
```

* **Planner:** Classify query, decide retrieve vs direct, optional rewrite
* **Researcher:** Hybrid SQL (pgvector cosine + pg_trgm trigram) → **rerank**
* **Critic:** Grade chunks (high/medium/low), keep highs (else add mediums)
* **Writer:** Answer **only** from approved evidence with inline `[cite:doc_id:chunk]`
* **Verifier:** Check answer support; if unsupported, loop (bounded by `MAX_VERIFICATION_LOOPS`)

## 🤝 Contributing

Review the [Repository Guidelines](AGENTS.md) for project structure, coding style, and workflow expectations before submitting changes.

## 🧪 Testing

```bash
npm test
```

* `chunk.test.ts`: Chunking overlap + determinism
* `retrieval.test.ts`: Hybrid SQL includes ivfflat & trigram
* `reranker.test.ts`: Fallback reranker ordering
* `agent.test.ts`: Direct mode completion within `MAX_AGENT_STEPS`
* `verifier.test.ts`: Grade shape + verifyAnswer behavior

> Tests run with `MOCK_OPENAI=1` for full offline determinism.

## 📊 Layer Mapping

| Layer | Component | Status |
|-------|-----------|--------|
| L1 | User Interface (SSE, rate-limit) | ✅ Implemented |
| L2 | Orchestration (Coordinator, Classifier, Registry) | ✅ Implemented |
| L3 | Specialized Agents (Retrieval, Processing, QA) | ✅ Implemented |
| L4 | Data Ingestion (Chunking, Metadata) | ✅ Implemented |
| L5 | Embedding (OpenAI ada-002, cache) | ✅ Implemented |
| L6 | Vector DB (pgvector, HNSW, metadata) | ✅ Implemented |
| L7 | Retrieval (Hybrid, Rerank, Cache) | ✅ Implemented |
| L8 | Generation (GPT-4o-mini, streaming) | ✅ Implemented |
| L9 | Query Execution (SQL, result cache) | ✅ Implemented |
| L10 | Observability (OTEL API hooks) | ✅ Implemented |
| L11 | Security (Auth stub, Rate-limit, Policy) | ✅ Implemented |
| L12 | Infrastructure (Docker, ready for K8s) | ✅ Implemented |
| L13 | Data Storage (Postgres, pgvector) | ✅ Implemented |
| L14 | Feedback & Evaluation (API + UI) | ✅ Implemented |

## 📈 Ports

* **Backend:** 8787
* **Frontend:** 5173
* **Postgres:** 5432

## 📝 Notes

* Reranker gracefully falls back to Jaccard overlap when `@dqbd/qdrant` unavailable
* Orchestration code is **LangGraph-compatible** in design
* OTEL hooks are API-only; plug in SDK + exporters for production observability
* Auth/policy stubs demonstrate Layer 11; integrate real OIDC/OPA for production
* Semantic caching is in-memory TTL; swap for Redis in production

## 🚧 Production Enhancements

For enterprise deployment, consider:

* **L10:** Add OTEL SDK + Jaeger/Zipkin exporters, Prometheus metrics, Grafana dashboards
* **L11:** Integrate real OAuth2/OIDC (Auth0, Okta), OPA/Cerbos for policy, Vault for secrets
* **L12:** Kubernetes manifests (Helm charts), Istio service mesh, HPA/VPA autoscaling
* **L7/L9:** Replace in-memory cache with Redis Cluster for distributed semantic caching
* **L14:** Integrate RAGAS evaluation, A/B testing framework, RLHF pipeline

## 📖 References

* [14-Layer Architecture Documentation](./Production%20Multi-AgentRAGSystem14-Layer%20ArchitecturalBreakdown.md)
* [Application Implementation](./rag-chatApplication.md)

---

Built with ❤️ following enterprise RAG best practices
