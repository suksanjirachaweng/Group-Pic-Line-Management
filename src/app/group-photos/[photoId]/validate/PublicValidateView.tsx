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
import { useIsLandscapeMobile } from "@/lib/groupPhoto/useIsLandscapeMobile";
import { useIsMobileWidth } from "@/lib/groupPhoto/useIsMobileWidth";
import { useVisualViewportRect } from "@/lib/groupPhoto/useVisualViewportRect";
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
  const isLandscapeMobile = useIsLandscapeMobile();
  const isMobileWidth = useIsMobileWidth();
  const [tags, setTags] = useState<PublicValidateTagRecord[]>(initialTags);
  // On mobile, default to whichever problem row the sidebar's "problems" tab renders first (a
  // duplicate-code group's first tag, else the first unnamed unmatched tag, else the first named
  // one — same bucket order TagListSidebar itself uses), so opening the link immediately shows
  // the first thing that needs attention — centered/zoomed via ReviewCanvas's own
  // centered-on-selection-change effect — instead of a blank overview. A lazy initializer (React
  // only ever calls this once, on the very first render) rather than a mount effect, since
  // setting state synchronously inside an effect body is exactly the kind of thing
  // react-hooks/set-state-in-effect flags — this needs no effect at all.
  const [selectedTagId, setSelectedTagId] = useState<string | null>(() => {
    if (typeof window === "undefined" || window.innerWidth > 767) return null;
    const initialProblems = validateTags(initialTags);
    const duplicateGroup = initialProblems.find((p) => p.type === "DUPLICATE_CODE");
    if (duplicateGroup && duplicateGroup.type === "DUPLICATE_CODE" && duplicateGroup.tagIds[0]) {
      return duplicateGroup.tagIds[0];
    }
    const unmatchedIds = new Set(
      initialProblems.filter((p) => p.type === "UNMATCHED_CODE").map((p) => p.tagId),
    );
    const unmatchedTags = initialTags.filter((t) => unmatchedIds.has(t.id));
    const first = unmatchedTags.find((t) => !t.name.trim()) ?? unmatchedTags[0];
    return first ? first.id : null;
  });
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
  // Drives the mobile floating edit dialog below — only listens to visualViewport while a mobile
  // edit is actually in progress, so a page that's never edited on mobile never pays for it.
  const mobileDialogViewportRect = useVisualViewportRect(isMobileWidth && editingTagId !== null);

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

  // Opens the custom edit popup anchored to this tag's marker on the canvas (via ReviewCanvas's
  // `editingTagId`/`renderEditPopup`) — restores the original "popup right next to the person
  // you're editing" behavior. Force the sidebar open too, so the corresponding list row stays
  // visible for context.
  //
  // Always pans/zooms to the target (unconditionally, like the original behavior) — an
  // "only if offscreen" variant was tried and reverted: it made the framing inconsistent between
  // clicks (some centered, some not) and, on mobile, meant the very first auto-selected problem
  // tag on page load never zoomed in at all, since it was technically already "visible" in the
  // fully-zoomed-out overview.
  //
  // Explicitly closes any currently-open popup, pans/zooms, and only opens the new popup on the
  // next frame (after the pan/zoom commit has actually painted) — rather than setting
  // `editingTagId` in the same synchronous batch as the pan — so the popup never has to be
  // positioned from a pan/zoom state that hasn't been committed yet.
  function openEditDialog(tag: PublicValidateTagRecord) {
    setEditingTagId(null);
    setSidebarOpen(true);
    setSelectedTagId(tag.id);
    canvasRef.current?.centerOnTag(tag.x, tag.y);
    requestAnimationFrame(() => {
      setEditingTagId(tag.id);
      setEditCode(tag.code);
      setEditName(tag.name);
      setEditOriginalName(tag.name);
      setEditError(null);
      setEditHistory(null);
      setEditHistoryOpen(false);
    });
  }

  // A plain click/select (as opposed to double-click-to-edit via `openEditDialog`) never used to
  // touch `editingTagId` — so selecting a different row while a popup was already open left that
  // stale popup on screen, still showing the previous tag's code/name, just visually dragged
  // along to wherever the pan/zoom-on-select landed (since its position is recomputed from the
  // *old* tag's coordinates against the *new* pan/zoom). Closing it here whenever the selection
  // moves to a genuinely different tag avoids that.
  function selectTag(tagId: string | null) {
    setSelectedTagId(tagId);
    if (editingTagId !== null && tagId !== editingTagId) {
      setEditingTagId(null);
    }
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

  const editFormNode = (
    <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-xl">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-gray-500">รหัส {editCode}</span>
        <button
          type="button"
          onClick={() => setEditingTagId(null)}
          disabled={editSaving}
          className="shrink-0 text-gray-400 hover:text-gray-600 disabled:opacity-50"
          aria-label="ยกเลิก"
        >
          ✕
        </button>
      </div>
      <label className="block text-xs font-medium text-gray-700">ชื่อ-นามสกุล</label>
      <input
        value={editName}
        onChange={(e) => setEditName(e.target.value)}
        placeholder="เว้นว่างไว้ก่อนได้"
        className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
        autoFocus
      />
      {editError && <p className="mt-1 text-xs text-red-600">{editError}</p>}

      {/* Save/Cancel come right after the input, before the (usually-collapsed) history section
          — on a short keyboard-open viewport, the primary actions being the very next thing
          after the input means there's nothing to scroll past to reach them. */}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => setEditingTagId(null)}
          disabled={editSaving}
          className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          ยกเลิก
        </button>
        <button
          type="button"
          onClick={handleSaveEdit}
          disabled={editSaving}
          className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium text-white disabled:opacity-50 ${
            editNameChanged ? "bg-indigo-600 hover:bg-indigo-700" : "bg-green-600 hover:bg-green-700"
          }`}
        >
          {editSaving ? "กำลังบันทึก..." : editNameChanged ? "บันทึก" : "ยืนยัน"}
        </button>
      </div>

      <button
        type="button"
        onClick={() => setEditHistoryOpen((v) => !v)}
        className="mt-3 flex w-full items-center justify-between text-xs font-medium text-gray-500 hover:text-gray-700"
      >
        <span>ประวัติการแก้ไข{editHistory ? ` (${editHistory.length})` : ""}</span>
        <span>{editHistoryOpen ? "▲" : "▼"}</span>
      </button>
      {editHistoryOpen && (
        <div className="mt-1 max-h-28 space-y-1 overflow-y-auto">
          {editHistory === null && <p className="text-xs text-gray-400">กำลังโหลด...</p>}
          {editHistory?.length === 0 && (
            <p className="text-xs text-gray-400">ยังไม่มีประวัติ</p>
          )}
          {editHistory?.map((h) => (
            <div key={h.id} className="rounded-md bg-gray-50 px-2 py-1 text-xs">
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
                <span className="font-mono">{h.code}</span> — {h.name || "(ยังไม่มีชื่อ)"}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // On mobile portrait (not the landscape 2-column layout), show the photo before the list
  // instead of after it — the marker for whatever's selected (the auto-selected first problem on
  // load, or a row tapped afterward) is the thing to look at first; the list is for browsing/
  // switching, better reached by scrolling down to it than pushed above the photo.
  //
  // This used to be a JS-computed boolean (`isMobileWidth`) that swapped which node came first in
  // the JSX. That state starts `false` on both the server and the client's first render (no
  // `window` during SSR), so the real first-paint HTML always rendered list-then-photo — on an
  // actual phone, the correct reversed order only appeared once the client's `useLayoutEffect` ran
  // a moment later, which read as the list visibly jumping from top to bottom right after load.
  // Using a plain CSS `order` utility instead — gated on the `portrait:`/`max-md:` media query
  // Tailwind compiles to — applies at first paint with no JS involved, so there's nothing to jump.
  const sidebarNode = (
    <div className="max-md:portrait:order-2">
      <TagListSidebar
        tags={tags}
        selectedTagId={selectedTagId}
        onSelectTag={(t) => selectTag(t ? t.id : null)}
        onEditTag={openEditDialog}
        displayFields={displayFields}
        open={sidebarOpen}
        onToggleOpen={() => setSidebarOpen((v) => !v)}
        listMode={listMode}
        onListModeChange={switchListMode}
        emptyMessage="ไม่พบปัญหา — ข้อมูลพร้อม export"
        landscapeMobile={isLandscapeMobile}
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
    </div>
  );

  // The custom edit popup only renders here on non-mobile (`editingTagId={null}` on mobile
  // suppresses it) — mobile instead gets its own fixed, visualViewport-centered dialog (below),
  // since anchoring next to a marker doesn't leave reliable room once the on-screen keyboard eats
  // a large chunk of the screen (see `mobileDialogViewportRect`'s doc comment).
  const canvasNode = (
    <div className="min-h-0 flex-1 max-md:portrait:order-1">
      <ReviewCanvas
        ref={canvasRef}
        imageUrl={imageUrl}
        imageWidth={imageWidth}
        imageHeight={imageHeight}
        tags={visibleReviewTags}
        selectedTagId={selectedTagId}
        onSelectTag={selectTag}
        displayFields={displayFields}
        onDoubleClickTag={(t) => {
          const full = tagsById.get(t.id);
          if (full) openEditDialog(full);
        }}
        readOnly
        grayUnselected
        hideToolbar
        fitHeightOnMobileOrientation
        editingTagId={isMobileWidth ? null : editingTagId}
        renderEditPopup={() => editFormNode}
      />
    </div>
  );

  return (
    <div className="flex h-dvh flex-col">
      {/* Stacked (logo, then title below it) and compact on mobile — a title beside the logo
          only gets a narrow leftover column to wrap in, which on a long university/faculty name
          multiplies into many lines and eats most of the screen; putting it below the logo gives
          it the full width instead, and smaller fonts/gaps keep the whole block short. Desktop
          keeps the original side-by-side row, which already has plenty of width to spare. */}
      <div className="flex flex-col items-center gap-1 border-b border-gray-200 bg-white px-3 py-1.5 sm:px-4 md:flex-row md:gap-3 md:py-2">
        <div className="flex shrink-0 flex-col items-center gap-0.5 md:gap-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/nsl-logo.png" alt="Newsalon" className="h-6 w-auto md:h-7" />
          {currentTitle?.trim() && currentTitle.trim() !== photoName && (
            <span className="text-[10px] leading-tight text-gray-400 md:text-[11px]">
              (คณะ: {photoName})
            </span>
          )}
        </div>
        <div className="min-w-0 w-full flex-1">
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
            <div className="flex flex-col items-center gap-1 md:flex-row md:justify-center md:gap-2">
              <h1 className="whitespace-pre-wrap text-center text-xs font-semibold leading-tight text-gray-900 md:text-sm md:leading-snug">
                {displayTitle}
              </h1>
              <button
                type="button"
                onClick={() => {
                  setTitleValue(currentTitle ?? "");
                  setEditingTitle(true);
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-300 px-1.5 py-0.5 text-[11px] font-medium text-gray-600 hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-600 md:px-2 md:py-1 md:text-xs"
              >
                <span aria-hidden>✎</span> แก้ไข
              </button>
            </div>
          )}
        </div>
        {/* Hidden on mobile — an export button competes with the tag list/photo for very
            little screen space there, and exporting a Word doc isn't a mobile-first action;
            desktop keeps it, matching the bottom toolbar's own hidden-on-mobile convention. */}
        <div className="hidden shrink-0 md:block">
          <WordExportButton photoId={photoId} />
        </div>
      </div>

      <div className={`flex min-h-0 flex-1 overflow-hidden md:flex-row ${isLandscapeMobile ? "flex-row" : "flex-col"}`}>
        {sidebarNode}
        {canvasNode}
      </div>

      {/* Mobile-only floating edit dialog — a true `position: fixed` overlay, but sized/positioned
          from `window.visualViewport` (via `mobileDialogViewportRect`) so it centers within
          whatever space is actually visible above the on-screen keyboard, instead of the full
          (keyboard-obscured) layout viewport. Backdrop click dismisses, matching normal dialog
          conventions. Desktop keeps the marker-anchored popup inside ReviewCanvas instead (see
          `canvasNode` above), which has no keyboard to work around. */}
      {isMobileWidth && editingTagId && mobileDialogViewportRect && (
        <div
          className="fixed inset-x-0 z-50 flex items-center justify-center bg-black/40 px-4"
          style={{ top: mobileDialogViewportRect.top, height: mobileDialogViewportRect.height }}
          onClick={() => setEditingTagId(null)}
        >
          <div className="w-full max-w-xs" onClick={(e) => e.stopPropagation()}>
            {editFormNode}
          </div>
        </div>
      )}

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

    </div>
  );
}
