"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { validateTags } from "@/lib/groupPhoto/validateTags";
import {
  ReviewCanvas,
  type ReviewCanvasHandle,
  type ReviewTag,
} from "@/lib/groupPhoto/ReviewCanvas";
import {
  TagDisplayFieldPicker,
  type TagDisplayField,
} from "@/lib/groupPhoto/TagLabel";
import { TagListSidebar } from "@/lib/groupPhoto/TagListSidebar";
import { ZoomButtons } from "@/lib/groupPhoto/ZoomButtons";
import { WordExportButton } from "@/lib/groupPhoto/ExportButtons";
import {
  updateGroupPhotoTagViaValidatePage,
  updateGroupPhotoTitlePublic,
  getGroupPhotoTagHistoryPublic,
} from "@/lib/actions/publicGroupPhoto";
import type { TagHistoryEntry } from "@/lib/actions/groupPhotos";
import { TagMatchSource } from "@/generated/prisma/enums";

const HISTORY_SOURCE_LABEL: Record<TagHistoryEntry["source"], string> = {
  ADMIN: "แก้ไขโดยแอดมิน",
  AUTO_SYNC: "อัปเดตอัตโนมัติ",
  PUBLIC_LINK: "แก้ไขผ่านลิงก์แชร์",
};

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
  editedViaPublicLink: boolean;
  confirmedViaPublicLink: boolean;
};

/**
 * Public version of the tagging validate report — no login, no messaging, and no links back into
 * the admin area (see ImportMarkFileButton/SharePhotoLinksButton callers: this is the page a
 * forwarded link opens for someone without an admin account). Double-clicking a marker does allow
 * a quick code/name fix — same "the link is the credential" model as /photo-review/[token],
 * deliberately not gated further (product decision: anyone holding this link may correct a tag).
 */
export function PublicValidateView({
  photoId,
  photoName,
  photoTitle,
  imageUrl,
  imageWidth,
  imageHeight,
  initialTags,
}: {
  photoId: string;
  photoName: string;
  photoTitle: string | null;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  initialTags: PublicValidateTagRecord[];
}) {
  const canvasRef = useRef<ReviewCanvasHandle>(null);
  const [tags, setTags] = useState<PublicValidateTagRecord[]>(initialTags);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [listMode, setListMode] = useState<"problems" | "all">("problems");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [displayFields, setDisplayFields] = useState<Set<TagDisplayField>>(
    () => new Set<TagDisplayField>(["order", "name"]),
  );
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState("");
  const [editName, setEditName] = useState("");
  const [editOriginalName, setEditOriginalName] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editHistory, setEditHistory] = useState<TagHistoryEntry[] | null>(
    null,
  );
  const [editHistoryOpen, setEditHistoryOpen] = useState(false);

  // Fetch fresh every time a different tag's dialog opens — most edit sessions never open this
  // section, so it's not worth preloading alongside the rest of the tag list.
  useEffect(() => {
    if (!editingTagId) return;
    let cancelled = false;
    getGroupPhotoTagHistoryPublic(photoId, editingTagId).then((rows) => {
      if (!cancelled) setEditHistory(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [editingTagId, photoId]);

  // iOS Safari quirk: a `position: fixed` element does NOT shrink to the visible area when the
  // on-screen keyboard opens — it stays sized to the full (un-shrunk) layout viewport, with the
  // keyboard just visually covering whatever ends up underneath it. `overflow-y-auto` alone isn't
  // enough to reliably compensate (the browser's own "scroll focused input into view" behavior
  // fights with it). Tracking `visualViewport` directly and sizing/positioning the dialog to match
  // it exactly is the standard fix — the dialog then always matches the actual visible rectangle,
  // keyboard included, on any browser that supports the API (falls back to the plain CSS
  // fixed/inset-0 sizing everywhere else, including desktop, where this never mattered anyway).
  const [viewportRect, setViewportRect] = useState<{ height: number; top: number } | null>(null);
  useEffect(() => {
    if (!editingTagId) return;
    const vv = window.visualViewport;
    if (!vv) return;
    function update() {
      // `visualViewport.height` can transiently report 0 (e.g. mid-resize, right as the
      // keyboard animation starts) — applying that would collapse the dialog to nothing, so
      // ignore obviously-bogus readings and just wait for the next resize/scroll event.
      if (vv!.height <= 0) return;
      setViewportRect({ height: vv!.height, top: vv!.offsetTop });
    }
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [editingTagId]);

  const [currentTitle, setCurrentTitle] = useState(photoTitle);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(photoTitle ?? "");
  const [titleSaving, setTitleSaving] = useState(false);
  const displayTitle = currentTitle?.trim() || photoName;

  async function saveTitle() {
    const next = titleValue.trim() || null;
    setTitleSaving(true);
    try {
      await updateGroupPhotoTitlePublic(photoId, next);
      setCurrentTitle(next);
      setEditingTitle(false);
    } finally {
      setTitleSaving(false);
    }
  }

  const problems = useMemo(() => validateTags(tags), [tags]);
  const tagsById = new Map(tags.map((t) => [t.id, t]));
  const problemTagIdSet = new Set(
    problems.flatMap((p) =>
      p.type === "DUPLICATE_CODE" ? p.tagIds : [p.tagId],
    ),
  );

  const reviewTags: ReviewTag[] = tags.map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    row: t.row,
    order: t.order,
    x: t.x,
    y: t.y,
    isProblem: problemTagIdSet.has(t.id),
  }));
  // In the default "problems" tab, the photo shows only the flagged points — matching exactly
  // what the sidebar lists, so a first-time visitor sees "here are the N spots to check" instead
  // of hunting for a handful of red rings among hundreds of unrelated pins. Switching to "all"
  // shows everyone, for browsing the whole photo.
  const visibleReviewTags =
    listMode === "problems"
      ? reviewTags.filter((t) => t.isProblem)
      : reviewTags;

  function switchListMode(mode: "problems" | "all") {
    setListMode(mode);
    setSelectedTagId(null);
  }

  function openEditDialog(tag: PublicValidateTagRecord) {
    setEditingTagId(tag.id);
    setEditCode(tag.code);
    setEditName(tag.name);
    setEditOriginalName(tag.name);
    setEditError(null);
    setEditHistory(null);
    setEditHistoryOpen(false);
  }

  const editNameChanged = editName.trim() !== editOriginalName.trim();

  async function handleSaveEdit() {
    if (!editingTagId) return;
    setEditSaving(true);
    setEditError(null);
    const fd = new FormData();
    fd.set("code", editCode);
    fd.set("name", editName);
    const result = await updateGroupPhotoTagViaValidatePage(
      photoId,
      editingTagId,
      null,
      fd,
    );
    setEditSaving(false);
    if (result && "error" in result) {
      setEditError(result.error);
      return;
    }
    const normalizedCode = editCode.trim().replace(/\D+/g, "");
    const nameChanged = editNameChanged;
    setTags((prev) =>
      prev.map((t) =>
        t.id === editingTagId
          ? {
              ...t,
              code: editCode.trim(),
              name: editName.trim(),
              normalizedCode,
              ...(nameChanged
                ? { editedViaPublicLink: true }
                : { confirmedViaPublicLink: true }),
            }
          : t,
      ),
    );
    setEditingTagId(null);
  }

  return (
    <div className="flex h-dvh flex-col">
      {/* On a small screen the list + photo genuinely don't fit usefully in portrait — block the
          page with a rotate prompt instead of rendering a cramped layout. Desktop is unaffected
          (max-md: only matches small screens regardless of orientation). */}
      <div className="fixed inset-0 z-50 hidden flex-col items-center justify-center gap-3 bg-white px-6 text-center max-md:portrait:flex">
        <span className="text-4xl" aria-hidden>
          📱↻
        </span>
        <p className="text-sm font-medium text-gray-700">กรุณาหมุนหน้าจอเป็นแนวนอน เพื่อใช้งานหน้านี้</p>
      </div>
      <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-3 py-2 sm:px-4">
        <div className="flex shrink-0 flex-col items-center gap-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/nsl-logo.png" alt="Newsalon" className="h-7 w-auto" />
          {currentTitle?.trim() && currentTitle.trim() !== photoName && (
            <span className="text-[11px] leading-tight text-gray-400">
              (คณะ: {photoName})
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {editingTitle ? (
            <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-1.5">
              <textarea
                autoFocus
                rows={3}
                value={titleValue}
                onChange={(e) => setTitleValue(e.target.value)}
                placeholder={photoName}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void saveTitle();
                  } else if (e.key === "Escape") {
                    setEditingTitle(false);
                  }
                }}
                className="w-full resize-none rounded-md border border-gray-300 px-2.5 py-1.5 text-left text-sm leading-snug"
              />
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={titleSaving}
                  onClick={saveTitle}
                  className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {titleSaving ? "..." : "บันทึก"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingTitle(false)}
                  className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
                >
                  ยกเลิก
                </button>
                <span className="text-xs text-gray-400">
                  Ctrl/Cmd+Enter = บันทึก
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2">
              <h1 className="whitespace-pre-wrap text-center text-sm font-semibold leading-snug text-gray-900">
                {displayTitle}
              </h1>
              <button
                type="button"
                onClick={() => {
                  setTitleValue(currentTitle ?? "");
                  setEditingTitle(true);
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-600"
              >
                <span aria-hidden>✎</span> แก้ไข
              </button>
            </div>
          )}
        </div>
        <div className="shrink-0">
          <WordExportButton photoId={photoId} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden max-md:landscape:flex-row md:flex-row">
        <TagListSidebar
          tags={tags}
          selectedTagId={selectedTagId}
          onSelectTag={(t) => setSelectedTagId(t ? t.id : null)}
          onEditTag={openEditDialog}
          displayFields={displayFields}
          open={sidebarOpen}
          onToggleOpen={() => setSidebarOpen((v) => !v)}
          listMode={listMode}
          onListModeChange={switchListMode}
          emptyMessage="ไม่พบปัญหา — ข้อมูลพร้อม export"
          renderBadges={(t) =>
            t.editedViaPublicLink ? (
              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                แก้ไข
              </span>
            ) : t.confirmedViaPublicLink ? (
              <span className="rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
                ยืนยัน
              </span>
            ) : null
          }
        />

        <div className="min-h-0 flex-1">
          <ReviewCanvas
            ref={canvasRef}
            imageUrl={imageUrl}
            imageWidth={imageWidth}
            imageHeight={imageHeight}
            tags={visibleReviewTags}
            selectedTagId={selectedTagId}
            onSelectTag={setSelectedTagId}
            displayFields={displayFields}
            onDoubleClickTag={(t) => {
              const full = tagsById.get(t.id);
              if (full) openEditDialog(full);
            }}
            readOnly
            grayUnselected
            hideToolbar
          />
        </div>
      </div>

      {/* Hidden entirely on mobile — zoom is pinch/drag there already, and the hint text +
          display-field checkboxes are just clutter competing with the photo/list for the little
          screen space a phone (even in landscape) has. Desktop keeps the full toolbar. */}
      <div className="hidden items-center gap-3 border-t border-gray-200 bg-white px-3 py-2 text-xs md:flex md:flex-wrap">
        <ZoomButtons
          onZoomOut={() => canvasRef.current?.zoomOut()}
          onZoomIn={() => canvasRef.current?.zoomIn()}
        />
        <span className="text-gray-400">
          Ctrl +/- = ซูม, Ctrl+0 = พอดีจอ, Spacebar+ลาก = เลื่อนภาพ,
          ดับเบิลคลิกจุดในรูปหรือรายชื่อ = แก้ไขชื่อ
        </span>
        <div className="ml-auto">
          <TagDisplayFieldPicker
            value={displayFields}
            onChange={setDisplayFields}
          />
        </div>
      </div>

      {editingTagId && (
        // items-start + a scrollable backdrop (not just the card) instead of items-center: on a
        // phone in landscape the on-screen keyboard alone can cover half the already-short
        // viewport, so a vertically-centered dialog gets its Save button pushed behind the
        // keyboard with no way to reach it. Starting the dialog near the top keeps the
        // interactive part in the remaining visible strip in most cases, and letting the
        // backdrop itself scroll is the fallback for whenever it still doesn't fit. The inline
        // style (when viewportRect is available) pins this to the real visualViewport rectangle
        // instead of trusting `inset-0`/`100dvh`, which iOS Safari does not shrink for the
        // keyboard on a `position: fixed` element — see the effect above for the full story.
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
          style={
            viewportRect
              ? { top: viewportRect.top, height: viewportRect.height, bottom: "auto" }
              : undefined
          }
          onClick={() => !editSaving && setEditingTagId(null)}
        >
          <div
            className="my-8 w-full max-w-sm rounded-lg bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-gray-900">
              แก้ไขชื่อ-นามสกุล
            </h3>
            <p className="mb-3 text-xs text-gray-400">รหัส {editCode}</p>
            <label className="block text-xs font-medium text-gray-700">
              ชื่อ-นามสกุล
            </label>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="เว้นว่างไว้ก่อนได้"
              className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
              autoFocus
            />
            {editError && (
              <p className="mt-2 text-xs text-red-600">{editError}</p>
            )}

            <div className="mt-3 border-t border-gray-100 pt-2">
              <button
                type="button"
                onClick={() => setEditHistoryOpen((v) => !v)}
                className="flex w-full items-center justify-between text-xs font-medium text-gray-500 hover:text-gray-700"
              >
                <span>
                  ประวัติการแก้ไข{editHistory ? ` (${editHistory.length})` : ""}
                </span>
                <span>{editHistoryOpen ? "▲" : "▼"}</span>
              </button>
              {editHistoryOpen && (
                <div className="mt-2 max-h-32 space-y-1.5 overflow-y-auto">
                  {editHistory === null && (
                    <p className="text-xs text-gray-400">กำลังโหลด...</p>
                  )}
                  {editHistory?.length === 0 && (
                    <p className="text-xs text-gray-400">ยังไม่มีประวัติ</p>
                  )}
                  {editHistory?.map((h) => (
                    <div
                      key={h.id}
                      className="rounded-md bg-gray-50 px-2 py-1.5 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2 text-gray-400">
                        <span>
                          {new Date(h.createdAt).toLocaleString("th-TH", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                        </span>
                        <span>{HISTORY_SOURCE_LABEL[h.source]}</span>
                      </div>
                      <p className="mt-0.5 text-gray-700">
                        <span className="font-mono">{h.code}</span> —{" "}
                        {h.name || "(ยังไม่มีชื่อ)"}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingTagId(null)}
                disabled={editSaving}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={editSaving}
                className={`rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${
                  editNameChanged
                    ? "bg-indigo-600 hover:bg-indigo-700"
                    : "bg-green-600 hover:bg-green-700"
                }`}
              >
                {editSaving
                  ? "กำลังบันทึก..."
                  : editNameChanged
                    ? "บันทึก"
                    : "ยืนยัน"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
