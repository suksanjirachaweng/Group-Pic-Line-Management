"use client";

import { useState } from "react";
import { ReviewCanvas, type ReviewTag } from "@/lib/groupPhoto/ReviewCanvas";
import { updateOwnTagPosition, reportTagProblem } from "@/lib/actions/publicGroupPhoto";

export function PhotoViewClient({
  groupPhotoId,
  photoName,
  imageUrl,
  imageWidth,
  imageHeight,
  tags,
  initialTagId,
  editLiffUrl,
  initialReportedProblem,
}: {
  groupPhotoId: string;
  photoName: string;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  tags: { id: string; code: string; name: string; row: number; order: number; x: number; y: number }[];
  initialTagId: string | null;
  editLiffUrl: string | null;
  initialReportedProblem: boolean;
}) {
  const [selectedTagId, setSelectedTagId] = useState(initialTagId);
  const [localTags, setLocalTags] = useState(tags);
  const [placing, setPlacing] = useState(false);
  const [pendingPosition, setPendingPosition] = useState<{ x: number; y: number } | null>(null);
  const [savingPosition, setSavingPosition] = useState(false);
  const [reported, setReported] = useState(initialReportedProblem);
  const [reporting, setReporting] = useState(false);

  const ownTag = localTags.find((t) => t.id === initialTagId) ?? null;

  const displayTags = pendingPosition && initialTagId
    ? localTags.map((t) => (t.id === initialTagId ? { ...t, x: pendingPosition.x, y: pendingPosition.y } : t))
    : localTags;
  const reviewTags: ReviewTag[] = displayTags.map((t) => ({ ...t, isProblem: false }));

  function startPlacing() {
    setPendingPosition(null);
    setPlacing(true);
  }
  function cancelPlacing() {
    setPendingPosition(null);
    setPlacing(false);
  }
  async function confirmPlacing() {
    if (!initialTagId || !pendingPosition) return;
    setSavingPosition(true);
    try {
      await updateOwnTagPosition(groupPhotoId, initialTagId, pendingPosition.x, pendingPosition.y);
      setLocalTags((prev) => prev.map((t) => (t.id === initialTagId ? { ...t, ...pendingPosition } : t)));
      setPendingPosition(null);
      setPlacing(false);
    } catch (err) {
      window.alert(`บันทึกตำแหน่งใหม่ไม่สำเร็จ: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setSavingPosition(false);
    }
  }

  async function handleReportProblem() {
    if (!initialTagId) return;
    if (!window.confirm("แจ้งว่ารูป/ตำแหน่งนี้มีปัญหา (เช่น เลขไปขึ้นผิดคณะ) ให้แอดมินตรวจสอบภายหลัง?")) return;
    setReporting(true);
    try {
      await reportTagProblem(groupPhotoId, initialTagId);
      setReported(true);
    } catch (err) {
      window.alert(`แจ้งปัญหาไม่สำเร็จ: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setReporting(false);
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <div className="space-y-2 border-b border-gray-200 bg-white px-4 py-3">
        <div>
          <h1 className="whitespace-pre-wrap text-sm font-semibold leading-snug text-gray-900">{photoName}</h1>
          {ownTag ? (
            <p className="text-xs text-gray-600">
              ตำแหน่งของคุณ: <span className="font-mono font-semibold">{ownTag.code}</span>{" "}
              {ownTag.name || "(ยังไม่มีชื่อ)"}
            </p>
          ) : (
            <p className="text-xs text-gray-600">รูปถ่ายหมู่</p>
          )}
        </div>

        {ownTag && !placing && (
          <div className="flex flex-wrap items-center gap-2">
            {editLiffUrl && (
              <a
                href={editLiffUrl}
                className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                ชื่อ/รหัสของฉันผิด — แก้ไขข้อมูลลงทะเบียน
              </a>
            )}
            <button
              type="button"
              onClick={startPlacing}
              className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              ตำแหน่งไม่ตรง — แก้ไขตำแหน่ง
            </button>
            <button
              type="button"
              onClick={handleReportProblem}
              disabled={reported || reporting}
              className="rounded-md border border-red-300 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              {reported ? "แจ้งปัญหาแล้ว ✓" : reporting ? "กำลังแจ้ง..." : "รูปนี้ไม่ใช่ของฉัน / แจ้งปัญหาอื่น"}
            </button>
          </div>
        )}

        {placing && (
          <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <p className="font-medium">แตะตำแหน่งที่ถูกต้องของคุณในรูป</p>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={cancelPlacing}
                className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={confirmPlacing}
                disabled={!pendingPosition || savingPosition}
                className="rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {savingPosition ? "กำลังบันทึก..." : "บันทึกตำแหน่งใหม่"}
              </button>
            </div>
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
          soloLabelTagId={initialTagId}
          placementTagId={placing ? initialTagId : null}
          onPlaceTag={(_id, x, y) => setPendingPosition({ x, y })}
          readOnly
        />
      </div>
    </div>
  );
}
