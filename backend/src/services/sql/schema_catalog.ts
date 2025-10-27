// Layer 9: Query Execution Metadata Catalog (scaffolding)
import { Catalog, CatalogForeignKey } from "../executors/sql.types";
import { query } from "../../db/client";
import { CACHE_TTL_MS } from "./schema_constants";

let cachedCatalog: Catalog | null = null;
let cachedAt = 0;

export async function loadCatalog(): Promise<Catalog> {
  const now = Date.now();
  if (cachedCatalog && now - cachedAt < CACHE_TTL_MS) {
    return cachedCatalog;
  }

  const tables = await introspectTables();
  const fks = await introspectForeignKeys();

  for (const fk of fks) {
    const table = tables[fk.table];
    if (!table) continue;
    table.fks.push({
      column: fk.column,
      refTable: fk.refTable,
      refColumn: fk.refColumn
    });
  }

  cachedCatalog = {
    tables,
    synonyms: buildSynonyms(tables)
  };
  cachedAt = now;
  return cachedCatalog;
}

async function introspectTables() {
  const sql = `
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `;
  const { rows } = await query(sql);
  const map: Catalog["tables"] = {} as any;
  for (const row of rows) {
    if (!map[row.table_name]) {
      map[row.table_name] = { columns: {}, fks: [] };
    }
    map[row.table_name].columns[row.column_name] = {
      dataType: row.data_type
    };
  }
  return map;
}

async function introspectForeignKeys(): Promise<Array<{ table: string; column: string; refTable: string; refColumn: string }>> {
  const sql = `
    SELECT
      tc.table_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
  `;
  const { rows } = await query(sql);
  return rows.map((row) => ({
    table: row.table_name,
    column: row.column_name,
    refTable: row.foreign_table_name,
    refColumn: row.foreign_column_name
  }));
}

function buildSynonyms(tables: Catalog["tables"]): Record<string, string> {
  const synonyms: Record<string, string> = {};
  for (const table of Object.keys(tables)) {
    const spaced = table.replace(/_/g, " ");
    const collapsed = table.replace(/_/g, "");
    synonyms[spaced] = table;
    synonyms[collapsed] = table;
    if (table.endsWith("s")) {
      const singular = table.slice(0, -1);
      synonyms[singular] = table;
      synonyms[singular.replace(/_/g, " ")] = table;
      synonyms[singular.replace(/_/g, "")] = table;
    }
  }
  return synonyms;
}
