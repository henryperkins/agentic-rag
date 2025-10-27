# Project Structure

## Directory Organization

### Root Structure
```
rag-chat/
├── backend/          # Fastify API server (Layer 1-13)
├── frontend/         # React + Vite UI (Layer 1)
├── shared/           # Shared TypeScript types
├── samples/          # Sample documents for ingestion
├── docs/             # Architecture documentation
├── .amazonq/         # Amazon Q configuration and rules
└── docker-compose.yml # PostgreSQL + pgvector setup
```

### Backend Architecture (`backend/`)
```
backend/
├── src/
│   ├── config/           # Environment, constants, OpenAI client, OTEL (L10)
│   ├── db/               # PostgreSQL client, schema, SQL helpers (L6, L13)
│   ├── middleware/       # Security layer: auth, rate-limit, policy (L11)
│   ├── routes/           # API endpoints: chat, documents, feedback (L1, L14)
│   ├── services/
│   │   ├── orchestration/  # L2: coordinator, classifier, agent registry
│   │   ├── cache.ts        # L7/L9: TTL & semantic caches
│   │   ├── embeddings.ts   # L5: Text-to-vector transformation
│   │   ├── documents.ts    # L4: Document ingestion & chunking
│   │   ├── retrieval.ts    # L7: Hybrid search (vector + keyword)
│   │   ├── reranker.ts     # L7: BGE reranker with fallback
│   │   ├── verifier.ts     # L3: QA agents for answer verification
│   │   ├── query.ts        # L2: Query processing
│   │   └── github.ts       # GitHub integration service
│   ├── types/          # TypeScript type definitions
│   ├── utils/          # Utility functions
│   └── server.ts       # L1: Fastify entry point
├── scripts/
│   ├── dbSetup.mjs     # Database initialization (extensions, tables)
│   ├── dbMigrate.mjs   # Schema migrations
│   └── ingestSamples.mjs # Sample document ingestion
└── tests/              # Vitest test suite (13 test files)
```

### Frontend Architecture (`frontend/`)
```
frontend/
├── src/
│   ├── api/            # SSE client for streaming chat (L1)
│   ├── components/     # React components: Chat, FileUpload, Feedback (L14)
│   ├── hooks/          # Custom React hooks: useChat
│   ├── App.tsx         # Main application component
│   ├── main.tsx        # React entry point
│   └── styles.css      # Global styles
├── index.html          # HTML template
└── vite.config.ts      # Vite configuration
```

### Shared Types (`shared/`)
```
shared/
├── types.ts            # SSE events, database records, feedback schemas
├── package.json        # Shared workspace configuration
└── tsconfig.json       # Shared TypeScript config
```

## Core Components & Relationships

### Layer 1: User Interface
- **Frontend**: React 18 + Vite 5 for chat UI, file upload, feedback submission
- **API Gateway**: Fastify 4 with CORS, multipart support
- **Streaming**: SSE (Server-Sent Events) for real-time agent logs, tokens, citations
- **Authentication**: OAuth2/OIDC stubs (production-ready integration points)

### Layer 2: Orchestration
- **Coordinator** (`services/orchestration/coordinator.ts`): Master orchestrator managing agent workflow
- **Classifier** (`services/orchestration/classifier.ts`): Query classification (retrieve vs direct mode)
- **Agent Registry** (`services/orchestration/registry.ts`): Agent lifecycle management
- **Workflow State**: Manages multi-step agent execution with bounded retries

### Layer 3: Specialized Agents
- **Retrieval Agents**: Planner (query classification), Researcher (hybrid search + rerank)
- **Processing Agents**: Critic (evidence grading), Writer (answer generation)
- **QA Agents**: Verifier (answer validation, grounding checks)

### Layer 4: Data Ingestion
- **Document Service** (`services/documents.ts`): Upload, parse, chunk documents
- **Chunking**: Configurable size (1000) and overlap (100) for optimal retrieval
- **Metadata Extraction**: Automatic source, timestamp, format capture
- **ETL Orchestration**: Batch processing via `ingestSamples.mjs`

### Layer 5: Embedding
- **Embedding Service** (`services/embeddings.ts`): OpenAI text-embedding-3-small (1536 dims)
- **Caching**: In-memory TTL cache for repeated embeddings
- **GPU Acceleration**: Ready for production GPU inference

### Layer 6: Vector Database
- **PostgreSQL 16 + pgvector**: Semantic search with cosine similarity
- **HNSW Indexing**: Fast approximate nearest neighbor search
- **Metadata Storage**: Document and chunk metadata in relational tables
- **Schema**: `documents`, `chunks`, `embeddings` tables with foreign keys

### Layer 7: Retrieval
- **Hybrid Search** (`services/retrieval.ts`): Combines vector (pgvector) + keyword (pg_trgm)
- **Configurable Weights**: HYBRID_VECTOR_WEIGHT (0.7) + HYBRID_KEYWORD_WEIGHT (0.3)
- **Reranking** (`services/reranker.ts`): BAAI/bge-reranker-base with Jaccard fallback
- **Context Management**: Top-K retrieval (RAG_TOP_K=5)
- **Semantic Caching**: Cache retrieval results for identical queries

### Layer 8: Generation
- **LLM Endpoints**: OpenAI GPT-4o-mini for chat completion
- **Model Routing**: Configurable model selection via CHAT_MODEL env var
- **Prompt Templates**: Agent-specific system prompts (Planner, Researcher, Critic, Writer, Verifier)
- **Streaming**: Token-by-token streaming via SSE
- **Inference Optimization**: Response caching, prompt compression

### Layer 9: Query Execution Environment
- **SQL Executor** (`db/`): PostgreSQL connection pooling
- **Result Caching**: In-memory cache for query results
- **Connection Management**: Graceful connection handling and retries

### Layer 10: Observability & Monitoring
- **OpenTelemetry** (`config/otel.ts`): Distributed tracing API hooks
- **Logging**: Structured logging for agent activity, retrieval, verification
- **Metrics**: Cache hits, agent steps, verification loops
- **Tracing**: Request flow through orchestration layers
- **APM Ready**: Pluggable exporters for Jaeger, Zipkin, Prometheus

### Layer 11: Security & Governance
- **Middleware** (`middleware/`): Auth, rate-limit, policy enforcement
- **RBAC/ABAC**: Role and attribute-based access control stubs
- **Encryption**: TLS-ready, secrets management integration points
- **PII Masking**: Placeholder for sensitive data handling
- **Audit Logging**: Request/response logging for compliance

### Layer 12: Infrastructure & Deployment
- **Docker Compose**: Local development with PostgreSQL + pgvector
- **Kubernetes Ready**: Microservices architecture, health checks
- **Service Mesh**: Istio-compatible design
- **Load Balancers**: Horizontal scaling support
- **CI/CD**: GitHub Actions integration points
- **IaC**: Infrastructure as Code ready (Terraform, CloudFormation)

### Layer 13: Data Storage
- **PostgreSQL 16**: Primary relational database
- **pgvector Extension**: Vector storage and similarity search
- **pg_trgm Extension**: Trigram-based keyword search
- **Object Storage Ready**: S3-compatible document storage integration points
- **Cache Layer**: In-memory TTL cache (Redis-ready)

### Layer 14: Feedback & Evaluation
- **Feedback API** (`routes/feedback.ts`): User feedback collection
- **Ground Truth**: Feedback storage for model evaluation
- **A/B Testing Ready**: Framework for experiment tracking
- **RLHF Pipeline**: Reinforcement learning from human feedback integration points
- **Continuous Evaluation**: RAGAS-compatible evaluation framework

## Architectural Patterns

### Multi-Agent Workflow
```
User Query → Planner → Researcher → Critic → Writer → Verifier → Response
              ↓           ↓           ↓         ↓         ↓
         Classify    Hybrid      Grade     Generate  Validate
                    Retrieve    Evidence   Answer    Grounding
                    + Rerank
```

### Data Flow
```
Document Upload → Chunking → Embedding → Vector DB
                                            ↓
User Query → Query Rewrite → Hybrid Search → Rerank → Context
                                                         ↓
                                                    LLM Generation
                                                         ↓
                                                    Verification
                                                         ↓
                                                    SSE Stream
```

### Caching Strategy
- **Semantic Cache**: Hash query embeddings for response reuse
- **Retrieval Cache**: Cache hybrid search results
- **Embedding Cache**: Cache text-to-vector transformations
- **TTL Management**: Configurable expiration for all cache layers

### Error Handling
- **Graceful Degradation**: Reranker fallback, web search fallback
- **Bounded Retries**: MAX_AGENT_STEPS (3), MAX_VERIFICATION_LOOPS (2)
- **Circuit Breakers**: Ready for production resilience patterns
- **Fallback Strategies**: Direct mode when retrieval fails

## Workspace Configuration
- **Monorepo**: npm workspaces with `backend`, `frontend`, `shared`
- **TypeScript**: Strict mode, shared tsconfig base
- **Node 20+**: Modern JavaScript features, ESM modules
- **Concurrent Dev**: Backend (8787) + Frontend (5173) via concurrently
