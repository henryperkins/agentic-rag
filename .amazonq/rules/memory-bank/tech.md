# Technology Stack

## Programming Languages
- **TypeScript 5.6.3**: Primary language for backend, frontend, and shared code
- **JavaScript (ESM)**: Node 20+ with ES modules for scripts
- **Python 3.x**: Utility scripts (OpenAPI dereferencing)

## Frontend Stack

### Core Framework
- **React 18.3.1**: UI library with hooks and functional components
- **Vite 5.4.8**: Build tool and dev server with HMR
- **TypeScript**: Strict type checking for component props and state

### UI Libraries
- **react-markdown 10.1.0**: Markdown rendering for chat messages
- **rehype-highlight 7.0.2**: Syntax highlighting for code blocks

### Development Tools
- **@vitejs/plugin-react 4.3.4**: React Fast Refresh and JSX transform
- **Vite Dev Server**: Port 5173 with hot module replacement

## Backend Stack

### Core Framework
- **Fastify 4.28.1**: High-performance web framework
- **Node.js 20+**: Runtime with ESM support
- **TypeScript**: Strict mode with type safety

### API & Middleware
- **@fastify/cors 9.0.1**: Cross-origin resource sharing
- **@fastify/multipart 8.3.0**: File upload handling
- **dotenv 16.4.5**: Environment variable management

### AI & ML
- **openai 4.61.1**: OpenAI API client for chat and embeddings
- **@qdrant/qdrant-js 1.15.1**: Reranking with BGE model
- **Models**:
  - Chat: `gpt-4o-mini`
  - Embeddings: `text-embedding-3-small` (1536 dimensions)
  - Reranker: `BAAI/bge-reranker-base`

### Database
- **pg 8.12.0**: PostgreSQL client with connection pooling
- **PostgreSQL 16**: Primary database
- **pgvector**: Vector similarity search extension
- **pg_trgm**: Trigram-based keyword search extension

### Observability
- **@opentelemetry/api 1.8.0**: Tracing and metrics API
- **@opentelemetry/sdk-node 0.55.0**: OpenTelemetry SDK
- **@opentelemetry/auto-instrumentations-node 0.55.0**: Auto-instrumentation
- **@opentelemetry/exporter-trace-otlp-http 0.55.0**: OTLP HTTP exporter
- **@opentelemetry/semantic-conventions 1.25.0**: Standard conventions
- **@opentelemetry/resources 1.25.0**: Resource detection

### Utilities
- **uuid 11.0.3**: Unique identifier generation
- **zod 3.23.8**: Schema validation and type inference

### Development Tools
- **tsx 4.19.1**: TypeScript execution for dev server
- **vitest 2.1.4**: Unit testing framework
- **@types/node 20.11.30**: Node.js type definitions
- **@types/pg 8.15.5**: PostgreSQL type definitions

## Shared Workspace
- **zod 3.25.76**: Shared schema validation
- **TypeScript 5.6.3**: Shared type definitions for SSE events, records, feedback

## Database Technology

### PostgreSQL Extensions
- **pgvector**: Vector storage and cosine similarity search
- **pg_trgm**: Trigram-based full-text search for keyword matching
- **uuid-ossp**: UUID generation

### Indexing Strategy
- **HNSW Index**: Approximate nearest neighbor search for vectors
- **GIN Index**: Trigram index for keyword search
- **B-tree Indexes**: Primary keys and foreign keys

### Connection Management
- **Connection Pooling**: Reusable database connections
- **Graceful Shutdown**: Clean connection closure on server stop

## Build System

### Workspace Management
- **npm workspaces**: Monorepo with `backend`, `frontend`, `shared`
- **Shared Dependencies**: Hoisted to root for consistency
- **Workspace Scripts**: Coordinated build, test, and dev commands

### TypeScript Configuration
- **Strict Mode**: Enabled across all workspaces
- **ESM Modules**: `"type": "module"` in all package.json
- **Path Mapping**: Shared types accessible across workspaces

## Development Commands

### Database Setup
```bash
npm run db:setup      # Initialize extensions, tables, indexes
npm run db:migrate    # Run schema migrations
npm run ingest:samples # Seed sample documents
```

### Development Servers
```bash
npm run dev           # Start backend (8787) + frontend (5173)
npm -w backend run dev   # Backend only
npm -w frontend run dev  # Frontend only
```

### Testing
```bash
npm test              # Run all backend tests with vitest
npm -w backend run test  # Backend tests only
```

### Type Checking
```bash
npm run typecheck     # Check all workspaces
npm -w backend run typecheck   # Backend only
npm -w frontend run typecheck  # Frontend only
npm -w shared run typecheck    # Shared only
```

### Production Build
```bash
npm -w frontend run build    # Build frontend for production
npm -w frontend run preview  # Preview production build
```

## Environment Configuration

### Required Variables
```env
OPENAI_API_KEY=sk-...                    # OpenAI API key
DATABASE_URL=postgresql://...            # PostgreSQL connection string
CORS_ORIGIN=http://localhost:5173        # Frontend origin
```

### AI Model Configuration
```env
EMBEDDING_MODEL=text-embedding-3-small   # Embedding model
EMBEDDING_DIMENSIONS=1536                # Vector dimensions
CHAT_MODEL=gpt-4o-mini                   # Chat completion model
RERANKER_MODEL=BAAI/bge-reranker-base    # Reranking model
```

### Retrieval Configuration
```env
HYBRID_VECTOR_WEIGHT=0.7                 # Vector search weight
HYBRID_KEYWORD_WEIGHT=0.3                # Keyword search weight
RAG_TOP_K=5                              # Number of chunks to retrieve
CHUNK_SIZE=1000                          # Chunk size in characters
CHUNK_OVERLAP=100                        # Overlap between chunks
```

### Agent Configuration
```env
MAX_AGENT_STEPS=3                        # Maximum agent iterations
MAX_VERIFICATION_LOOPS=2                 # Maximum verification retries
MOCK_OPENAI=0                            # Use mock OpenAI for testing
```

### Web Search Configuration
```env
ENABLE_WEB_SEARCH=false                  # Enable OpenAI web search
WEB_SEARCH_CONTEXT_SIZE=medium           # low/medium/high
WEB_SEARCH_CITY=                         # Optional location filter
WEB_SEARCH_REGION=                       # Optional location filter
WEB_SEARCH_COUNTRY=                      # Optional location filter
WEB_SEARCH_TIMEZONE=                     # Optional location filter
```

## Deployment

### Docker Compose
```bash
docker compose up -d  # Start PostgreSQL 16 + pgvector
docker compose down   # Stop and remove containers
```

### Ports
- **Backend**: 8787 (Fastify API)
- **Frontend**: 5173 (Vite dev server)
- **PostgreSQL**: 5432 (Database)

### Production Readiness
- **Kubernetes**: Microservices architecture with health checks
- **Service Mesh**: Istio-compatible design
- **Load Balancing**: Horizontal scaling support
- **Monitoring**: OpenTelemetry exporters for Jaeger, Zipkin, Prometheus
- **Caching**: Redis-ready for distributed semantic caching
- **Secrets**: Vault integration points for credential management

## Testing Framework

### Vitest Configuration
- **Test Runner**: vitest 2.1.4 with watch mode
- **Coverage**: Code coverage reporting
- **Mocking**: MOCK_OPENAI=1 for offline testing

### Test Suites
- `agent.test.ts`: Agent orchestration and direct mode
- `chunk.test.ts`: Chunking overlap and determinism
- `classifier.test.ts`: Query classification logic
- `dualStore.test.ts`: Dual storage operations
- `dualStoreDeletion.test.ts`: Cascade deletion
- `dualStoreHealth.test.ts`: Health checks
- `reranker.test.ts`: Reranking with fallback
- `retrieval.test.ts`: Hybrid search (vector + keyword)
- `sqlAgent.test.ts`: SQL agent execution
- `sqlBinder.test.ts`: SQL parameter binding
- `verifier.test.ts`: Answer verification and grading
- `webOnlyMode.test.ts`: Web-only search mode
- `webSearch.test.ts`: Web search integration

## Version Requirements
- **Node.js**: >=20 (ESM support, modern JavaScript features)
- **npm**: Latest (workspace support)
- **PostgreSQL**: 16+ (pgvector compatibility)
- **Docker**: Latest (for local development)
