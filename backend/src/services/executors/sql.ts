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

  // Early guard when binder provided an estimated cost (avoid DB connection on hard reject)
  if (compiled.estimatedCost !== undefined && compiled.estimatedCost > SQL_AGENT_MAX_COST) {
    throw new Error(`Query cost estimate (${compiled.estimatedCost}) exceeds maximum (${SQL_AGENT_MAX_COST})`);
  }

  // Helper: estimate cost via EXPLAIN (FORMAT JSON); return undefined on failure
  const estimateQueryCost = async (client: any, sql: string, params: unknown[]): Promise<number | undefined> => {
    try {
      const explainSql = `EXPLAIN (FORMAT JSON) ${sql}`;
      const ex = await client.query(explainSql, params);
      const row = ex.rows?.[0] as any;
      let payload: any = row?.["QUERY PLAN"] ?? row?.query_plan ?? row?.plan ?? row;
      if (typeof payload === "string") {
        payload = JSON.parse(payload);
      }
      const planObj = Array.isArray(payload) ? payload[0] : payload;
      const total = planObj?.Plan?.["Total Cost"] ?? planObj?.Plan?.TotalCost;
      const n = typeof total === "number" ? total : Number(total);
      return isFinite(n) ? n : undefined;
    } catch {
      return undefined;
    }
  };

  const client = await pool.connect();
  try {
    await client.query(`SET statement_timeout = ${SQL_AGENT_TIMEOUT_MS}`);

    const cappedSql = `${compiled.sql}\nLIMIT ${Math.min(SQL_AGENT_MAX_ROWS, plan.limit ?? SQL_AGENT_MAX_ROWS)}`;

    // Prefer binder-provided estimate; otherwise run EXPLAIN to derive one
    const est = (compiled.estimatedCost ?? (await estimateQueryCost(client, cappedSql, compiled.params || [])));
    if (est !== undefined) {
      (compiled as any).estimatedCost = est;
      if (est > SQL_AGENT_MAX_COST) {
        throw new Error(`Query cost estimate (${est}) exceeds maximum (${SQL_AGENT_MAX_COST})`);
      }
    }

    const res = await client.query(cappedSql, compiled.params || []);
    return res.rows.map((row: any) => ({
      id: row.id?.toString?.() || row.id || randomUUID(),
      document_id: row.document_id ?? plan.primaryEntity,
      chunk_index: row.chunk_index ?? null,
      content: row.content ?? JSON.stringify(row),
      source: plan.primaryEntity,
      score: 0
    }));
  } finally {
    client.release();
  }
}
