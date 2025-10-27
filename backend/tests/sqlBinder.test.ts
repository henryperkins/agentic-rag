import { describe, expect, it } from "vitest";
import { buildSQLFromPlan } from "../src/services/executors/sql.binder";
import { deriveSqlPlan } from "../src/services/executors/sql.planner";
import { Catalog, SqlPlan } from "../src/services/executors/sql.types";

const catalog: Catalog = {
  tables: {
    documents: {
      columns: {
        word_count: { dataType: "integer" },
        created_at: { dataType: "timestamp" },
        status: { dataType: "text" }
      },
      fks: []
    }
  }
};

describe("SQL binder", () => {
  it("builds basic aggregation SQL", () => {
    const plan: SqlPlan = {
      intent: "aggregation",
      primaryEntity: "documents",
      entities: ["documents"],
      metrics: [{ op: "sum", column: "word_count", alias: "total" }],
      dimensions: [],
      filters: [],
      limit: 10
    };

    const compiled = buildSQLFromPlan(plan, catalog);
    expect(compiled.sql).toMatch(/SELECT SUM\(documents\.word_count\) AS "total"\s+FROM documents/);
  });

  it("derives a basic aggregation plan", async () => {
    const plan = await deriveSqlPlan({
      message: "total word count of documents",
      catalog,
      enabled: true,
      allowlist: ["documents", "chunks"],
      allowedFunctions: ["count", "sum", "avg", "min", "max"]
    });
    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(plan.primaryEntity).toBe("documents");
    expect(plan.intent).toBe("aggregation");
    expect(plan.metrics[0].op).toBe("sum");
  });

  it("builds trend SQL with temporal column even if it is not first", () => {
    const plan: SqlPlan = {
      intent: "trend",
      primaryEntity: "documents",
      entities: ["documents"],
      metrics: [{ op: "count", alias: "count" }],
      dimensions: [
        { column: "status" },
        { column: "created_at", timeGrain: "day" }
      ],
      filters: []
    };

    const compiled = buildSQLFromPlan(plan, catalog);
    expect(compiled.sql).toContain("date_trunc('day', documents.created_at)");
    expect(compiled.sql).not.toContain("date_trunc('day', documents.status)");
  });

  it("resolves allowlisted tables referenced with spaces", async () => {
    const plan = await deriveSqlPlan({
      message: "show query rewrites by status",
      catalog: {
        tables: {
          query_rewrites: {
            columns: {
              status: { dataType: "text" },
              created_at: { dataType: "timestamp" }
            },
            fks: []
          }
        }
      },
      enabled: true,
      allowlist: ["query_rewrites", "documents"],
      allowedFunctions: ["count", "sum", "avg", "min", "max"]
    });

    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(plan.primaryEntity).toBe("query_rewrites");
  });
});
