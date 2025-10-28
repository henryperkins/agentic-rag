import { describe, it, expect, vi, beforeEach } from "vitest";
import { runSqlAgent } from "../src/services/executors/sql";
import * as planner from "../src/services/executors/sql.planner";
import * as binder from "../src/services/executors/sql.binder";
import { SqlAgentRequest } from "../src/services/executors/sql.types";

vi.mock("../src/services/executors/sql.planner");
vi.mock("../src/services/executors/sql.binder");

describe("SQL Agent Cost Controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should reject query if estimated cost exceeds maximum", async () => {
    const mockPlanSql = vi.spyOn(planner, "deriveSqlPlan").mockResolvedValue({
      intent: "lookup",
      primaryEntity: "documents",
      entities: ["documents"],
      dimensions: [],
      metrics: [],
      filters: [],
      confidence: 0.9,
    } as any);
    const mockBindSql = vi.spyOn(binder, "buildSQLFromPlan").mockReturnValue({
      sql: "SELECT * FROM documents",
      params: [],
      estimatedCost: 2000,
    });

    const request: SqlAgentRequest = { message: "show all documents" };

    await expect(runSqlAgent(request)).rejects.toThrow(
      /Query cost estimate \(2000\) exceeds maximum \(1000\)/
    );
  });

  it("should execute query if estimated cost is within limits", async () => {
    const mockPlanSql = vi.spyOn(planner, "deriveSqlPlan").mockResolvedValue({
      intent: "lookup",
      primaryEntity: "documents",
      entities: ["documents"],
      dimensions: [],
      metrics: [],
      filters: [],
      confidence: 0.9,
    } as any);
    const mockBindSql = vi.spyOn(binder, "buildSQLFromPlan").mockReturnValue({
      sql: "SELECT * FROM documents",
      params: [],
      estimatedCost: 500,
    });

    const request: SqlAgentRequest = { message: "show all documents" };

    const rows = await runSqlAgent(request);
    expect(Array.isArray(rows)).toBe(true);
  });
});
