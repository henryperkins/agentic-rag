import { SQL_AGENT_ALLOWED_FUNCS } from "../../config/constants";
import {
  Catalog,
  CatalogTable,
  CompiledSQL,
  SqlDimension,
  SqlFilter,
  SqlMetric,
  SqlPlan
} from "./sql.types";

interface ColumnResolution {
  sql: string;
  alias: string;
  table: string;
}

interface WhereClause {
  sql: string;
  params: unknown[];
}

export function buildSQLFromPlan(plan: SqlPlan, catalog: Catalog): CompiledSQL {
  switch (plan.intent) {
    case "lookup":
      return buildLookup(plan, catalog);
    case "aggregation":
    case "compare":
      return buildAggregation(plan, catalog);
    case "trend":
      return buildTrend(plan, catalog);
    default:
      throw new Error(`Unsupported intent: ${plan.intent}`);
  }
}

function buildLookup(plan: SqlPlan, catalog: Catalog): CompiledSQL {
  ensureSingleTable(plan);
  const table = resolveTable(plan.primaryEntity, catalog);
  const columns = plan.dimensions.length
    ? plan.dimensions.map((dim) => resolveColumn(dim.column, table, catalog))
    : Object.keys(table.columns).slice(0, 6).map((col) => ({ sql: `${table.name}.${col}`, alias: col, table: table.name }));
  const selectList = columns.map((c) => `${c.sql} AS ${quoteIdentifier(c.alias)}`).join(", ");
  const where = buildWhere(plan.filters, table, catalog);
  const order = plan.sort?.length ? buildOrder(plan.sort, columns, []) : "";
  const sql = `SELECT ${selectList || "*"} FROM ${table.name}${where.sql ? ` WHERE ${where.sql}` : ""}${order}`;
  return { sql, params: where.params };
}

function buildAggregation(plan: SqlPlan, catalog: Catalog): CompiledSQL {
  ensureSingleTable(plan);
  if (plan.metrics.length === 0) throw new Error("Aggregation plan missing metric");
  const table = resolveTable(plan.primaryEntity, catalog);
  const dims = plan.dimensions.map((dim, idx) => {
    const resolved = resolveColumn(dim.column, table, catalog);
    const selectSql = dim.timeGrain
      ? `date_trunc('${dim.timeGrain}', ${resolved.sql})`
      : resolved.sql;
    const alias = dim.timeGrain ? `${resolved.alias}_${dim.timeGrain}` : resolved.alias || `dim_${idx + 1}`;
    return { sql: selectSql, alias, ref: resolved.sql };
  });

  const metrics = plan.metrics.map((metric, idx) => resolveMetric(metric, table, catalog, idx));
  const where = buildWhere(plan.filters, table, catalog);

  const selectParts = [...dims.map((d) => `${d.sql} AS ${quoteIdentifier(d.alias)}`), ...metrics.map((m) => m.selectSql)];
  const groupBy = dims.length ? ` GROUP BY ${dims.map((_, index) => index + 1).join(", ")}` : "";
  const order = plan.sort?.length ? buildOrder(plan.sort, dims, metrics) : "";

  const sql = `SELECT ${selectParts.join(", ")}
FROM ${table.name}${where.sql ? ` WHERE ${where.sql}` : ""}${groupBy}${order}`;
  return { sql, params: where.params };
}

function buildTrend(plan: SqlPlan, catalog: Catalog): CompiledSQL {
  ensureSingleTable(plan);
  if (!plan.dimensions.length || !plan.metrics.length) {
    throw new Error("Trend plan requires dimension and metric");
  }
  const table = resolveTable(plan.primaryEntity, catalog);
  const { dim: timeDim, index: timeDimIndex } = resolveTimeDimension(plan, table);
  const metric = plan.metrics[0];
  const dimResolved = resolveColumn(timeDim.column, table, catalog);
  const grain = timeDim.timeGrain || "day";
  const metricResolved = resolveMetric(metric, table, catalog, 0);
  const where = buildWhere(plan.filters, table, catalog);

  const otherDims = plan.dimensions
    .map((dim, idx) => ({ dim, idx }))
    .filter(({ idx }) => idx !== timeDimIndex)
    .map(({ dim }) => {
      const resolved = resolveColumn(dim.column, table, catalog);
      const alias = dim.column;
      return {
        selectSql: `${resolved.sql} AS ${quoteIdentifier(alias)}`
      };
    });

  const selectParts = [
    `date_trunc('${grain}', ${dimResolved.sql}) AS period`,
    `${metricResolved.expression} AS ${quoteIdentifier(metricResolved.alias)}`,
    ...otherDims.map((d) => d.selectSql)
  ];

  const groupByParts = ["1", ...otherDims.map((_, idx) => `${idx + 3}`)];
  const orderByParts = ["1", ...otherDims.map((_, idx) => `${idx + 3}`)];

  const sql = `SELECT ${selectParts.join(",\n       ")}
FROM ${table.name}${where.sql ? ` WHERE ${where.sql}` : ""}
GROUP BY ${groupByParts.join(", ")}
ORDER BY ${orderByParts.join(", ")}`;
  return { sql, params: where.params };
}

function ensureSingleTable(plan: SqlPlan) {
  if (plan.entities.length > 1 || (plan.joinHints && plan.joinHints.length > 0)) {
    throw new Error("Multi-table plans not supported yet");
  }
}

function resolveTable(name: string, catalog: Catalog): CatalogTable & { name: string } {
  const table = catalog.tables[name];
  if (!table) {
    throw new Error(`Unknown table: ${name}`);
  }
  return { ...table, name };
}

function resolveColumn(column: string, table: CatalogTable & { name: string }, catalog: Catalog): ColumnResolution {
  if (table.columns[column]) {
    return { sql: `${table.name}.${column}`, alias: column, table: table.name };
  }

  // Attempt synonym lookup
  if (catalog.synonyms && catalog.synonyms[column]) {
    const mapped = catalog.synonyms[column];
    if (table.columns[mapped]) {
      return { sql: `${table.name}.${mapped}`, alias: mapped, table: table.name };
    }
  }

  throw new Error(`Unknown column: ${column}`);
}

function resolveTimeDimension(plan: SqlPlan, table: CatalogTable & { name: string }) {
  for (let i = 0; i < plan.dimensions.length; i++) {
    const dim = plan.dimensions[i];
    if (dim.timeGrain) {
      return { dim, index: i };
    }
  }

  for (let i = 0; i < plan.dimensions.length; i++) {
    const dim = plan.dimensions[i];
    if (isTemporalColumn(table, dim.column)) {
      return { dim, index: i };
    }
  }

  throw new Error("Trend plan missing temporal dimension");
}

function isTemporalColumn(table: CatalogTable, column: string) {
  const meta = table.columns[column];
  if (!meta) return false;
  const dt = meta.dataType.toLowerCase();
  return dt.includes("timestamp") || dt.includes("date");
}

function resolveMetric(metric: SqlMetric, table: CatalogTable & { name: string }, catalog: Catalog, idx: number) {
  if (!SQL_AGENT_ALLOWED_FUNCS.includes(metric.op)) {
    throw new Error(`Function not allowlisted: ${metric.op}`);
  }
  if (metric.op === "count" && !metric.column) {
    return {
      selectSql: `COUNT(*) AS ${quoteIdentifier(metric.alias || "count")}`,
      expression: "COUNT(*)",
      alias: metric.alias || "count"
    };
  }
  if (!metric.column) {
    throw new Error("Metric requires column");
  }
  const resolved = resolveColumn(metric.column, table, catalog);
  const alias = metric.alias || `${metric.op}_${resolved.alias}` || `metric_${idx + 1}`;
  const expression = `${metric.op.toUpperCase()}(${resolved.sql})`;
  return {
    selectSql: `${expression} AS ${quoteIdentifier(alias)}`,
    expression,
    alias,
    column: resolved
  };
}

function buildWhere(filters: SqlFilter[], table: CatalogTable & { name: string }, catalog: Catalog): WhereClause {
  if (filters.length === 0) return { sql: "", params: [] };
  const clauses: string[] = [];
  const params: unknown[] = [];
  for (const filter of filters) {
    const resolved = resolveColumn(filter.column, table, catalog);
    switch (filter.op) {
      case "eq":
        clauses.push(`${resolved.sql} = $${params.length + 1}`);
        params.push(filter.value);
        break;
      case "neq":
        clauses.push(`${resolved.sql} <> $${params.length + 1}`);
        params.push(filter.value);
        break;
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        const operator = { gt: ">", gte: ">=", lt: "<", lte: "<=" }[filter.op];
        clauses.push(`${resolved.sql} ${operator} $${params.length + 1}`);
        params.push(filter.value);
        break;
      }
      case "like":
        clauses.push(`${resolved.sql} LIKE $${params.length + 1}`);
        params.push(filter.value);
        break;
      case "between": {
        if (!Array.isArray(filter.value) || filter.value.length !== 2) {
          throw new Error("Between filter requires two values");
        }
        clauses.push(`${resolved.sql} BETWEEN $${params.length + 1} AND $${params.length + 2}`);
        params.push(filter.value[0], filter.value[1]);
        break;
      }
      case "in": {
        if (!Array.isArray(filter.value) || filter.value.length === 0) {
          throw new Error("IN filter requires values");
        }
        const placeholders = filter.value.map((_, idx) => `$${params.length + idx + 1}`).join(", ");
        clauses.push(`${resolved.sql} IN (${placeholders})`);
        params.push(...filter.value);
        break;
      }
      default:
        throw new Error(`Unsupported filter operator: ${filter.op}`);
    }
  }
  return { sql: clauses.join(" AND "), params };
}

function buildOrder(sort: NonNullable<SqlPlan["sort"]>, dims: Array<{ alias: string }>, metrics: Array<{ alias: string }>): string {
  const parts: string[] = [];
  for (const item of sort) {
    if (!item.by) continue;
    if (item.by.startsWith("metric:")) {
      const alias = item.by.split(":")[1];
      if (!metrics.some((m) => m.alias === alias)) continue;
      parts.push(`${quoteIdentifier(alias)} ${item.dir.toUpperCase()}`);
    } else if (item.by.startsWith("column:")) {
      const alias = item.by.split(":")[1];
      if (!dims.some((d) => d.alias === alias)) continue;
      parts.push(`${quoteIdentifier(alias)} ${item.dir.toUpperCase()}`);
    }
  }
  return parts.length ? ` ORDER BY ${parts.join(", ")}` : "";
}

function quoteIdentifier(id: string) {
  return `"${id.replace(/"/g, '""')}"`;
}
