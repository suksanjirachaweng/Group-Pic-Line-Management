/**
 * Sentinel `eventId` value for "not covered by any event" (see registrantFilters.ts's
 * buildRegistrantWhere for the actual query logic). Lives in its own zero-dependency module,
 * separate from registrantFilters.ts, specifically so client components (e.g.
 * EventFilterDropdown.tsx) can import just this string without pulling in registrantFilters.ts's
 * own import chain (→ resolveTagMatch.ts → lib/prisma → `pg`), which broke the client bundle with
 * "Module not found: Can't resolve 'net'" the first time this was wired up (2026-07-21).
 */
export const UNASSIGNED_EVENT_FILTER = "__unassigned__";
