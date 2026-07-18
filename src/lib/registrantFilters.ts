import { Prisma, RegistrantStatus, DeliveryStatus } from "@/generated/prisma/client";
import { matchesConditionTree, type Condition, type ConditionGroup, type ConditionOperator } from "@/lib/rules/evaluate";
import { buildEventScopedRegistrantWhere } from "@/lib/groupPhoto/resolveTagMatch";

export const CONDITION_OPERATORS: { value: ConditionOperator; label: string }[] = [
  { value: "eq", label: "=" },
  { value: "neq", label: "≠" },
  { value: "contains", label: "contains" },
  { value: "gt", label: ">" },
  { value: "gte", label: ">=" },
  { value: "lt", label: "<" },
  { value: "lte", label: "<=" },
  { value: "after", label: "after (date)" },
  { value: "before", label: "before (date)" },
  { value: "is_not_empty", label: "is not empty" },
  { value: "is_empty", label: "is empty" },
];

const OPERATORS_NOT_NEEDING_VALUE = new Set<ConditionOperator>(["is_empty", "is_not_empty"]);

export type AdvancedConditionRow = { field?: string; operator?: string; value?: string };

/**
 * Builds an AND condition group from advanced-filter rows, dropping incomplete rows (no
 * field, no operator, or missing value for operators that need one). Returns null if no
 * row is usable — evaluated in-memory via the same interpreter the rule engine uses, never
 * as raw SQL, so a field name typo just matches nothing rather than being a query risk.
 */
export function buildAdvancedConditionGroup(rows: AdvancedConditionRow[]): ConditionGroup | null {
  const conditions: Condition[] = rows
    .filter((r): r is { field: string; operator: ConditionOperator; value?: string } => {
      if (!r.field || !r.operator) return false;
      if (!CONDITION_OPERATORS.some((o) => o.value === r.operator)) return false;
      if (!OPERATORS_NOT_NEEDING_VALUE.has(r.operator as ConditionOperator) && !r.value) return false;
      return true;
    })
    .map((r) => ({ field: r.field, operator: r.operator, value: r.value }));

  return conditions.length > 0 ? { op: "AND", conditions } : null;
}

/** Filters registrants against an advanced condition group, evaluated against their `data`. */
export function filterByAdvancedConditions<T extends { data: unknown }>(
  registrants: T[],
  group: ConditionGroup | null,
): T[] {
  if (!group) return registrants;
  return registrants.filter((r) => matchesConditionTree(group, (r.data ?? {}) as Record<string, unknown>));
}

type SortableRegistrant = {
  displayName: string | null;
  lineUserId: string | null;
  channel: { name: string } | null;
  isFriend: boolean;
  status: string;
  deliveryStatus: string;
  registeredAt: Date;
  data: unknown;
};

/**
 * Sorts registrants by a fixed column (name/lineUserId/channel/friend/status/registered) or,
 * when `sortBy` matches a university-defined field key, by that field's value in `data`.
 * Done in application code rather than the DB — Prisma can't order by a JSON path portably,
 * and at this app's scale (~thousands of registrants per university) sorting in memory after
 * the where-filter is simpler than raw SQL and avoids injection risk from a dynamic path.
 */
export function sortRegistrants<T extends SortableRegistrant>(
  registrants: T[],
  sortBy: string | undefined,
  sortDir: string | undefined,
  formFieldKeys: Set<string>,
): T[] {
  if (!sortBy) return registrants;
  const key = sortBy;
  const dir = sortDir === "desc" ? -1 : 1;
  const isFieldKey = formFieldKeys.has(key);

  function getValue(r: T): string | number {
    if (isFieldKey) return ((r.data ?? {}) as Record<string, string>)[key] ?? "";
    switch (key) {
      case "name":
        return r.displayName ?? "";
      case "lineUserId":
        return r.lineUserId ?? "";
      case "channel":
        return r.channel?.name ?? "";
      case "friend":
        return r.isFriend ? 1 : 0;
      case "status":
        return r.status;
      case "deliveryStatus":
        return r.deliveryStatus;
      case "registered":
        return r.registeredAt.getTime();
      default:
        return "";
    }
  }

  return [...registrants].sort((a, b) => {
    const va = getValue(a);
    const vb = getValue(b);
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
    return String(va).localeCompare(String(vb), "th") * dir;
  });
}

export type RegistrantFilterParams = {
  status?: string;
  deliveryStatus?: string;
  q?: string;
  fieldKey?: string;
  fieldValue?: string;
  photoEventId?: string;
};

/**
 * Builds the shared registrant list filter — used by both the admin list page and the
 * Excel export route so the exported file always matches what's currently on screen.
 *
 * `eventWindow` (the selected event's own `startDate`/`endDate`) is passed separately from
 * `photoEventId` rather than folded into `RegistrantFilterParams` because it isn't a raw URL
 * param — callers already have to fetch the `PhotoEvent` row to resolve the id in the first
 * place, so this just takes what they already have. Combined via `AND` (not spread) with the
 * base filter because both `buildEventScopedRegistrantWhere`'s bootstrap logic and the `q` search
 * above independently need the `OR` key — spreading them would silently drop one.
 */
export function buildRegistrantWhere(
  universityId: string,
  { status, deliveryStatus, q, fieldKey, fieldValue, photoEventId }: RegistrantFilterParams,
  eventWindow?: { startDate: Date; endDate: Date },
): Prisma.RegistrantWhereInput {
  const base: Prisma.RegistrantWhereInput = {
    universityId,
    ...(status ? { status: status as RegistrantStatus } : {}),
    ...(deliveryStatus ? { deliveryStatus: deliveryStatus as DeliveryStatus } : {}),
    ...(q
      ? {
          OR: [
            { displayName: { contains: q, mode: "insensitive" as const } },
            { lineUserId: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(fieldKey && fieldValue
      ? {
          data: {
            path: [fieldKey],
            string_contains: fieldValue,
          },
        }
      : {}),
  };

  if (!photoEventId || !eventWindow) return base;
  return { AND: [base, buildEventScopedRegistrantWhere(universityId, photoEventId, eventWindow)] };
}
