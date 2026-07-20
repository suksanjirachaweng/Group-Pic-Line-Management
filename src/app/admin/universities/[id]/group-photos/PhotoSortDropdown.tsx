"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

const OPTIONS: { key: "upload" | "name" | "status"; label: string }[] = [
  { key: "upload", label: "ลำดับอัปโหลด" },
  { key: "name", label: "ชื่อ" },
  { key: "status", label: "สถานะ" },
];

/**
 * Replaces the old two-button "เรียงตาม" toggle pair with a real dropdown, matching the pattern
 * already established by EventFilterDropdown/FacultyFaceBankBrowser's own sort selects elsewhere
 * in this app — a single field pick, no separate direction toggle (each field just sorts in the
 * one direction that makes sense for it: upload = oldest-first, name = A→ฮ, status = workflow
 * priority order, see PHOTO_STATUS_SORT_RANK in page.tsx).
 */
export function PhotoSortDropdown({ value }: { value: "upload" | "name" | "status" }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(key: string) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("tab", "photos");
    sp.set("psort", key);
    sp.delete("pdir"); // direction toggling was retired along with the old button pair
    router.push(`${pathname}?${sp.toString()}`);
  }

  return (
    <select
      value={value}
      onChange={(e) => handleChange(e.target.value)}
      className="w-full min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm sm:w-auto sm:flex-none sm:min-w-[14rem]"
      aria-label="เรียงตาม"
    >
      {OPTIONS.map((o) => (
        <option key={o.key} value={o.key}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
