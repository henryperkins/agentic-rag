// Layer 3: Retrieval Agent — SQL Executor (scaffolding)
import { Pool } from "pg";
import {
  ENABLE_SQL_AGENT,
  SQL_AGENT_ALLOWLIST,
  SQL_AGENT_ALLOWED_FUNCS,
  SQL_AGENT_MAX_ROWS,
  SQL_AGENT_TIMEOUT_MS,
  SQL_AGENT_MAX_COST
} from "../../config/constants";
import { env } from "../../config/env";
import { randomUUID } from "crypto";
import { loadCatalog } from "../sql/schema_catalog";
import { deriveSqlPlan } from "./sql.planner";
import { buildSQLFromPlan } from "./sql.binder";
import { SqlAgentRequest, SqlAgentResult } from "./sql.types";

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  idleTimeoutMillis: 5_000,
  max: 5
});

function assertEnabled() {
  if (!ENABLE_SQL_AGENT) {
    throw new Error("SQL agent disabled");
  }
}

function assertAllowlisted(table: string) {
  if (!SQL_AGENT_ALLOWLIST.includes(table)) {
    throw new Error(`Table ${table} not allowlisted for SQL agent`);
  }
}

export async function runSqlAgent(request: SqlAgentRequest): Promise<SqlAgentResult[]> {
  assertEnabled();
  const catalog = await loadCatalog();
  const plan = await deriveSqlPlan({
    message: request.message,
    catalog,
    enabled: ENABLE_SQL_AGENT,
    allowlist: SQL_AGENT_ALLOWLIST,
    allowedFunctions: SQL_AGENT_ALLOWED_FUNCS
  });
  if (!plan) return [];

  assertAllowlisted(plan.primaryEntity);

  const compiled = buildSQLFromPlan(plan, catalog);

  if ((compiled.estimatedCost ?? 0) > SQL_AGENT_MAX_COST) {
    throw new Error(`Query cost estimate (${compiled.estimatedCost}) exceeds maximum (${SQL_AGENT_MAX_COST})`);
  }

  const client = await pool.connect();
  const timeout = setTimeout(() => {
    try {
      client.release();
    } catch (_) {
      // ignore double release during timeout
    }
  }, SQL_AGENT_TIMEOUT_MS);
  try {
    await client.query(`SET statement_timeout = ${SQL_AGENT_TIMEOUT_MS}`);
    const cappedSql = `${compiled.sql}\nLIMIT ${Math.min(SQL_AGENT_MAX_ROWS, plan.limit ?? SQL_AGENT_MAX_ROWS)}`;
    const res = await client.query(cappedSql, compiled.params || []);
    clearTimeout(timeout);
    return res.rows.map((row: any) => ({
      id: row.id?.toString?.() || row.id || randomUUID(),
      document_id: row.document_id ?? plan.primaryEntity,
      chunk_index: row.chunk_index ?? null,
      content: row.content ?? JSON.stringify(row),
      source: plan.primaryEntity,
      score: 0
    }));
  } finally {
    clearTimeout(timeout);
    client.release();
  }
}
