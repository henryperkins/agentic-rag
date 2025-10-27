import { describe, expect, it } from "vitest";
import { Agents } from "../src/services/orchestration/registry";
import {
  ENABLE_SQL_AGENT,
  SQL_AGENT_ALLOWLIST
} from "../src/config/constants";

describe("SQL agent scaffolding", () => {
  it("respects the SQL agent toggle", async () => {
    const rows = await Agents.retrieval.sqlRetrieve("show me documents");

    if (!ENABLE_SQL_AGENT || SQL_AGENT_ALLOWLIST.length === 0) {
      expect(rows).toEqual([]);
      return;
    }

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({
      document_id: expect.any(String),
      content: expect.any(String),
      source: expect.any(String)
    });
  });
});
