import { Prisma, RegistrantStatus } from "@/generated/prisma/client";

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
