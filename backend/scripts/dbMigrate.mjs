import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://rag:rag@localhost:5432/ragchat";
const { Pool } = pg;
const pool = new Pool({ connectionString: DATABASE_URL });

const ext = `
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;
`;

const ddl = `
CREATE TABLE IF NOT EXISTS feedback (
  id SERIAL PRIMARY KEY,
  rating TEXT NOT NULL,
  comment TEXT,
  trace_id TEXT,
  question TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
`;

const idx = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relname='idx_chunks_embedding_ivfflat'
  ) THEN
    EXECUTE 'CREATE INDEX idx_chunks_embedding_ivfflat ON chunks USING ivfflat (embedding vector_cosine_ops)';
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relname='idx_documents_title_trgm'
  ) THEN
    EXECUTE 'CREATE INDEX idx_documents_title_trgm ON documents USING GIN (title gin_trgm_ops)';
  END IF;
END$$;
`;

async function main() {
  const client = await pool.connect();
  try {
    await client.query(ext);
    await client.query(ddl);
    await client.query(idx);
    console.log("DB migrate ensured.");
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
