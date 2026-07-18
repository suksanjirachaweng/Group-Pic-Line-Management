"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { PhotoEventListItem } from "@/lib/actions/photoEvents";

/**
 * Shared event-scope selector for the group-photos and registrants pages — renders nothing when a
 * university has 0 or 1 events, so the common (single-event) case looks exactly like it always
 * has. Preserves every other existing query param (tab/sort/status/etc.) when switching events,
 * matching how every other filter control on these pages already behaves.
 */
export function EventFilterDropdown({
  events,
  selectedEventId,
}: {
  events: PhotoEventListItem[];
  selectedEventId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (events.length <= 1) return null;

  function handleChange(eventId: string) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("eventId", eventId);
    router.push(`${pathname}?${sp.toString()}`);
  }

  return (
    <select
      value={selectedEventId}
      onChange={(e) => handleChange(e.target.value)}
      className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm"
      aria-label="เลือกงานถ่ายรูป"
    >
      {events.map((e) => (
        <option key={e.id} value={e.id}>
          {e.code}
          {e.label ? ` — ${e.label}` : ""}
        </option>
      ))}
    </select>
  );
}
