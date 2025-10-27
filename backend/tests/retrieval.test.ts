import { describe, it, expect } from "vitest";
import { buildVectorSearchSQL, buildTrigramTitleSQL } from "../src/db/sql";

describe("retrieval SQL builders", () => {
  it("includes ivfflat vector operator", () => {
    const sql = buildVectorSearchSQL(5);
    expect(sql).toMatch(/embedding\s*<=>\s*\$1::vector/);
  });

  it("includes trigram similarity", () => {
    const sql = buildTrigramTitleSQL(5);
    expect(sql).toMatch(/similarity\(d\.title,\s*\$1\)/);
    expect(sql).toMatch(/d\.title\s*%\s*\$1/);
  });

  it("vectorSearch includes source field from documents table", () => {
    const sql = buildVectorSearchSQL(5);
    expect(sql).toMatch(/d\.source/);
    expect(sql).toMatch(/JOIN\s+documents\s+d\s+ON\s+c\.document_id\s*=\s*d\.id/);
  });
});
