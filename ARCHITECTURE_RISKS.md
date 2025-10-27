# Architecture Risks & Recommendations

## Critical Issues

### 1. Semantic Grading Never Receives Embeddings
**Location:** `coordinator.ts:247-256`

**Problem:** `gradeChunksWithScores` is called with `undefined` for query embeddings, forcing keyword-only grading even when `USE_SEMANTIC_GRADING=true`.

**Impact:** Degraded relevance filtering, especially for semantic queries.

**Fix:**
```typescript
// In coordinator.ts, compute embedding once during retrieval
const qEmb = opts.useRag ? await embedText(working) : undefined;

// Pass to grading
const { grades: gradeResult, metadata } = await Agents.processing.gradeChunksWithScores(
  working,
  retrieved.map((r) => ({ id: r.id, content: r.content })),
  qEmb // Thread through query embedding
);
```

---

### 2. Stale Failure Cache After Document Ingestion
**Location:** `coordinator.ts:340`, `constants.ts:CACHE_FAILURES`

**Problem:** "No evidence found" responses cache for 5min by default. New documents won't be discovered until cache expires.

**Impact:** Poor UX—users see stale "no results" after uploading relevant docs.

**Recommendations:**
- **Option A:** Set `CACHE_FAILURES=false` (default) to never cache failures
- **Option B:** Invalidate response cache on document ingestion:
  ```typescript
  // In documents.ts after successful ingest
  responseCache.clear(); // Add clear() method to TTLCache
  ```
- **Option C:** Reduce failure cache TTL to 30s

---

### 3. Query Rewriting Flag Exists But Never Used
**Location:** `constants.ts:ENABLE_QUERY_REWRITING`, `query.ts:maybeRewriteQuery`

**Problem:** `ENABLE_QUERY_REWRITING` flag and rewrite logic exist but coordinator never invokes them.

**Impact:** Misleading configuration; users expect rewriting when enabled.

**Fix:**
```typescript
// In coordinator.ts before retrieval loop
if (ENABLE_QUERY_REWRITING && loops === 0) {
  const { rewritten, reason } = maybeRewriteQuery(message);
  if (rewritten) {
    working = rewritten;
    await persistRewrite(message, rewritten);
    sender({ type: "rewrite", original: message, rewritten, ts: Date.now() });
  }
}
```

---

### 4. Conservative SQL Agent Defaults
**Location:** `constants.ts:SQL_AGENT_MAX_ROWS=50`, `SQL_AGENT_TIMEOUT_MS=400`

**Problem:** 400ms timeout may be too aggressive for complex queries; 50 rows may be insufficient for aggregations.

**Recommendations:**
- Increase timeout to 2000ms for production
- Increase max rows to 100-200 for trend queries
- Add query complexity estimation to adjust limits dynamically

---

### 5. Missing Integration Test Coverage
**Problem:** No end-to-end tests for:
- Verification loop retries (`MAX_VERIFICATION_LOOPS`)
- Web metadata streaming events
- Dual-store sync failures
- Cache invalidation flows

**Recommendation:** Add `coordinator.integration.test.ts`:
```typescript
describe("Coordinator Integration", () => {
  it("should retry on verification failure", async () => {
    // Mock low-quality chunks, verify loop count
  });
  
  it("should stream web metadata events", async () => {
    // Capture SSE events, assert web_search_metadata
  });
});
```

---

## Minor Issues

### 6. Retrieval Cache Skips Web Search Unconditionally
**Location:** `coordinator.ts:127`

**Problem:** `canUseCache = !(allowWeb && decision.targets.includes("web"))` disables cache even when web search isn't actually invoked.

**Impact:** Cache misses for queries that could use web but don't trigger it.

**Fix:** Only skip cache if web search actually runs:
```typescript
// Move cache write decision after web search
if (!usedWeb) {
  retrievalCache.set(cacheKey, retrieved);
}
```

---

### 7. Direct Mode Bypasses All Processing
**Location:** `coordinator.ts:91-96`

**Problem:** Direct mode returns trivial echo response instead of using LLM for simple queries.

**Impact:** Poor UX for greetings, calculations, etc.

**Recommendation:** Invoke LLM for direct mode:
```typescript
if (decision.mode === "direct") {
  const text = await openaiClient.chat([
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: message }
  ]);
  // Stream response...
}
```

---

## Configuration Recommendations

### Production `.env` Adjustments
```env
# Grading
USE_SEMANTIC_GRADING=true  # Enable hybrid grading
GRADE_HIGH_THRESHOLD=0.5
GRADE_MEDIUM_THRESHOLD=0.2

# Verification
VERIFICATION_THRESHOLD=0.5
ALLOW_LOW_GRADE_FALLBACK=false  # Strict quality

# Caching
CACHE_FAILURES=false  # Don't cache "no results"

# SQL Agent
SQL_AGENT_TIMEOUT_MS=2000
SQL_AGENT_MAX_ROWS=100

# Query Processing
ENABLE_QUERY_REWRITING=true  # After wiring in coordinator
USE_LLM_CLASSIFIER=true  # Better routing
```

---

## Action Items (Priority Order)

1. **HIGH:** Fix semantic grading embedding pass-through
2. **HIGH:** Set `CACHE_FAILURES=false` or add cache invalidation
3. **MEDIUM:** Wire query rewriting or remove flag
4. **MEDIUM:** Increase SQL agent timeouts for production
5. **LOW:** Add integration tests for verification loops
6. **LOW:** Improve direct mode with LLM responses
