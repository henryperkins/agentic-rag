# Development Guidelines

## Code Quality Standards

### Formatting and Structure
- **Indentation**: 2 spaces for TypeScript/JavaScript, 4 spaces for Python
- **Line Width**: 100 characters maximum (Python), flexible for TypeScript
- **Semicolons**: Required in TypeScript/JavaScript
- **Quotes**: Double quotes for strings in TypeScript, single quotes in Python
- **Trailing Commas**: Used in multi-line arrays and objects
- **Import Organization**: Group imports by type (external, internal, types)

### Naming Conventions
- **Variables/Functions**: camelCase (e.g., `embedTexts`, `hybridRetrieve`, `runCoordinator`)
- **Types/Interfaces**: PascalCase (e.g., `GitHubFile`, `SSEOutEvent`, `DocumentRecord`)
- **Constants**: SCREAMING_SNAKE_CASE (e.g., `MAX_VERIFICATION_LOOPS`, `CHUNK_SIZE`, `RAG_TOP_K`)
- **Private Methods**: Prefix with underscore (e.g., `_resolve_node`, `_load_doc`, `_parse_component_pointer`)
- **File Names**: camelCase for TypeScript (e.g., `coordinator.ts`, `github.ts`), snake_case for Python (e.g., `deref_openapi.py`)

### Documentation Standards
- **File Headers**: Include layer designation for backend files (e.g., `// Layer 2: Orchestration - Master Coordinator`)
- **Function Comments**: Use JSDoc-style for TypeScript, docstrings for Python
- **Inline Comments**: Explain complex logic, business rules, and non-obvious decisions
- **TODO Comments**: Mark future enhancements with context (e.g., `// TODO: Future enhancement - graceful degradation to Postgres-only`)

## Architectural Patterns

### Multi-Layer Architecture
- **Layer Designation**: All backend services explicitly declare their layer (L1-L14)
- **Separation of Concerns**: Each layer has distinct responsibilities
- **Orchestration Pattern**: Coordinator delegates to specialized agents (Planner → Researcher → Critic → Writer → Verifier)
- **Agent Registry**: Centralized agent lifecycle management via `Agents` registry

### Error Handling
- **Graceful Degradation**: Fallback strategies when services fail (e.g., Jaccard fallback for reranker)
- **Compensating Transactions**: Rollback on partial failures (e.g., dual-store sync failures)
- **Bounded Retries**: Use `MAX_VERIFICATION_LOOPS` and `MAX_AGENT_STEPS` to prevent infinite loops
- **Detailed Error Messages**: Provide actionable feedback with context (e.g., retrieval statistics, suggestions)

### Caching Strategy
- **Semantic Caching**: Hash-based caching for responses and retrievals
- **Cache Keys**: Normalized keys with context (e.g., `resp:${useRag}:${useHybrid}:${useWeb}:${message}`)
- **TTL Management**: In-memory cache with configurable expiration
- **Cache Invalidation**: Conditional caching (e.g., skip caching web search results, failures)

### Observability
- **OpenTelemetry Integration**: Use `withSpan` for distributed tracing
- **Event Logging**: `addEvent` for key metrics (e.g., grade distribution, verification results)
- **Structured Logging**: Include metadata for debugging (e.g., method, scores, chunk IDs)
- **SSE Streaming**: Real-time agent logs, tokens, citations, verification results

## Common Implementation Patterns

### Async/Await Pattern
```typescript
// Always use async/await for asynchronous operations
async function fetchData() {
  const result = await someAsyncOperation();
  return result;
}

// Use Promise.all for parallel operations
const [vectorResults, sqlResults] = await Promise.all([
  Agents.retrieval.hybridRetrieve(query, useHybrid),
  Agents.retrieval.sqlRetrieve(query)
]);
```

### Type Safety
```typescript
// Use explicit types for function parameters and return values
async function ingestDocument(
  content: string,
  title: string,
  source: string
): Promise<{ documentId: string; chunksInserted: number }> {
  // Implementation
}

// Use type guards for runtime checks
if (typeof node === 'object' && node !== null && '$ref' in node) {
  // Handle $ref node
}
```

### Validation and Parsing
```typescript
// Validate inputs early
if (!repoUrl) {
  throw new Error("Repository URL is required");
}

// Use regex for parsing with clear patterns
const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
if (!match) return null;
```

### State Management (React)
```typescript
// Use useState for component state
const [docs, setDocs] = useState<DocumentRecord[]>([]);
const [busy, setBusy] = useState(false);

// Use useEffect for side effects
useEffect(() => {
  refresh();
}, []);

// Batch state updates for better performance
setBusy(true);
setMsg("Processing...");
setMsgVariant("info");
```

### Error Handling in UI
```typescript
try {
  const response = await fetch(endpoint, { method: "POST", body: form });
  const result = await response.json();
  setMsg("Success!");
  setMsgVariant("success");
} catch (e: any) {
  setMsg("Failed: " + e?.message);
  setMsgVariant("error");
} finally {
  setBusy(false);
  setTimeout(() => setMsg(null), 3000);
}
```

## Internal API Usage

### Database Operations
```typescript
// Use parameterized queries for safety
const result = await sql.insertDocument(content, title, source);

// Use transactions for multi-step operations
try {
  const docId = await sql.insertDocument(...);
  const chunkId = await sql.insertChunk(...);
  await qdrant.insertChunkQdrant(...);
} catch (error) {
  // Rollback on failure
  await sql.deleteChunk(chunkId);
  await sql.deleteDocument(docId);
  throw error;
}
```

### Retrieval Service
```typescript
// Hybrid retrieval with configurable weights
const results = await Agents.retrieval.hybridRetrieve(query, useHybrid);

// Web search with metadata
const { chunks, metadata } = await Agents.retrieval.webRetrieveWithMetadata(
  query,
  allowedDomains
);
```

### Agent Coordination
```typescript
// Use SSE sender for real-time updates
sender({
  type: "agent_log",
  role: "researcher",
  message: "Retrieving evidence...",
  ts: Date.now()
});

// Stream tokens incrementally
for (const chunk of text.match(/.{1,60}/g) || []) {
  sender({ type: "tokens", text: chunk, ts: Date.now() });
}
```

### Embedding Service
```typescript
// Batch embeddings for efficiency
const embeddings = await embedTexts(chunks.map(c => c.content));

// Single embedding with caching
const embedding = await embedText(query);
```

## Testing Patterns

### Mocking Strategy
```typescript
// Mock external dependencies
vi.mock("../src/config/constants", async () => {
  const actual = await vi.importActual("../src/config/constants");
  return {
    ...actual,
    USE_DUAL_VECTOR_STORE: true,
    CHUNK_SIZE: 100
  };
});

// Spy on functions for verification
const deleteChunkSpy = vi.spyOn(sql, "deleteChunk").mockResolvedValue(undefined);
expect(deleteChunkSpy).toHaveBeenCalledWith(mockChunkId);
```

### Test Organization
```typescript
describe("Feature Name", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Specific Behavior", () => {
    it("should handle expected case", async () => {
      // Arrange
      const mockData = { id: "123" };
      vi.spyOn(service, "method").mockResolvedValue(mockData);

      // Act
      const result = await functionUnderTest();

      // Assert
      expect(result).toBe(mockData);
    });
  });
});
```

### Async Testing
```typescript
// Use async/await in tests
it("should handle async operations", async () => {
  await expect(asyncFunction()).resolves.toBe(expected);
});

// Test error cases
it("should throw on invalid input", async () => {
  await expect(functionWithError()).rejects.toThrow(/error message/);
});
```

## Code Idioms

### Conditional Chaining
```typescript
// Use optional chaining for safe property access
const value = obj?.property?.nestedProperty;

// Use nullish coalescing for defaults
const result = value ?? defaultValue;
```

### Array Operations
```typescript
// Use map for transformations
const ids = items.map(item => item.id);

// Use filter for selection
const approved = items.filter(item => grades[item.id] === "high");

// Use slice for safe array operations
const top3 = items.slice(0, 3);
```

### Object Destructuring
```typescript
// Destructure function parameters
function processRequest({ repoUrl, branch = "main", path = "" }: GitHubIngestRequest) {
  // Implementation
}

// Destructure with renaming
const { owner, repo } = parseGitHubUrl(url);
```

### Template Literals
```typescript
// Use template literals for string interpolation
const message = `Retrieved ${count} chunks from ${source}`;

// Multi-line strings
const prompt = `
  You are a helpful assistant.
  Answer based on the following evidence:
  ${evidence}
`;
```

### Spread Operator
```typescript
// Merge objects
const merged = { ...baseConfig, ...overrides };

// Copy arrays
const copy = [...original];

// Conditional properties
const obj = {
  required: value,
  ...(condition && { optional: optionalValue })
};
```

## Python-Specific Patterns

### Type Hints
```python
# Use type hints for function signatures
def normalize_ref(ref: str, current_base_uri: str) -> tuple[str, str]:
    # Implementation
    return doc_uri, fragment

# Use type aliases for complex types
from typing import Any, Iterable
def process_items(items: Iterable[dict[str, Any]]) -> list[str]:
    # Implementation
```

### Context Managers
```python
# Use context managers for resource management
with open(INPUT_FILE, 'r', encoding='utf-8') as f:
    root = yaml.safe_load(f)
```

### List Comprehensions
```python
# Use comprehensions for transformations
tokens = [_decode_json_pointer_token(p) for p in parts]

# Filter with comprehensions
used_sections = [s for s in sections if s in components]
```

### Dictionary Operations
```python
# Use dict.get() with defaults
value = config.get('key', default_value)

# Dictionary comprehensions
filtered = {k: v for k, v in items.items() if condition}
```

## Accessibility and UX

### ARIA Labels
```typescript
// Use aria-label for screen readers
<input
  type="file"
  aria-label="Upload one or more Markdown or text documents"
  multiple
/>

// Use role and aria-live for dynamic content
<p role="status" aria-live="polite">{message}</p>
```

### Form Validation
```typescript
// Use HTML5 validation attributes
<input
  type="text"
  required
  min="1"
  max="1000"
  placeholder="100"
/>

// Provide clear error messages
setMsg("Upload failed: " + e?.message);
```

### Loading States
```typescript
// Disable controls during async operations
<button disabled={busy || !githubUrl}>
  Ingest Repository
</button>

// Show progress indicators
{busy && <p>Processing...</p>}
```

## Performance Optimization

### Parallel Execution
```typescript
// Use Promise.all for independent operations
const [pgResults, qdrantResults] = await Promise.all([
  sql.vectorSearch(embedding, limit),
  qdrant.vectorSearchQdrant(embedding, limit)
]);
```

### Pagination
```typescript
// Implement pagination for large lists
const totalPages = Math.ceil(items.length / pageSize);
const paginatedItems = items.slice(startIndex, endIndex);
```

### Smart Truncation
```typescript
// Truncate at natural boundaries
function smartTruncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const lastPeriod = text.slice(0, maxLength).lastIndexOf(". ");
  return text.slice(0, lastPeriod + 1).trim() + "...";
}
```

### Content Cleaning
```typescript
// Remove metadata before processing
function cleanChunkContent(content: string): string {
  let cleaned = content;
  cleaned = cleaned.replace(/^---\s*[\s\S]*?---\s*/m, ""); // YAML frontmatter
  cleaned = cleaned.replace(/<\/?[^>]+>/g, ""); // XML tags
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n"); // Multiple newlines
  return cleaned.trim();
}
```

## Security Best Practices

### Input Validation
```typescript
// Validate URLs before processing
const parsed = parseGitHubUrl(repoUrl);
if (!parsed) {
  throw new Error("Invalid GitHub URL");
}

// Sanitize user input
const normalized = normalize(userInput);
```

### Error Message Safety
```typescript
// Don't expose internal details in error messages
catch (error) {
  setMsg("Operation failed. Please try again.");
  console.error("Internal error:", error); // Log details server-side
}
```

### CORS Configuration
```typescript
// Configure CORS explicitly
app.register(cors, {
  origin: process.env.CORS_ORIGIN || "http://localhost:5173"
});
```

## Configuration Management

### Environment Variables
```typescript
// Use typed constants for configuration
export const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || "1000", 10);
export const MAX_VERIFICATION_LOOPS = parseInt(process.env.MAX_VERIFICATION_LOOPS || "2", 10);

// Provide sensible defaults
export const HYBRID_VECTOR_WEIGHT = parseFloat(process.env.HYBRID_VECTOR_WEIGHT || "0.7");
```

### Feature Flags
```typescript
// Use boolean flags for optional features
export const ENABLE_WEB_SEARCH = process.env.ENABLE_WEB_SEARCH === "true";
export const ALLOW_LOW_GRADE_FALLBACK = process.env.ALLOW_LOW_GRADE_FALLBACK !== "false";
```

## Frequently Used Annotations

### TypeScript
- `async`: Functions that return Promises
- `await`: Wait for Promise resolution
- `type`: Type aliases for complex types
- `interface`: Object shape definitions
- `as`: Type assertions
- `!`: Non-null assertion (use sparingly)

### Python
- `@staticmethod`: Methods that don't access instance state
- `# noqa`: Suppress linter warnings with justification
- `# type: ignore`: Suppress type checker warnings (use sparingly)
- `"""docstring"""`: Multi-line documentation strings

### Testing
- `describe`: Test suite grouping
- `it`: Individual test case
- `beforeEach`: Setup before each test
- `afterEach`: Cleanup after each test
- `vi.mock`: Mock module imports
- `vi.spyOn`: Spy on function calls
- `expect`: Assertion library
