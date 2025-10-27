import { Catalog, SqlDimension, SqlFilter, SqlMetric, SqlPlan } from "./sql.types";

export interface PlanDerivationContext {
  message: string;
  catalog: Catalog;
  enabled: boolean;
  allowlist: string[];
  allowedFunctions: string[];
}

const METRIC_KEYWORDS: Record<string, SqlMetric["op"]> = {
  sum: "sum",
  total: "sum",
  average: "avg",
  avg: "avg",
  mean: "avg",
  count: "count",
  minimum: "min",
  min: "min",
  maximum: "max",
  max: "max"
};

const TREND_KEYWORDS = ["trend", "over time", "per day", "per week", "per month", "timeline"];

export async function deriveSqlPlan(ctx: PlanDerivationContext): Promise<SqlPlan | null> {
  if (!ctx.enabled) return null;
  const message = ctx.message.toLowerCase();
  const baseTable = findPrimaryEntity(message, ctx.catalog, ctx.allowlist);
  if (!baseTable || !ctx.allowlist.includes(baseTable)) return null;

  const intent = detectIntent(message);
  const metrics = detectMetrics(message, ctx.catalog, baseTable);
  const dimensions = detectDimensions(message, ctx.catalog, baseTable);
  const filters = detectFilters(message, ctx.catalog, baseTable);
  const limit = detectLimit(message);
  const sort = detectSort(message, metrics, dimensions);

  if (intent !== "lookup" && metrics.length === 0) {
    metrics.push({ op: "count" });
  }

  // Ensure metrics use allowlisted functions
  for (const metric of metrics) {
    if (!ctx.allowedFunctions.includes(metric.op)) {
      return null;
    }
  }

  return {
    intent,
    primaryEntity: baseTable,
    entities: [baseTable],
    metrics,
    dimensions,
    filters,
    sort,
    limit,
    joinHints: []
  };
}

function findPrimaryEntity(message: string, catalog: Catalog, allowlist: string[]): string | null {
  const underscoredMessage = message.replace(/\s+/g, "_");
  const collapsedMessage = message.replace(/[\s_]+/g, "");
  for (const table of Object.keys(catalog.tables)) {
    const lower = table.toLowerCase();
    if (message.includes(lower)) return table;
    const spaced = lower.replace(/_/g, " ");
    if (message.includes(spaced)) return table;
    if (underscoredMessage.includes(lower)) return table;
    if (collapsedMessage.includes(lower.replace(/_/g, ""))) return table;

    const singular = table.endsWith("s") ? table.slice(0, -1) : null;
    if (singular) {
      const singularLower = singular.toLowerCase();
      if (message.includes(singularLower)) return table;
      const singularSpaced = singularLower.replace(/_/g, " ");
      if (message.includes(singularSpaced)) return table;
      if (underscoredMessage.includes(singularLower)) return table;
      if (collapsedMessage.includes(singularLower.replace(/_/g, ""))) return table;
    }
  }

  if (catalog.synonyms) {
    for (const [alias, target] of Object.entries(catalog.synonyms)) {
      const aliasLower = alias.toLowerCase();
      if (message.includes(aliasLower)) return target;
      const aliasSpaced = aliasLower.replace(/_/g, " ");
      if (message.includes(aliasSpaced)) return target;
      const aliasUnderscored = aliasLower.replace(/\s+/g, "_");
      if (underscoredMessage.includes(aliasUnderscored)) return target;
      const aliasCollapsed = aliasLower.replace(/[\s_]+/g, "");
      if (collapsedMessage.includes(aliasCollapsed)) return target;
    }
  }

  return allowlist.find((t) => catalog.tables[t]) || null;
}

function detectIntent(message: string): SqlPlan["intent"] {
  if (TREND_KEYWORDS.some((k) => message.includes(k))) return "trend";
  if (/compare|versus|vs|difference|contrast/.test(message)) return "compare";
  if (Object.keys(METRIC_KEYWORDS).some((kw) => message.includes(kw))) return "aggregation";
  if (/how many|count|number of/.test(message)) return "aggregation";
  return "lookup";
}

function detectMetrics(message: string, catalog: Catalog, table: string): SqlMetric[] {
  const metrics: SqlMetric[] = [];
  for (const [keyword, op] of Object.entries(METRIC_KEYWORDS)) {
    if (!message.includes(keyword)) continue;
    let column = findColumnMention(message, catalog, table);
    if (!column && op !== "count") {
      column = findNumericColumn(catalog, table);
    }
    metrics.push({ op, column, alias: makeAlias(op, column) });
  }

  if (metrics.length === 0 && /how many|count|number of/.test(message)) {
    metrics.push({ op: "count", alias: "count" });
  }

  return dedupeMetrics(metrics);
}

function detectDimensions(message: string, catalog: Catalog, table: string): SqlDimension[] {
  const dims: SqlDimension[] = [];
  const column = findColumnMention(message, catalog, table, /by ([a-z0-9_]+)/);
  if (column) dims.push({ column });

  const timeColumn = findTemporalColumn(catalog, table);
  if (timeColumn && TREND_KEYWORDS.some((k) => message.includes(k))) {
    dims.push({ column: timeColumn, timeGrain: detectTimeGrain(message) });
  }

  return dedupeDimensions(dims);
}

function detectFilters(message: string, catalog: Catalog, table: string): SqlFilter[] {
  const filters: SqlFilter[] = [];

  const betweenMatch = message.match(/between\s+(\d{4}-\d{2}-\d{2})\s+and\s+(\d{4}-\d{2}-\d{2})/);
  const timeColumn = findTemporalColumn(catalog, table);
  if (betweenMatch && timeColumn) {
    filters.push({ column: timeColumn, op: "between", value: [betweenMatch[1], betweenMatch[2]] });
  }

  const topFilter = message.match(/status\s+(?:is\s+)?([a-z]+)/);
  if (topFilter && hasColumn(catalog, table, "status")) {
    filters.push({ column: "status", op: "eq", value: topFilter[1] });
  }

  return filters;
}

function detectLimit(message: string): number | undefined {
  const match = message.match(/top\s+(\d+)/);
  if (match) return Number(match[1]);
  const limitMatch = message.match(/limit\s+(\d+)/);
  if (limitMatch) return Number(limitMatch[1]);
  return undefined;
}

function detectSort(_message: string, metrics: SqlMetric[], dimensions: SqlDimension[]) {
  if (metrics.length === 0) return undefined;
  const metricAlias = metrics[0].alias || metrics[0].column || metrics[0].op;
  return [{ by: `metric:${metricAlias}`, dir: "desc" as const }];
}

function dedupeMetrics(metrics: SqlMetric[]): SqlMetric[] {
  const seen = new Set<string>();
  const result: SqlMetric[] = [];
  for (const metric of metrics) {
    const key = `${metric.op}:${metric.column || "*"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(metric);
  }
  return result;
}

function dedupeDimensions(dimensions: SqlDimension[]): SqlDimension[] {
  const seen = new Set<string>();
  const result: SqlDimension[] = [];
  for (const dim of dimensions) {
    const key = `${dim.column}:${dim.timeGrain || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(dim);
  }
  return result;
}

function findColumnMention(message: string, catalog: Catalog, table: string, pattern?: RegExp): string | undefined {
  const tbl = catalog.tables[table];
  if (!tbl) return undefined;
  if (pattern) {
    const match = message.match(pattern);
    if (match && hasColumn(catalog, table, match[1])) return match[1];
  }
  for (const column of Object.keys(tbl.columns)) {
    if (message.includes(column.toLowerCase())) return column;
  }
  return undefined;
}

function hasColumn(catalog: Catalog, table: string, column: string): boolean {
  const tbl = catalog.tables[table];
  if (!tbl) return false;
  return Boolean(tbl.columns[column] || tbl.columns[column.toLowerCase()]);
}

function detectTimeGrain(message: string): SqlDimension["timeGrain"] {
  if (message.includes("month")) return "month";
  if (message.includes("week")) return "week";
  if (message.includes("quarter")) return "quarter";
  return "day";
}

function findTemporalColumn(catalog: Catalog, table: string): string | undefined {
  const tbl = catalog.tables[table];
  if (!tbl) return undefined;
  for (const [name, meta] of Object.entries(tbl.columns)) {
    const dt = meta.dataType.toLowerCase();
    if (dt.includes("timestamp") || dt.includes("date")) return name;
  }
  return undefined;
}

function findNumericColumn(catalog: Catalog, table: string): string | undefined {
  const tbl = catalog.tables[table];
  if (!tbl) return undefined;
  for (const [name, meta] of Object.entries(tbl.columns)) {
    const dt = meta.dataType.toLowerCase();
    if (/(int|numeric|double|real|decimal)/.test(dt)) {
      return name;
    }
  }
  return undefined;
}

function makeAlias(op: SqlMetric["op"], column?: string) {
  if (!column) return op;
  return `${op}_${column}`;
}
