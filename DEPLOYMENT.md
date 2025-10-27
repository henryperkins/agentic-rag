# Deployment Guide - 14-Layer Agentic RAG System

## Prerequisites

- **Node.js** >= 20
- **Docker & Docker Compose** (for PostgreSQL with pgvector)
- **OpenAI API Key** (for embeddings and chat)

## Quick Start (Development)

```bash
# 1. Start PostgreSQL with pgvector
docker compose up -d

# 2. Install all workspace dependencies
npm install

# 3. Configure backend environment
cd backend
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY

# 4. Initialize database
npm run db:setup
npm run db:migrate

# 5. Seed sample documents
npm run ingest:samples

# 6. Start development servers (backend + frontend)
cd ..
npm run dev
```

The application will be available at:
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:8787

## Environment Configuration

### Backend (.env)

```env
# Required
OPENAI_API_KEY=sk-...

# Database
DATABASE_URL=postgresql://rag:rag@localhost:5432/ragchat

# CORS
CORS_ORIGIN=http://localhost:5173

# AI Models
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
CHAT_MODEL=gpt-4o-mini
RERANKER_MODEL=BAAI/bge-reranker-base

# Hybrid Search Weights
HYBRID_VECTOR_WEIGHT=0.7
HYBRID_KEYWORD_WEIGHT=0.3
RAG_TOP_K=5

# Document Processing
CHUNK_SIZE=1000
CHUNK_OVERLAP=100

# Agent Configuration
MAX_AGENT_STEPS=3
MAX_VERIFICATION_LOOPS=2

# Testing
MOCK_OPENAI=0  # Set to 1 for offline testing
```

## Production Deployment

### Option 1: Docker Containers

1. **Build containers**:
```bash
# Backend
cd backend
docker build -t rag-chat-backend .

# Frontend
cd ../frontend
docker build -t rag-chat-frontend .
```

2. **Run with docker-compose** (production variant):
```yaml
# docker-compose.prod.yml
version: "3.9"
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: ragchat
    volumes:
      - pgdata:/var/lib/postgresql/data
    networks:
      - ragnet

  backend:
    image: rag-chat-backend
    environment:
      DATABASE_URL: postgresql://${DB_USER}:${DB_PASSWORD}@postgres:5432/ragchat
      OPENAI_API_KEY: ${OPENAI_API_KEY}
    ports:
      - "8787:8787"
    depends_on:
      - postgres
    networks:
      - ragnet

  frontend:
    image: rag-chat-frontend
    ports:
      - "5173:5173"
    depends_on:
      - backend
    networks:
      - ragnet

volumes:
  pgdata:

networks:
  ragnet:
```

### Option 2: Kubernetes

1. **Create namespace**:
```bash
kubectl create namespace rag-chat
```

2. **Deploy PostgreSQL** (with persistent volume):
```yaml
# postgres-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres
  namespace: rag-chat
spec:
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
      - name: postgres
        image: pgvector/pgvector:pg16
        env:
        - name: POSTGRES_USER
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: username
        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: password
        - name: POSTGRES_DB
          value: "ragchat"
        volumeMounts:
        - name: postgres-storage
          mountPath: /var/lib/postgresql/data
      volumes:
      - name: postgres-storage
        persistentVolumeClaim:
          claimName: postgres-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: rag-chat
spec:
  selector:
    app: postgres
  ports:
  - port: 5432
    targetPort: 5432
```

3. **Deploy backend**:
```yaml
# backend-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
  namespace: rag-chat
spec:
  replicas: 3
  selector:
    matchLabels:
      app: backend
  template:
    metadata:
      labels:
        app: backend
    spec:
      containers:
      - name: backend
        image: rag-chat-backend:latest
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: app-config
              key: database-url
        - name: OPENAI_API_KEY
          valueFrom:
            secretKeyRef:
              name: app-config
              key: openai-api-key
        ports:
        - containerPort: 8787
---
apiVersion: v1
kind: Service
metadata:
  name: backend
  namespace: rag-chat
spec:
  selector:
    app: backend
  ports:
  - port: 8787
    targetPort: 8787
```

4. **Deploy frontend** with Ingress:
```yaml
# frontend-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: rag-chat
spec:
  replicas: 2
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      containers:
      - name: frontend
        image: rag-chat-frontend:latest
        ports:
        - containerPort: 5173
---
apiVersion: v1
kind: Service
metadata:
  name: frontend
  namespace: rag-chat
spec:
  selector:
    app: frontend
  ports:
  - port: 80
    targetPort: 5173
```

## Layer-Specific Configuration

### Layer 10: Observability (OpenTelemetry)

To enable full observability, install OTEL SDK and exporters:

```bash
npm install --save @opentelemetry/sdk-node @opentelemetry/exporter-jaeger
```

Update `backend/src/config/otel.ts`:
```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';

const sdk = new NodeSDK({
  traceExporter: new JaegerExporter({
    endpoint: 'http://localhost:14268/api/traces',
  }),
});

sdk.start();
```

### Layer 11: Security Enhancements

**OAuth2/OIDC Integration**:
```typescript
// backend/src/middleware/security.ts
import { Issuer } from 'openid-client';

const issuer = await Issuer.discover('https://your-auth-provider.com');
const client = new issuer.Client({
  client_id: process.env.OAUTH_CLIENT_ID,
  client_secret: process.env.OAUTH_CLIENT_SECRET,
});
```

**OPA Policy Integration**:
```typescript
import { OPA } from '@open-policy-agent/opa-wasm';

export async function policyCheck(subject: any, action: string, resource: string) {
  const result = await opa.evaluate('allow', { subject, action, resource });
  return result;
}
```

### Layer 7/9: Redis Cache (Production)

Replace in-memory cache with Redis:

```bash
npm install redis
```

```typescript
// backend/src/services/cache.ts
import { createClient } from 'redis';

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

export async function getCached(key: string) {
  return await redis.get(key);
}

export async function setCached(key: string, value: string, ttl = 300) {
  await redis.setEx(key, ttl, value);
}
```

## Monitoring & Alerts

### Prometheus Metrics

```typescript
// Add to backend
import { register, Counter, Histogram } from 'prom-client';

const requestCounter = new Counter({
  name: 'rag_requests_total',
  help: 'Total RAG requests',
  labelNames: ['route', 'status']
});

const latencyHistogram = new Histogram({
  name: 'rag_request_duration_seconds',
  help: 'Request latency',
  buckets: [0.1, 0.5, 1, 2, 5, 10]
});
```

### Grafana Dashboard

Import the included `grafana-dashboard.json` or create dashboards for:
- Request throughput
- P50/P95/P99 latencies
- Cache hit rates
- LLM token usage & costs
- Verification success rates

## Scaling Considerations

### Horizontal Scaling
- Backend: 3+ replicas behind load balancer
- Frontend: 2+ replicas with CDN
- Database: Read replicas for retrieval queries

### Vertical Scaling
- Vector DB: Dedicated instances with GPU for large datasets
- Cache: Redis Cluster for distributed caching
- LLM serving: vLLM or TensorRT-LLM for self-hosted models

## Testing

```bash
# Unit tests (backend)
npm -w backend test

# Type checking (all workspaces)
npm run typecheck

# E2E tests (add Playwright)
npm run test:e2e
```

## Troubleshooting

### Database Connection Issues
```bash
# Check PostgreSQL is running
docker ps | grep postgres

# Test connection
psql postgresql://rag:rag@localhost:5432/ragchat

# Check extensions
psql -c "SELECT * FROM pg_extension WHERE extname IN ('vector', 'pg_trgm');"
```

### OpenAI API Issues
```bash
# Test with MOCK_OPENAI=1 for offline development
export MOCK_OPENAI=1
npm run dev
```

### SSE Streaming Issues
- Check CORS configuration
- Verify `X-Accel-Buffering: no` header
- Test with curl:
  ```bash
  curl -N -X POST http://localhost:8787/api/chat \
    -H "Content-Type: application/json" \
    -d '{"message":"test","useRag":true}'
  ```

## Next Steps

1. **Security Hardening**: Integrate real OAuth2, OPA policies, Vault for secrets
2. **Observability**: Add OTEL SDK, Jaeger/Zipkin, Prometheus exporters
3. **Caching**: Migrate to Redis Cluster
4. **Evaluation**: Integrate RAGAS, set up A/B testing, implement RLHF pipeline
5. **Service Mesh**: Deploy Istio/Linkerd for advanced traffic management

---

For issues and contributions, see the main [README.md](./README.md)
