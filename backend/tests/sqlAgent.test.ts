import { describe, expect, it } from "vitest";
import { Agents } from "../src/services/orchestration/registry";

describe("SQL agent scaffolding", () => {
  it("returns empty results when agent disabled", async () => {
    const rows = await Agents.retrieval.sqlRetrieve("show me documents");
    expect(rows).toEqual([]);
  });
});
