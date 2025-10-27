// Layer 2: Orchestration - Query Classifier
export type RetrievalTarget = "vector" | "sql" | "web";

export type RouteDecision = {
  mode: "retrieve" | "direct";
  complexity: "low" | "medium" | "high";
  targets: RetrievalTarget[];
};

export function classifyQuery(q: string): RouteDecision {
  const len = q.split(/\s+/).length;
  const hasOps = /join|aggregate|compare|timeline|pipeline|why|how/i.test(q);
  const sqlIndicators = /\b(select|from|table|column|join|where|group by|order by|count|sum|avg|max|min)\b/i.test(
    q
  );
  const recencyIndicators = /\b(latest|today|yesterday|current|news|update|recent|202[4-9]|2025)\b/i.test(
    q
  );
  const complexity = hasOps ? (len > 12 ? "high" : "medium") : len < 6 ? "low" : "medium";
  const mode: "retrieve" | "direct" = hasOps || len > 6 ? "retrieve" : "direct";
  const targets: RetrievalTarget[] = ["vector"];
  if (sqlIndicators) targets.push("sql");
  if (recencyIndicators) targets.push("web");
  const uniqueTargets = Array.from(new Set(targets));
  return { mode, complexity, targets: uniqueTargets };
}
