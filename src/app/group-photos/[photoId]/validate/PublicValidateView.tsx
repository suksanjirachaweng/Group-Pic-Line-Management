"use client";

import { useMemo, useState } from "react";
import { validateTags } from "@/lib/groupPhoto/validateTags";
import { ReviewCanvas, type ReviewTag } from "@/lib/groupPhoto/ReviewCanvas";
import { TagMatchSource } from "@/generated/prisma/enums";

export type PublicValidateTagRecord = {
  id: string;
  code: string;
  normalizedCode: string;
  name: string;
  row: number;
  order: number;
  x: number;
  y: number;
  matchSource: TagMatchSource;
};

/**
 * Public, read-only version of the tagging validate report — no login, no editing, no
 * messaging, and no links back into the admin area (see ImportMarkFileButton/SharePhotoLinksButton
 * callers: this is the page a forwarded link opens for someone without an admin account).
 */
export function PublicValidateView({
  photoId,
  photoName,
  imageUrl,
  imageWidth,
  imageHeight,
  initialTags,
}: {
  photoId: string;
  photoName: string;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  initialTags: PublicValidateTagRecord[];
}) {
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);

  const problems = useMemo(() => validateTags(initialTags), [initialTags]);
  const duplicateGroups = problems.filter((p) => p.type === "DUPLICATE_CODE");
  const unmatchedIds = new Set(problems.filter((p) => p.type === "UNMATCHED_CODE").map((p) => p.tagId));
  const unmatchedTags = initialTags.filter((t) => unmatchedIds.has(t.id));
  const tagsById = new Map(initialTags.map((t) => [t.id, t]));
  const problemTagIdSet = new Set(problems.flatMap((p) => (p.type === "DUPLICATE_CODE" ? p.tagIds : [p.tagId])));

  const reviewTags: ReviewTag[] = initialTags.map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    row: t.row,
    order: t.order,
    x: t.x,
    y: t.y,
    isProblem: problemTagIdSet.has(t.id),
  }));

  return (
    <div className="flex h-screen flex-col">
      <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/nsl-logo.jpg" alt="Newsalon" className="h-7 w-7 rounded-full object-cover" />
        <h1 className="text-sm font-semibold text-gray-900">{photoName} — ตรวจสอบความถูกต้อง</h1>
        <span className="text-sm text-gray-600">แท็กแล้ว {initialTags.length} คน</span>
        <div className="ml-auto flex gap-2">
          <a
            href={`/api/group-photos/${photoId}/export/excel`}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Export Excel (.xlsx)
          </a>
          <a
            href={`/api/group-photos/${photoId}/export/text`}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Export ข้อความ (.txt)
          </a>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-96 shrink-0 overflow-y-auto border-r border-gray-200 bg-white p-4">
          {problems.length === 0 ? (
            <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">ไม่พบปัญหา — ข้อมูลพร้อม export</p>
          ) : (
            <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              พบ {problems.length} รายการที่อาจต้องตรวจสอบก่อน export (ยัง export ได้ตามปกติ) — คลิกรายการเพื่อดูตำแหน่งในรูป
            </p>
          )}

          {duplicateGroups.length > 0 && (
            <div className="mb-4">
              <h2 className="mb-2 text-sm font-semibold text-gray-900">เลขซ้ำในรูปเดียวกัน ({duplicateGroups.length})</h2>
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                {duplicateGroups.map((g) =>
                  g.type === "DUPLICATE_CODE" ? (
                    <li key={g.normalizedCode} className="px-3 py-2 text-sm">
                      <span className="font-mono text-red-600">{g.normalizedCode}</span>
                      <ul className="mt-1 space-y-1">
                        {g.tagIds
                          .map((id) => tagsById.get(id))
                          .filter(Boolean)
                          .map((t) => (
                            <li key={t!.id}>
                              <button
                                type="button"
                                onClick={() => setSelectedTagId(t!.id)}
                                className="text-left text-indigo-600 hover:underline"
                              >
                                {t!.name.trim() || "(ยังไม่มีชื่อ)"} (แถว {t!.row} ลำดับ {t!.order})
                              </button>
                            </li>
                          ))}
                      </ul>
                    </li>
                  ) : null,
                )}
              </ul>
            </div>
          )}

          {unmatchedTags.length > 0 && (
            <div className="mb-6">
              <h2 className="mb-2 text-sm font-semibold text-gray-900">
                ไม่พบในระบบลงทะเบียน/ไฟล์อ้างอิง ({unmatchedTags.length})
              </h2>
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                {unmatchedTags.map((t) => (
                  <li key={t.id} className="px-3 py-2 text-sm">
                    <button
                      type="button"
                      onClick={() => setSelectedTagId(t.id)}
                      className="text-left text-indigo-600 hover:underline"
                    >
                      <span className="font-mono text-amber-600">{t.code}</span> — {t.name.trim() || "(ยังไม่มีชื่อ)"} (แถว {t.row} ลำดับ {t.order})
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex-1">
          <ReviewCanvas
            imageUrl={imageUrl}
            imageWidth={imageWidth}
            imageHeight={imageHeight}
            tags={reviewTags}
            selectedTagId={selectedTagId}
            onSelectTag={setSelectedTagId}
            readOnly
          />
        </div>
      </div>
    </div>
  );
}
