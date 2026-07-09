"use client";

import { useState } from "react";
import { updateTagViaPublicLink } from "@/lib/actions/publicGroupPhoto";
import { ReviewCanvas, type ReviewTag } from "@/lib/groupPhoto/ReviewCanvas";

export function PhotoReviewView({
  token,
  photoName,
  imageUrl,
  imageWidth,
  imageHeight,
  tags,
  problemTagIds,
}: {
  token: string;
  photoName: string;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  tags: { id: string; code: string; name: string; row: number; order: number; x: number; y: number }[];
  problemTagIds: Set<string>;
}) {
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);

  const reviewTags: ReviewTag[] = tags.map((t) => ({ ...t, isProblem: problemTagIds.has(t.id) }));

  async function handleSave(tagId: string, input: { code: string; name: string }) {
    if (!input.code.trim()) return { error: "กรุณากรอกรหัส" };
    const fd = new FormData();
    fd.set("code", input.code);
    fd.set("name", input.name);
    const result = await updateTagViaPublicLink(token, tagId, null, fd);
    if (result && "error" in result) return { error: result.error };
  }

  if (problemTagIds.size === 0) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <h1 className="mb-1 text-lg font-semibold text-gray-900">{photoName} — ช่วยตรวจสอบรายชื่อ</h1>
        <p className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-700">ไม่มีรายการที่ต้องแก้ไขแล้ว — ขอบคุณครับ</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <div className="border-b border-gray-200 bg-white px-4 py-3">
        <h1 className="text-sm font-semibold text-gray-900">{photoName} — ช่วยตรวจสอบรายชื่อ</h1>
        <p className="text-xs text-gray-600">
          คลิกที่จุดซึ่งมีกรอบสีแดง ({problemTagIds.size} คน) เพื่อแก้ไขหมายเลข/ชื่อให้ถูกต้อง
        </p>
      </div>
      <div className="flex-1">
        <ReviewCanvas
          imageUrl={imageUrl}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          tags={reviewTags}
          editableTagIds={problemTagIds}
          selectedTagId={selectedTagId}
          onSelectTag={setSelectedTagId}
          onSave={handleSave}
        />
      </div>
    </div>
  );
}
