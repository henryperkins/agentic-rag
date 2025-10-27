# Product Overview

## Project Purpose
rag-chat is a production-ready 14-layer Agentic RAG (Retrieval-Augmented Generation) system designed for enterprise-grade conversational AI applications. It combines multi-agent orchestration, hybrid retrieval, semantic caching, and self-verification to deliver accurate, citation-backed responses from both local document corpus and optional web search.

## Value Proposition
- **Enterprise Architecture**: Implements all 14 layers of production RAG systems (UI, orchestration, agents, ingestion, embedding, vector DB, retrieval, generation, query execution, observability, security, infrastructure, storage, feedback)
- **Intelligent Multi-Agent System**: Coordinates specialized agents (Planner → Researcher → Critic → Writer → Verifier) for high-quality responses
- **Hybrid Retrieval**: Combines vector similarity (pgvector) with keyword matching (pg_trgm) for superior recall
- **Quality Assurance**: Built-in verification loops with bounded retries ensure answer accuracy and grounding
- **Real-Time Streaming**: SSE-based streaming of agent logs, tokens, citations, and verification results
- **Production-Ready**: Includes observability hooks, rate limiting, auth stubs, feedback API, and semantic caching

## Key Features

### Core Capabilities
- **Multi-Agent Orchestration**: Planner classifies queries, Researcher retrieves and reranks, Critic grades evidence, Writer generates answers, Verifier ensures accuracy
- **Query Rewriting**: Automatic query optimization with persistence for improved retrieval
- **Hybrid Retrieval**: Configurable weights for vector (cosine similarity) and keyword (trigram) search
- **Reranking**: Uses BAAI/bge-reranker-base via @dqbd/qdrant with graceful Jaccard fallback
- **Web Search Augmentation**: Optional OpenAI hosted web search with location-aware filtering for recency queries
- **Semantic Caching**: Response and retrieval caching to reduce latency and API costs
- **Self-Verification**: Strict verification loops check answer grounding with bounded retries
- **Citation Tracking**: Inline citations with document ID and chunk index for transparency

### Document Management
- **CRUD Operations**: Upload, list, and delete documents via REST API
- **Smart Chunking**: Configurable chunk size (1000) and overlap (100) for optimal retrieval
- **Automatic Embedding**: Text-to-vector transformation using OpenAI text-embedding-3-small (1536 dims)
- **Metadata Extraction**: Automatic metadata capture during ingestion
- **Supported Formats**: Markdown (.md) and text (.txt) files

### Observability & Monitoring
- **OpenTelemetry Integration**: Distributed tracing hooks (API-only, pluggable exporters)
- **Real-Time Logging**: Agent activity, retrieval metrics, verification results via SSE
- **Performance Metrics**: Configurable monitoring for latency, cache hits, and agent steps

### Security & Governance
- **Rate Limiting**: Request throttling to prevent abuse
- **Authentication Stubs**: OAuth2/OIDC integration points for production
- **Policy Framework**: RBAC/ABAC foundation for access control
- **Audit Logging**: Feedback API for continuous evaluation (Layer 14)

## Target Users

### Primary Users
- **Enterprise Developers**: Building production RAG systems with full architectural control
- **AI Engineers**: Implementing multi-agent orchestration and hybrid retrieval strategies
- **DevOps Teams**: Deploying scalable, observable AI applications with Kubernetes readiness

### Use Cases
- **Knowledge Base Q&A**: Answer questions from internal documentation with citations
- **Customer Support**: Augment support agents with accurate, grounded responses
- **Research Assistance**: Combine local corpus with web search for comprehensive answers
- **Compliance & Audit**: Track answer provenance with citation trails and verification logs
- **Continuous Learning**: Collect feedback for model improvement and evaluation (RLHF-ready)

## Technical Highlights
- **Stack**: React 18 + Vite 5 (frontend), Fastify 4 + Node 20+ (backend), PostgreSQL 16 + pgvector
- **AI Models**: GPT-4o-mini (chat), text-embedding-3-small (embeddings), BAAI/bge-reranker-base (reranking)
- **Architecture**: LangGraph-compatible orchestration design, microservices-ready
- **Deployment**: Docker Compose for local dev, Kubernetes-ready for production
