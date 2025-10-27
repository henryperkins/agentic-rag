export type Intent = "lookup" | "aggregation" | "trend" | "compare";

export interface SqlMetric {
  op: "count" | "sum" | "avg" | "min" | "max";
  column?: string;
  alias?: string;
}

export interface SqlDimension {
  column: string;
  timeGrain?: "day" | "week" | "month" | "quarter";
}

export interface SqlFilter {
  column: string;
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "between" | "in" | "like";
  value: unknown | unknown[];
}

export interface SqlSort {
  by: string;
  dir: "asc" | "desc";
}

export interface SqlJoinHint {
  from: string;
  to: string;
}

export interface SqlPlan {
  intent: Intent;
  primaryEntity: string;
  entities: string[];
  metrics: SqlMetric[];
  dimensions: SqlDimension[];
  filters: SqlFilter[];
  sort?: SqlSort[];
  limit?: number;
  confidence?: number;
  joinHints?: SqlJoinHint[];
}

export interface CatalogColumn {
  dataType: string;
  synonyms?: string[];
}

export interface CatalogForeignKey {
  column: string;
  refTable: string;
  refColumn: string;
}

export interface CatalogTable {
  columns: Record<string, CatalogColumn>;
  pk?: string;
  fks: CatalogForeignKey[];
}

export interface Catalog {
  tables: Record<string, CatalogTable>;
  synonyms?: Record<string, string>;
}

export interface CompiledSQL {
  sql: string;
  params: unknown[];
  estimatedCost?: number;
}

export interface SqlAgentRequest {
  message: string;
}

export interface SqlAgentResult {
  id: string;
  document_id: string | null;
  chunk_index: number | null;
  content: string;
  source: string | null;
  score: number;
}
