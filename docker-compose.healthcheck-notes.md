# Qdrant Healthcheck Notes

## Issue
The official `qdrant/qdrant:latest` image does not include `curl` or `wget`, causing Docker healthchecks to fail.

## Current Solution
Healthcheck is disabled in `docker-compose.yml` since:
1. You're using **Qdrant Cloud** for production (which has built-in monitoring)
2. The local Docker instance is for development only
3. The service is accessible and functional despite the missing healthcheck

## Alternative: Enable Healthcheck with Custom Image

If you need a working healthcheck, create a custom Dockerfile:

### Option 1: Install curl in extended image
```dockerfile
# Dockerfile.qdrant
FROM qdrant/qdrant:latest
USER root
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
USER qdrant
```

Then update `docker-compose.yml`:
```yaml
qdrant:
  build:
    context: .
    dockerfile: Dockerfile.qdrant
  container_name: ragchat-qdrant
  # ... rest of config
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:6333/healthz"]
    interval: 5s
    timeout: 5s
    retries: 10
```

### Option 2: Use wget (if available in future images)
```yaml
healthcheck:
  test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:6333/healthz"]
```

## Verification
Check Qdrant is running:
```bash
# From host machine
curl http://localhost:6333/healthz
# Should return: "healthz check passed"

# Check service info
curl http://localhost:6333/
# Should return: {"title":"qdrant - vector search engine","version":"..."}
```
