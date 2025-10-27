# Repository Guidelines

## Project Structure & Module Organization
- `backend/src/` hosts the Fastify API, orchestration services, and retrieval agents; extend existing layer directories instead of creating new ones.
- `backend/scripts/` centralizes database setup, migrations, and ingestion utilities, and `backend/tests/` mirrors service names with Vitest suites.
- `frontend/src/` plus `shared/types.ts` provide the Vite UI and shared SSE contracts, while `samples/` holds corpus fixtures for local testing.

## Build, Test & Development Commands
- `docker compose up -d` boots PostgreSQL with pgvector/pg_trgm before any backend process.
- `npm install` restores all workspace dependencies; rerun after editing a `package.json`.
- `npm run db:setup && npm run db:migrate` create extensions and apply migrations in order.
- `npm run ingest:samples` loads the baseline corpus for smoke tests.
- `npm run dev` starts Fastify and Vite together (`http://localhost:3000` and `http://localhost:5173`).
- `npm run typecheck` and `npm run test` enforce TypeScript contracts and execute the backend Vitest suite.
- SQL agent scaffolding now follows a plan→binder pipeline. Flip `ENABLE_SQL_AGENT=true` in `backend/.env` and use `npm -w backend run test -- sqlAgent` or `-- sqlBinder` while iterating on `sql.planner.ts` / `sql.binder.ts`.

## Coding Style & Naming Conventions
- Stick to TypeScript ES modules, 2-space indentation, and explicit return types for services to keep agent boundaries predictable.
- Use `camelCase` for functions, `PascalCase` for React components or classes, and `UPPER_SNAKE_CASE` for environment constants.
- House UI logic under `components/` or `hooks/` with `.tsx` extensions, and annotate each server module with a brief layer comment.
- Frontend typography should rely on the shared CSS tokens in `frontend/src/styles.css` (e.g., `--type-body-line-height`, `--interactive-min-size`) to stay compliant with WCAG 2.2 spacing rules and 24×24 mobile target sizes.
- Validate external input using `zod` schemas in routes/config modules before invoking downstream agents.

## Testing Guidelines
- Place backend specs in `backend/tests/` using the `*.test.ts` naming pattern; favor scenario-driven assertions over exhaustive mocks.
- Toggle `MOCK_OPENAI=1` in `backend/.env` for deterministic runs, and add fixtures under `samples/` when expanding coverage.
- Import shared types when asserting SSE payloads, and include hybrid-weight expectations whenever retrieval logic shifts.

## Commit & Pull Request Guidelines
- Git history is unavailable here, so follow Conventional Commits (`feat:`, `fix:`, `chore:`) with a single scope per change.
- PR descriptions should list affected architecture layers, executed tests, and any new configuration toggles.
- Attach UI screenshots or curl transcripts for behavior changes, and update README/DEPLOYMENT notes when workflows shift.

## Security & Configuration Tips
- Copy `backend/.env.example` to `backend/.env`, populate `DATABASE_URL` and API keys, and keep secrets out of version control.
- Constrain `env.CORS_ORIGIN` to trusted domains and leave rate-limiting/auth hooks active unless intentionally testing failures.
- Confirm migrations ran successfully before ingesting documents; stale schemas typically surface as retrieval errors.

## Web Search Agent (Layer 7)

**Trigger:** Recency indicators in query or empty local results
**Source:** OpenAI hosted `web_search_preview` tool
**Location Awareness:** Optional approximate location (city/region/country/timezone)
**Normalization:** Extracts domain as `document_id`, creates SHA-1 hash IDs
**Caching:** Bypassed for freshness (retrieval cache disabled when web active)
