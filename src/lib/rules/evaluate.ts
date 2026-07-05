export type ConditionOperator =
  | "eq"
  | "neq"
  | "contains"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "before"
  | "after"
  | "is_empty"
  | "is_not_empty";

export type Condition = {
  field: string;
  operator: ConditionOperator;
  value?: string | number;
};

export type ConditionGroup = {
  op: "AND" | "OR";
  conditions: (Condition | ConditionGroup)[];
};

type ConditionNode = Condition | ConditionGroup;

function isGroup(node: ConditionNode): node is ConditionGroup {
  return "op" in node && "conditions" in node;
}

function matchesCondition(condition: Condition, data: Record<string, unknown>): boolean {
  const raw = data[condition.field];

  switch (condition.operator) {
    case "eq":
      return String(raw ?? "") === String(condition.value ?? "");
    case "neq":
      return String(raw ?? "") !== String(condition.value ?? "");
    case "contains":
      return String(raw ?? "").includes(String(condition.value ?? ""));
    case "gt":
      return Number(raw) > Number(condition.value);
    case "lt":
      return Number(raw) < Number(condition.value);
    case "gte":
      return Number(raw) >= Number(condition.value);
    case "lte":
      return Number(raw) <= Number(condition.value);
    case "before":
      return raw !== undefined && new Date(String(raw)) < new Date(String(condition.value));
    case "after":
      return raw !== undefined && new Date(String(raw)) > new Date(String(condition.value));
    case "is_empty":
      return raw === undefined || raw === null || raw === "";
    case "is_not_empty":
      return raw !== undefined && raw !== null && raw !== "";
    default:
      return false;
  }
}

/** Recursively evaluates an AND/OR condition tree against a registrant's dynamic field data. */
export function matchesConditionTree(node: ConditionNode, data: Record<string, unknown>): boolean {
  if (isGroup(node)) {
    return node.op === "AND"
      ? node.conditions.every((c) => matchesConditionTree(c, data))
      : node.conditions.some((c) => matchesConditionTree(c, data));
  }
  return matchesCondition(node, data);
}

/** Replaces {{field}} placeholders with the registrant's display name or dynamic field data. */
export function interpolateTemplate(
  template: string,
  registrant: { displayName?: string | null; data: Record<string, unknown> },
): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
    if (key === "displayName" || key === "lineDisplayName") return registrant.displayName ?? "";
    return String(registrant.data[key] ?? "");
  });
}
