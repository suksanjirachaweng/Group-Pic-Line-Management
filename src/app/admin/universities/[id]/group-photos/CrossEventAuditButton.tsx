"use client";

import { useState, useTransition } from "react";
import {
  findCrossEventTagMismatches,
  type CrossEventTagMismatch,
} from "@/lib/actions/crossEventTagAudit";

const SOURCE_LABEL: Record<string, string> = {
  REGISTRANT: "LINE",
  LEGACY_REFERENCE: "Excel",
  MANUAL: "ไม่พบข้อมูล",
};

/**
 * One-off diagnostic for the 2026-07-22 cross-event tag-matching bug (see
 * crossEventTagAudit.ts's doc comment) — lets an admin find every tag across every event of this
 * university whose saved name no longer agrees with what today's event-scoped matching would
 * produce, so the already-saved fallout from before the fix can be found and reviewed.
 */
export function CrossEventAuditButton({ universityId }: { universityId: string }) {
  const [results, setResults] = useState<CrossEventTagMismatch[] | null>(null);
  const [isPending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const rows = await findCrossEventTagMismatches(universityId);
      setResults(rows);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={run}
        disabled={isPending}
        className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
      >
        {isPending ? "กำลังตรวจสอบ..." : "ตรวจสอบ tag ที่จับคู่ข้าม event"}
      </button>

      {results && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
              <h2 className="text-base font-semibold text-gray-900">
                Tag ที่จับคู่ข้าม event ({results.length})
              </h2>
              <button
                type="button"
                onClick={() => setResults(null)}
                className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-gray-50"
              >
                ปิด
              </button>
            </div>
            <div className="overflow-y-auto p-5">
              {results.length === 0 ? (
                <p className="text-sm text-gray-500">ไม่พบ tag ที่จับคู่ข้าม event เลย</p>
              ) : (
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                      <th className="py-2 pr-3">รูป / Event</th>
                      <th className="py-2 pr-3">Code</th>
                      <th className="py-2 pr-3">ชื่อที่บันทึกไว้ (ผิด)</th>
                      <th className="py-2 pr-3">ชื่อที่ถูกต้อง</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r) => (
                      <tr key={r.tagId} className="border-b border-gray-100">
                        <td className="py-2 pr-3 text-gray-700">
                          {r.groupPhotoName}
                          <div className="text-xs text-gray-400">{r.photoEventName}</div>
                        </td>
                        <td className="py-2 pr-3 font-mono text-gray-900">{r.code}</td>
                        <td className="py-2 pr-3">
                          <span className="text-red-600">{r.currentName}</span>
                          <span className="ml-1 text-xs text-gray-400">
                            ({SOURCE_LABEL[r.currentMatchSource]})
                          </span>
                        </td>
                        <td className="py-2 pr-3">
                          <span className="text-emerald-700">
                            {r.correctName ?? "(ไม่พบ — จะกลายเป็น MANUAL)"}
                          </span>
                          <span className="ml-1 text-xs text-gray-400">
                            ({SOURCE_LABEL[r.correctMatchSource]})
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
