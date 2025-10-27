import fs from "fs/promises";
import path from "path";
import pg from "pg";
import crypto from "crypto";
import { QdrantClient } from "@qdrant/qdrant-js";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://rag:rag@localhost:5432/ragchat";
const EMBEDDING_DIMENSIONS = Number(process.env.EMBEDDING_DIMENSIONS || 1536);
const CHUNK_SIZE = Number(process.env.CHUNK_SIZE || 1000);
const CHUNK_OVERLAP = Number(process.env.CHUNK_OVERLAP || 100);
const USE_DUAL_VECTOR_STORE = process.env.USE_DUAL_VECTOR_STORE === "true";
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || "";
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || "chunks";

const { Pool } = pg;
const pool = new Pool({ connectionString: DATABASE_URL });

// Initialize Qdrant client
const qdrantClient = new QdrantClient({
  url: QDRANT_URL,
  apiKey: QDRANT_API_KEY || undefined,
});

async function initQdrantCollection() {
  if (!USE_DUAL_VECTOR_STORE) return;

  try {
    const collections = await qdrantClient.getCollections();
    const exists = collections.collections.some((c) => c.name === QDRANT_COLLECTION);

    if (!exists) {
      console.log(`Creating Qdrant collection: ${QDRANT_COLLECTION}`);
      await qdrantClient.createCollection(QDRANT_COLLECTION, {
        vectors: {
          size: EMBEDDING_DIMENSIONS,
          distance: "Cosine",
        },
        optimizers_config: {
          default_segment_number: 2,
        },
        replication_factor: 2,
      });
      console.log(`✓ Created Qdrant collection: ${QDRANT_COLLECTION}`);
    } else {
      console.log(`✓ Qdrant collection exists: ${QDRANT_COLLECTION}`);
    }
  } catch (error) {
    console.error("Failed to initialize Qdrant collection:", error);
    throw error;
  }
}

function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(text.length, i + size);
    const chunk = text.slice(i, end);
    chunks.push(chunk);
    if (end === text.length) break;
    i = end - overlap;
    if (i < 0) i = 0;
  }
  return chunks;
}

function strSeed(s) {
  const h = crypto.createHash("sha256").update(s).digest();
  return h.readUInt32BE(0);
}
function seededRand(seed) {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0xffffffff;
  };
}

async function mockEmbed(texts, dims) {
  return texts.map((t) => {
    const rng = seededRand(strSeed(t));
    const v = new Array(dims).fill(0).map(() => rng());
    const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0));
    return v.map((x) => x / (norm || 1));
  });
}

async function insertDocument(client, title, source) {
  const res = await client.query(
    "INSERT INTO documents (title, source) VALUES ($1, $2) RETURNING id",
    [title, source]
  );
  return res.rows[0].id;
}

async function insertChunk(client, docId, index, content, embedding) {
  const res = await client.query(
    "INSERT INTO chunks (document_id, chunk_index, content, embedding) VALUES ($1, $2, $3, $4::vector) RETURNING id",
    [docId, index, content, `[${embedding.join(",")}]`]
  );
  return res.rows[0].id;
}

async function insertChunkQdrant(chunkId, docId, index, content, embedding, source) {
  if (!USE_DUAL_VECTOR_STORE) return;

  await qdrantClient.upsert(QDRANT_COLLECTION, {
    wait: true,
    points: [
      {
        id: chunkId,
        vector: embedding,
        payload: {
          chunk_id: chunkId,
          document_id: docId,
          chunk_index: index,
          content: content,
          source: source,
        },
      },
    ],
  });
}

async function main() {
  // Initialize Qdrant collection if dual-store enabled
  if (USE_DUAL_VECTOR_STORE) {
    console.log("Dual vector store enabled, initializing Qdrant...");
    await initQdrantCollection();
  }

  const client = await pool.connect();
  try {
    const samplesDir = path.resolve(process.cwd(), "../samples");
    const files = await fs.readdir(samplesDir);
    let countDocs = 0;
    let countChunks = 0;

    for (const f of files) {
      if (!f.endsWith(".md") && !f.endsWith(".txt")) continue;
      const p = path.join(samplesDir, f);
      const content = await fs.readFile(p, "utf8");
      const chunks = chunkText(content);
      const embs = await mockEmbed(chunks, EMBEDDING_DIMENSIONS);

      const title = path.basename(f).replace(/\.(md|txt)$/i, "");
      const docId = await insertDocument(client, title, f);

      for (let i = 0; i < chunks.length; i++) {
        // Insert into Postgres and get chunk ID
        const chunkId = await insertChunk(client, docId, i, chunks[i], embs[i]);

        // Also insert into Qdrant if dual-store enabled
        await insertChunkQdrant(chunkId, docId, i, chunks[i], embs[i], f);

        countChunks++;
      }
      countDocs++;
    }

    console.log(`Ingested ${countDocs} documents with ${countChunks} chunks.`);
    if (USE_DUAL_VECTOR_STORE) {
      console.log(`✓ Data replicated to both Postgres and Qdrant`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
