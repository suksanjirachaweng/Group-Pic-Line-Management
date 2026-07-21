"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { PhotoEventListItem } from "@/lib/actions/photoEvents";
import { UNASSIGNED_EVENT_FILTER } from "@/lib/registrantEventFilterSentinel";

/**
 * Shared event-scope selector for the group-photos and registrants pages — renders nothing when a
 * university has 0 or 1 events (and `includeUnassignedOption` is off), so the common
 * (single-event) case looks exactly like it always has. Preserves every other existing query
 * param (tab/sort/status/etc.) when switching events, matching how every other filter control on
 * these pages already behaves.
 *
 * `includeUnassignedOption` (Registrants page only — group photos/legacy references always have a
 * real, non-nullable `photoEventId`, so this doesn't apply there) adds a filter for registrants
 * that are neither stamped to any event nor bootstrap-eligible for one — see
 * UNASSIGNED_EVENT_FILTER's own docs. Forces the dropdown to render even with ≤1 real event, since
 * that's exactly the situation (only one event exists, and its date window already passed) where
 * this option matters most.
 */
export function EventFilterDropdown({
  events,
  selectedEventId,
  includeUnassignedOption = false,
}: {
  events: PhotoEventListItem[];
  selectedEventId: string;
  includeUnassignedOption?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (events.length <= 1 && !includeUnassignedOption) return null;

  function handleChange(eventId: string) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("eventId", eventId);
    router.push(`${pathname}?${sp.toString()}`);
  }

  return (
    <select
      value={selectedEventId}
      onChange={(e) => handleChange(e.target.value)}
      className="w-full min-w-0 max-w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm sm:w-auto"
      aria-label="เลือกงานถ่ายรูป"
    >
      {events.map((e) => (
        <option key={e.id} value={e.id}>
          {e.code}
          {e.label ? ` — ${e.label}` : ""}
        </option>
      ))}
      {includeUnassignedOption && (
        <option value={UNASSIGNED_EVENT_FILTER}>ไม่อยู่ใน event ไหน (นอกช่วงวันที่ทุก event)</option>
      )}
    </select>
  );
}
