"use client";

import { useState } from "react";
import { ReviewCanvas, type ReviewTag } from "@/lib/groupPhoto/ReviewCanvas";
import type { TagDisplayField } from "@/lib/groupPhoto/TagLabel";
import { updateOwnTagPosition, reportTagProblem, confirmOwnTag } from "@/lib/actions/publicGroupPhoto";

const PHOTO_VIEW_DISPLAY_FIELDS = new Set<TagDisplayField>(["code"]);

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
  const [positionError, setPositionError] = useState<string | null>(null);
  const [reported, setReported] = useState(initialReportedProblem);
  const [reporting, setReporting] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [showReportConfirm, setShowReportConfirm] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const ownTag = localTags.find((t) => t.id === initialTagId) ?? null;

  const displayTags = pendingPosition && initialTagId
    ? localTags.map((t) => (t.id === initialTagId ? { ...t, x: pendingPosition.x, y: pendingPosition.y } : t))
    : localTags;
  const reviewTags: ReviewTag[] = displayTags.map((t) => ({ ...t, isProblem: false }));

  function startPlacing() {
    setPendingPosition(null);
    setPositionError(null);
    setPlacing(true);
  }
  function cancelPlacing() {
    setPendingPosition(null);
    setPlacing(false);
  }
  async function confirmPlacing() {
    if (!initialTagId || !pendingPosition) return;
    setSavingPosition(true);
    setPositionError(null);
    try {
      await updateOwnTagPosition(groupPhotoId, initialTagId, pendingPosition.x, pendingPosition.y);
      setLocalTags((prev) => prev.map((t) => (t.id === initialTagId ? { ...t, ...pendingPosition } : t)));
      setPendingPosition(null);
      setPlacing(false);
    } catch (err) {
      setPositionError(`บันทึกไม่สำเร็จ: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setSavingPosition(false);
    }
  }

  async function handleReportConfirmed() {
    if (!initialTagId) return;
    setShowReportConfirm(false);
    setReporting(true);
    setReportError(null);
    try {
      await reportTagProblem(groupPhotoId, initialTagId);
      setReported(true);
    } catch (err) {
      setReportError(`แจ้งไม่สำเร็จ: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setReporting(false);
    }
  }

  async function handleConfirmCorrect() {
    if (!initialTagId) return;
    setConfirming(true);
    setConfirmError(null);
    try {
      await confirmOwnTag(groupPhotoId, initialTagId);
      setConfirmed(true);
      setTimeout(() => {
        try {
          window.close();
        } catch {
          // best-effort — most browsers block script-closing a user-navigated tab; the visible
          // close (X) control in LINE's in-app browser is the fallback either way
        }
      }, 1200);
    } catch (err) {
      setConfirmError(`ยืนยันไม่สำเร็จ: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setConfirming(false);
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

        {ownTag && !placing && !confirmed && (
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={handleConfirmCorrect}
              disabled={confirming}
              className="w-full rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
            >
              {confirming ? "กำลังยืนยัน..." : "✓ ข้อมูลถูกต้อง"}
            </button>
            <div className="grid grid-cols-2 gap-1.5">
              {editLiffUrl && (
                <a
                  href={editLiffUrl}
                  className="rounded-md border border-gray-300 px-2 py-1.5 text-center text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  ✎ ชื่อ/รหัสผิด
                </a>
              )}
              <button
                type="button"
                onClick={startPlacing}
                className={`rounded-md border border-gray-300 px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 ${editLiffUrl ? "" : "col-span-2"}`}
              >
                ⌖ ตำแหน่งผิด
              </button>
            </div>
            <button
              type="button"
              onClick={() => setShowReportConfirm(true)}
              disabled={reported || reporting}
              className="w-full rounded-md border border-red-300 px-2 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              {reported ? "แจ้งปัญหาแล้ว ✓" : reporting ? "กำลังแจ้ง..." : "⚠ ไม่ใช่รูปของฉัน"}
            </button>
            {reportError && <p className="text-xs text-red-600">{reportError}</p>}
          </div>
        )}

        {confirmed && (
          <div className="rounded-md bg-green-50 px-3 py-2 text-sm font-medium text-green-700">
            ✓ ยืนยันข้อมูลถูกต้องแล้ว ขอบคุณครับ — ปิดหน้าต่างนี้ได้เลย
          </div>
        )}
        {confirmError && <p className="text-xs text-red-600">{confirmError}</p>}

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
            {positionError && <p className="mt-1.5 text-red-600">{positionError}</p>}
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
          displayFields={PHOTO_VIEW_DISPLAY_FIELDS}
          soloLabelTagId={initialTagId}
          placementTagId={placing ? initialTagId : null}
          onPlaceTag={(_id, x, y) => setPendingPosition({ x, y })}
          readOnly
        />
      </div>

      {showReportConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowReportConfirm(false)}
        >
          <div className="w-full max-w-xs rounded-lg bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-gray-900">แจ้งปัญหารูปนี้?</p>
            <p className="mt-1 text-xs text-gray-600">แอดมินจะตรวจสอบให้ภายหลังครับ</p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowReportConfirm(false)}
                className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleReportConfirmed}
                className="rounded-md bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-700"
              >
                ยืนยันแจ้งปัญหา
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
