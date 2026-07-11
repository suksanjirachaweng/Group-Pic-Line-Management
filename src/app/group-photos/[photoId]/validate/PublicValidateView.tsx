"use client";

import { useMemo, useState } from "react";
import { validateTags } from "@/lib/groupPhoto/validateTags";
import { ReviewCanvas, type ReviewTag } from "@/lib/groupPhoto/ReviewCanvas";
import { TagDisplayFieldPicker, type TagDisplayField } from "@/lib/groupPhoto/TagLabel";
import { colorForRow } from "@/lib/groupPhoto/rowColor";
import { updateGroupPhotoTagViaValidatePage, updateGroupPhotoTitlePublic } from "@/lib/actions/publicGroupPhoto";
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
 * One row in any of the sidebar lists (duplicate-code groups, unmatched-code list, or the "all"
 * tab) — shared so every list looks and behaves the same: light row-color tint by default, a
 * clear indigo ring/bold text when selected. `groupedByRow` drops the per-item row dot/left
 * border and the "(แถว X ลำดับ Y)" suffix for lists that are already grouped under a row header
 * (the "all" tab); duplicate/unmatched lists mix rows together, so they keep both.
 */
function TagRow({
  tag,
  isSelected,
  isProblem,
  onSelect,
  onDoubleClick,
  groupedByRow = false,
}: {
  tag: PublicValidateTagRecord;
  isSelected: boolean;
  isProblem: boolean;
  onSelect: () => void;
  onDoubleClick: () => void;
  groupedByRow?: boolean;
}) {
  const rowColor = colorForRow(tag.row);
  return (
    <li
      className={isSelected ? "relative z-10 rounded-md ring-2 ring-inset ring-indigo-600 bg-indigo-100" : undefined}
      style={
        isSelected
          ? undefined
          : { backgroundColor: `${rowColor}1A`, borderLeft: groupedByRow ? undefined : `4px solid ${rowColor}` }
      }
    >
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={onDoubleClick}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:brightness-95"
      >
        {isSelected ? (
          <span className="shrink-0 text-indigo-600" aria-hidden>
            ●
          </span>
        ) : (
          !groupedByRow && (
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: rowColor }} />
          )
        )}
        <span className={`font-mono ${isSelected ? "font-bold" : isProblem ? "text-red-600" : "text-gray-700"}`}>
          {tag.code || "—"}
        </span>
        <span className={`truncate text-gray-600 ${isSelected ? "font-semibold" : ""}`}>
          {tag.name.trim() || "(ยังไม่มีชื่อ)"}
        </span>
        {!groupedByRow && (
          <span className="shrink-0 text-xs text-gray-400">
            แถว {tag.row} ลำดับ {tag.order}
          </span>
        )}
        {isProblem && (
          <span className="ml-auto shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
            ปัญหา
          </span>
        )}
      </button>
    </li>
  );
}

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
  const [tags, setTags] = useState<PublicValidateTagRecord[]>(initialTags);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [listMode, setListMode] = useState<"problems" | "all">("problems");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [displayFields, setDisplayFields] = useState<Set<TagDisplayField>>(
    () => new Set<TagDisplayField>(["name"]),
  );
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState("");
  const [editName, setEditName] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

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
  const duplicateGroups = problems.filter((p) => p.type === "DUPLICATE_CODE");
  const unmatchedIds = new Set(problems.filter((p) => p.type === "UNMATCHED_CODE").map((p) => p.tagId));
  const unmatchedTags = tags.filter((t) => unmatchedIds.has(t.id));
  const tagsById = new Map(tags.map((t) => [t.id, t]));
  const problemTagIdSet = new Set(problems.flatMap((p) => (p.type === "DUPLICATE_CODE" ? p.tagIds : [p.tagId])));

  const tagsByRow = useMemo(() => {
    const byRow = new Map<number, PublicValidateTagRecord[]>();
    for (const t of tags) {
      const arr = byRow.get(t.row) ?? [];
      arr.push(t);
      byRow.set(t.row, arr);
    }
    for (const arr of byRow.values()) arr.sort((a, b) => a.order - b.order);
    return [...byRow.entries()].sort((a, b) => a[0] - b[0]);
  }, [tags]);

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
  const visibleReviewTags = listMode === "problems" ? reviewTags.filter((t) => t.isProblem) : reviewTags;

  function switchListMode(mode: "problems" | "all") {
    setListMode(mode);
    setSelectedTagId(null);
  }

  function openEditDialog(tag: PublicValidateTagRecord) {
    setEditingTagId(tag.id);
    setEditCode(tag.code);
    setEditName(tag.name);
    setEditError(null);
  }

  async function handleSaveEdit() {
    if (!editingTagId) return;
    if (!editCode.trim()) {
      setEditError("กรุณากรอกหมายเลข");
      return;
    }
    setEditSaving(true);
    setEditError(null);
    const fd = new FormData();
    fd.set("code", editCode);
    fd.set("name", editName);
    const result = await updateGroupPhotoTagViaValidatePage(photoId, editingTagId, null, fd);
    setEditSaving(false);
    if (result && "error" in result) {
      setEditError(result.error);
      return;
    }
    const normalizedCode = editCode.trim().replace(/\D+/g, "");
    setTags((prev) =>
      prev.map((t) => (t.id === editingTagId ? { ...t, code: editCode.trim(), name: editName.trim(), normalizedCode } : t)),
    );
    setEditingTagId(null);
  }

  return (
    <div className="flex h-dvh flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-gray-200 bg-white px-3 py-2 sm:px-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/nsl-logo.png" alt="Newsalon" className="h-7 w-auto shrink-0" />
        <div className="flex min-w-0 flex-1 justify-center">
          {editingTitle ? (
            <div className="flex w-full max-w-xl flex-col items-center gap-1.5">
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
                className="w-full resize-none rounded-md border border-gray-300 px-2.5 py-1.5 text-center text-sm leading-snug"
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
                <span className="text-xs text-gray-400">Ctrl/Cmd+Enter = บันทึก</span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-0.5 text-center">
              <div className="flex items-center gap-1.5">
                <h1 className="whitespace-pre-wrap text-sm font-semibold leading-snug text-gray-900">{displayTitle}</h1>
                <button
                  type="button"
                  onClick={() => {
                    setTitleValue(currentTitle ?? "");
                    setEditingTitle(true);
                  }}
                  title="แก้ไขหัวข้อรูป"
                  className="shrink-0 text-gray-400 hover:text-gray-600"
                >
                  ✎
                </button>
              </div>
              {currentTitle?.trim() && currentTitle.trim() !== photoName && (
                <span className="text-xs text-gray-400">(คณะ: {photoName})</span>
              )}
              <span className="text-xs text-gray-500">ตรวจสอบความถูกต้อง — แท็กแล้ว {tags.length} คน</span>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <TagDisplayFieldPicker value={displayFields} onChange={setDisplayFields} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        {sidebarOpen && (
          <div className="max-h-[45vh] w-full shrink-0 overflow-y-auto border-b border-gray-200 bg-white p-4 md:h-auto md:max-h-none md:w-96 md:border-b-0 md:border-r">
          <p className="mb-3 text-xs text-gray-500">แตะรายชื่อด้านล่าง เพื่อดูตำแหน่งในรูป</p>

          <div className="mb-3 flex items-center gap-1 rounded-md border border-gray-300 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => switchListMode("problems")}
              className={`flex-1 rounded px-2 py-1 font-medium ${listMode === "problems" ? "bg-indigo-600 text-white" : "text-gray-600 hover:bg-gray-50"}`}
            >
              เฉพาะที่มีปัญหา ({problems.length})
            </button>
            <button
              type="button"
              onClick={() => switchListMode("all")}
              className={`flex-1 rounded px-2 py-1 font-medium ${listMode === "all" ? "bg-indigo-600 text-white" : "text-gray-600 hover:bg-gray-50"}`}
            >
              ทั้งหมด ({tags.length})
            </button>
          </div>

          {listMode === "problems" ? (
            <>
              {problems.length === 0 ? (
                <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">ไม่พบปัญหา — ข้อมูลพร้อม export</p>
              ) : (
                <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  พบ {problems.length} รายการที่อาจต้องตรวจสอบก่อน export (ยัง export ได้ตามปกติ) — รูปด้านขวาแสดงเฉพาะจุดเหล่านี้
                </p>
              )}

              {duplicateGroups.length > 0 && (
                <div className="mb-4">
                  <h2 className="mb-2 text-sm font-semibold text-gray-900">เลขซ้ำในรูปเดียวกัน ({duplicateGroups.length})</h2>
                  <div className="space-y-3">
                    {duplicateGroups.map((g) =>
                      g.type === "DUPLICATE_CODE" ? (
                        <div key={g.normalizedCode}>
                          <p className="mb-1 px-0.5 text-xs font-semibold text-red-600">รหัสซ้ำ: {g.normalizedCode}</p>
                          <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
                            {g.tagIds
                              .map((id) => tagsById.get(id))
                              .filter((t): t is PublicValidateTagRecord => !!t)
                              .map((t) => (
                                <TagRow
                                  key={t.id}
                                  tag={t}
                                  isSelected={t.id === selectedTagId}
                                  isProblem
                                  onSelect={() => setSelectedTagId(t.id)}
                                  onDoubleClick={() => openEditDialog(t)}
                                />
                              ))}
                          </ul>
                        </div>
                      ) : null,
                    )}
                  </div>
                </div>
              )}

              {unmatchedTags.length > 0 && (
                <div className="mb-6">
                  <h2 className="mb-2 text-sm font-semibold text-gray-900">
                    ไม่พบในระบบลงทะเบียน/ไฟล์อ้างอิง ({unmatchedTags.length})
                  </h2>
                  <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
                    {unmatchedTags.map((t) => (
                      <TagRow
                        key={t.id}
                        tag={t}
                        isSelected={t.id === selectedTagId}
                        isProblem
                        onSelect={() => setSelectedTagId(t.id)}
                        onDoubleClick={() => openEditDialog(t)}
                      />
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="mb-4 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">
                รายชื่อทั้งหมด {tags.length} คน — ดับเบิลคลิกที่จุดในรูปเพื่อแก้ไขรหัส/ชื่อ (เผื่อสะกดผิด)
              </p>
              <div className="space-y-4">
                {tagsByRow.map(([row, rowTags]) => {
                  const rowColor = colorForRow(row);
                  return (
                  <div key={row}>
                    <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900">
                      <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: rowColor }} />
                      แถว {row} ({rowTags.length})
                    </h2>
                    <ul
                      className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-l-4 border-gray-200"
                      style={{ borderLeftColor: rowColor }}
                    >
                      {rowTags.map((t) => (
                        <TagRow
                          key={t.id}
                          tag={t}
                          isSelected={t.id === selectedTagId}
                          isProblem={problemTagIdSet.has(t.id)}
                          onSelect={() => setSelectedTagId(t.id)}
                          onDoubleClick={() => openEditDialog(t)}
                          groupedByRow
                        />
                      ))}
                    </ul>
                  </div>
                  );
                })}
              </div>
            </>
          )}
          </div>
        )}

        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? "ย่อแผงรายชื่อ" : "แสดงแผงรายชื่อ"}
          className="hidden w-5 shrink-0 items-center justify-center border-r border-gray-200 bg-white text-gray-400 hover:bg-gray-50 hover:text-gray-700 md:flex"
        >
          {sidebarOpen ? "‹" : "›"}
        </button>
        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          className="flex shrink-0 items-center justify-center gap-1 border-b border-gray-200 bg-gray-50 py-2 text-xs font-medium text-gray-600 active:bg-gray-100 md:hidden"
        >
          {sidebarOpen ? "ซ่อนรายชื่อ ▲" : "แสดงรายชื่อ ▼"}
        </button>

        <div className="min-h-0 flex-1">
          <ReviewCanvas
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
            labelOnlySelected
          />
        </div>
      </div>

      {editingTagId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !editSaving && setEditingTagId(null)}
        >
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-sm font-semibold text-gray-900">แก้ไขข้อมูล</h3>
            <label className="block text-xs font-medium text-gray-700">รหัส</label>
            <input
              value={editCode}
              onChange={(e) => setEditCode(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
              autoFocus
            />
            <label className="mt-3 block text-xs font-medium text-gray-700">ชื่อ-นามสกุล</label>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="เว้นว่างไว้ก่อนได้"
              className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
            />
            {editError && <p className="mt-2 text-xs text-red-600">{editError}</p>}
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
                disabled={editSaving || !editCode.trim()}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {editSaving ? "กำลังบันทึก..." : "บันทึก"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
