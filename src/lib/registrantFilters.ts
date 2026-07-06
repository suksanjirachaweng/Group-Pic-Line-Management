import { Prisma, RegistrantStatus } from "@/generated/prisma/client";

type SortableRegistrant = {
  displayName: string | null;
  lineUserId: string | null;
  channel: { name: string } | null;
  isFriend: boolean;
  status: string;
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
  q?: string;
  fieldKey?: string;
  fieldValue?: string;
};

/**
 * Builds the shared registrant list filter — used by both the admin list page and the
 * Excel export route so the exported file always matches what's currently on screen.
 */
export function buildRegistrantWhere(
  universityId: string,
  { status, q, fieldKey, fieldValue }: RegistrantFilterParams,
): Prisma.RegistrantWhereInput {
  return {
    universityId,
    ...(status ? { status: status as RegistrantStatus } : {}),
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
}
