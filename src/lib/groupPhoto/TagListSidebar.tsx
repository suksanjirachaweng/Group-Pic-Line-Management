"use client";

import { useMemo, useState, type ReactNode } from "react";
import { validateTags, problemTagIds, type TagForValidation } from "./validateTags";
import { colorForRow } from "./rowColor";
import type { TagDisplayField } from "./TagLabel";

type BaseTag = TagForValidation & { code: string; name: string; row: number; order: number };

/**
 * One row in any of the sidebar lists (duplicate-code groups, unmatched-code list, or the "all"
 * tab) — shared so every list looks and behaves the same: light row-color tint by default, a
 * clear indigo ring/bold text when selected. Which of order/code/name actually render follows
 * `displayFields`. `groupedByRow` drops the per-item row dot/left border for lists that are
 * already grouped under a row header (the "all" tab); duplicate/unmatched lists mix rows
 * together, so they keep it.
 */
function TagRow<T extends BaseTag>({
  tag,
  isSelected,
  isProblem,
  onSelect,
  onDoubleClick,
  displayFields,
  groupedByRow = false,
  extraBadges,
  inlineEdit,
}: {
  tag: T;
  isSelected: boolean;
  isProblem: boolean;
  onSelect: () => void;
  onDoubleClick: () => void;
  displayFields: Set<TagDisplayField>;
  groupedByRow?: boolean;
  extraBadges?: ReactNode;
  /** Swaps this row's normal button content for an inline edit form — used by the public
   * validate page instead of a modal dialog (see TagListSidebar's own doc comment for why). */
  inlineEdit?: ReactNode;
}) {
  const rowColor = colorForRow(tag.row);
  if (inlineEdit) {
    return (
      <li className="relative z-10 rounded-md ring-2 ring-inset ring-indigo-600 bg-indigo-50">
        {inlineEdit}
      </li>
    );
  }
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
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:brightness-95 max-md:landscape:gap-1.5 max-md:landscape:px-2 max-md:landscape:py-1.5 max-md:landscape:text-xs"
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
        {displayFields.has("order") && (
          <span className={`shrink-0 font-mono ${isSelected ? "font-bold text-gray-900" : "text-gray-400"}`}>
            {tag.order}
          </span>
        )}
        {displayFields.has("code") && (
          <span className={`font-mono ${isSelected ? "font-bold" : isProblem ? "text-red-600" : "text-gray-700"}`}>
            {tag.code || "—"}
          </span>
        )}
        {displayFields.has("name") && (
          <span className={`truncate text-gray-600 ${isSelected ? "font-semibold" : ""}`}>
            {tag.name.trim() || "(ยังไม่มีชื่อ)"}
          </span>
        )}
        {(extraBadges || isProblem) && (
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {extraBadges}
            {isProblem && <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">ปัญหา</span>}
          </span>
        )}
      </button>
    </li>
  );
}

/** One collapsible section header (a problem category, or a row in the "all" tab) — click to
 * show/hide its rows, independent of the other sections. Defaults open so nothing looks hidden
 * on first load. */
function CollapsibleGroup({
  title,
  count,
  colorDot,
  children,
}: {
  title: string;
  count: number;
  colorDot?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-2 flex w-full items-center gap-2 text-left text-sm font-semibold text-gray-900"
      >
        {colorDot && (
          <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: colorDot }} />
        )}
        <span className="flex-1">
          {title} ({count})
        </span>
        <span aria-hidden className="shrink-0 text-xs text-gray-400">
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && children}
    </div>
  );
}

/**
 * Problem/all tag list + collapse toggle, shared by the admin tagging canvas and the public
 * validate page so the two "which tags need attention" views can't drift apart. Renders itself
 * as a fragment (panel + both toggle buttons) — the caller places it as a flex sibling next to
 * its canvas, same layout either page uses.
 */
export function TagListSidebar<T extends BaseTag>({
  tags,
  selectedTagId,
  onSelectTag,
  onEditTag,
  displayFields,
  open,
  onToggleOpen,
  listMode,
  onListModeChange,
  renderBadges,
  emptyMessage = "ไม่พบปัญหา",
  editingTagId,
  renderInlineEdit,
}: {
  tags: T[];
  selectedTagId: string | null;
  onSelectTag: (tag: T | null) => void;
  onEditTag: (tag: T) => void;
  displayFields: Set<TagDisplayField>;
  open: boolean;
  onToggleOpen: () => void;
  listMode: "problems" | "all";
  onListModeChange: (mode: "problems" | "all") => void;
  renderBadges?: (tag: T) => ReactNode;
  emptyMessage?: string;
  /** When set, the row matching this id renders `renderInlineEdit(tag)` instead of its normal
   * button — the public validate page's mobile-safe alternative to a modal edit dialog (see
   * TagRow's `inlineEdit` prop). Admin usage leaves both unset and keeps the modal-dialog flow
   * via `onEditTag`. */
  editingTagId?: string | null;
  renderInlineEdit?: (tag: T) => ReactNode;
}) {
  function switchListMode(mode: "problems" | "all") {
    onListModeChange(mode);
    onSelectTag(null);
  }

  // Which "no name yet" vs "already filled in" bucket a tag belongs to is frozen per tag id the
  // first time it's seen, not recomputed live — otherwise typing a name into a "no name" row
  // mid-review yanks it into the other list the instant it saves, which is disorienting when
  // working down the list one row at a time. A tag only moves buckets on the next full page
  // load. Same "adjust state during render when a prop changes" pattern TagEditDialog uses for
  // syncedInitial — tags not yet seen (e.g. added later via mark-file import) get folded in, and
  // likewise frozen, the first render they appear on.
  const [prevTags, setPrevTags] = useState(tags);
  const [noNameAtFirstSeen, setNoNameAtFirstSeen] = useState<Map<string, boolean>>(
    () => new Map(tags.map((t) => [t.id, !t.name.trim()])),
  );
  if (tags !== prevTags) {
    setPrevTags(tags);
    const missing = tags.filter((t) => !noNameAtFirstSeen.has(t.id));
    if (missing.length > 0) {
      const next = new Map(noNameAtFirstSeen);
      for (const t of missing) next.set(t.id, !t.name.trim());
      setNoNameAtFirstSeen(next);
    }
  }

  const problems = useMemo(() => validateTags(tags), [tags]);
  const duplicateGroups = problems.filter((p) => p.type === "DUPLICATE_CODE");
  const unmatchedIds = new Set(problems.filter((p) => p.type === "UNMATCHED_CODE").map((p) => p.tagId));
  const unmatchedTags = tags.filter((t) => unmatchedIds.has(t.id));
  // Split the unmatched-code bucket by whether it's actually actionable: a tag with no name yet
  // is still unidentified and needs someone to look at it, while one an admin already typed a
  // name into (just not found in the registration/reference data) is effectively resolved —
  // mixing the two made the "needs attention" list look far bigger than it really was.
  const unmatchedNoName = unmatchedTags.filter((t) => noNameAtFirstSeen.get(t.id) ?? !t.name.trim());
  const unmatchedWithName = unmatchedTags.filter((t) => !(noNameAtFirstSeen.get(t.id) ?? !t.name.trim()));
  const tagsById = new Map(tags.map((t) => [t.id, t]));
  const problemTagIdSet = problemTagIds(problems);

  const tagsByRow = useMemo(() => {
    const byRow = new Map<number, T[]>();
    for (const t of tags) {
      const arr = byRow.get(t.row) ?? [];
      arr.push(t);
      byRow.set(t.row, arr);
    }
    for (const arr of byRow.values()) arr.sort((a, b) => a.order - b.order);
    return [...byRow.entries()].sort((a, b) => a[0] - b[0]);
  }, [tags]);

  return (
    <>
      {open && (
        <div className="max-h-[45vh] w-full shrink-0 overflow-y-auto border-b border-gray-200 bg-white max-md:landscape:h-auto max-md:landscape:max-h-none max-md:landscape:w-56 max-md:landscape:border-b-0 max-md:landscape:border-r md:h-auto md:max-h-none md:w-96 md:border-b-0 md:border-r">
          {/* Sticky so the problems/all toggle stays reachable while scrolling a long list — its
              own bg-white + border keeps scrolling rows from showing through underneath. */}
          <div className="sticky top-0 z-10 border-b border-gray-100 bg-white p-4 pb-3 max-md:landscape:p-2 max-md:landscape:pb-2">
            <div className="flex items-center gap-1 rounded-md border border-gray-300 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => switchListMode("problems")}
                className={`flex-1 rounded px-2 py-1 font-medium max-md:landscape:px-1 max-md:landscape:py-0.5 ${listMode === "problems" ? "bg-indigo-600 text-white" : "text-gray-600 hover:bg-gray-50"}`}
              >
                เฉพาะที่มีปัญหา ({problems.length})
              </button>
              <button
                type="button"
                onClick={() => switchListMode("all")}
                className={`flex-1 rounded px-2 py-1 font-medium max-md:landscape:px-1 max-md:landscape:py-0.5 ${listMode === "all" ? "bg-indigo-600 text-white" : "text-gray-600 hover:bg-gray-50"}`}
              >
                ทั้งหมด ({tags.length})
              </button>
            </div>
          </div>

          <div className="p-4 pt-3 max-md:landscape:p-2 max-md:landscape:pt-2">

          {listMode === "problems" ? (
            <>
              {problems.length === 0 && (
                <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{emptyMessage}</p>
              )}

              {duplicateGroups.length > 0 && (
                <div className="mb-4">
                  <CollapsibleGroup title="เลขซ้ำในรูปเดียวกัน" count={duplicateGroups.length}>
                    <div className="space-y-3">
                      {duplicateGroups.map((g) =>
                        g.type === "DUPLICATE_CODE" ? (
                          <div key={g.normalizedCode}>
                            <p className="mb-1 px-0.5 text-xs font-semibold text-red-600">รหัสซ้ำ: {g.normalizedCode}</p>
                            <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
                              {g.tagIds
                                .map((id) => tagsById.get(id))
                                .filter((t): t is T => !!t)
                                .map((t) => (
                                  <TagRow
                                    key={t.id}
                                    tag={t}
                                    isSelected={t.id === selectedTagId}
                                    isProblem
                                    onSelect={() => onSelectTag(t)}
                                    onDoubleClick={() => onEditTag(t)}
                                    displayFields={displayFields}
                                    extraBadges={renderBadges?.(t)}
                                    inlineEdit={editingTagId === t.id ? renderInlineEdit?.(t) : undefined}
                                  />
                                ))}
                            </ul>
                          </div>
                        ) : null,
                      )}
                    </div>
                  </CollapsibleGroup>
                </div>
              )}

              {unmatchedNoName.length > 0 && (
                <div className="mb-6">
                  <CollapsibleGroup title="ไม่ทราบชื่อ" count={unmatchedNoName.length}>
                    <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
                      {unmatchedNoName.map((t) => (
                        <TagRow
                          key={t.id}
                          tag={t}
                          isSelected={t.id === selectedTagId}
                          isProblem
                          onSelect={() => onSelectTag(t)}
                          onDoubleClick={() => onEditTag(t)}
                          displayFields={displayFields}
                          extraBadges={renderBadges?.(t)}
                          inlineEdit={editingTagId === t.id ? renderInlineEdit?.(t) : undefined}
                        />
                      ))}
                    </ul>
                  </CollapsibleGroup>
                </div>
              )}

              {unmatchedWithName.length > 0 && (
                <div className="mb-6">
                  <CollapsibleGroup title="รอการยืนยันชื่อ" count={unmatchedWithName.length}>
                    <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
                      {unmatchedWithName.map((t) => (
                        <TagRow
                          key={t.id}
                          tag={t}
                          isSelected={t.id === selectedTagId}
                          isProblem
                          onSelect={() => onSelectTag(t)}
                          onDoubleClick={() => onEditTag(t)}
                          displayFields={displayFields}
                          extraBadges={renderBadges?.(t)}
                          inlineEdit={editingTagId === t.id ? renderInlineEdit?.(t) : undefined}
                        />
                      ))}
                    </ul>
                  </CollapsibleGroup>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              {tagsByRow.map(([row, rowTags]) => {
                const rowColor = colorForRow(row);
                return (
                  <div key={row}>
                    <CollapsibleGroup title={`แถว ${row}`} count={rowTags.length} colorDot={rowColor}>
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
                            onSelect={() => onSelectTag(t)}
                            onDoubleClick={() => onEditTag(t)}
                            displayFields={displayFields}
                            groupedByRow
                            extraBadges={renderBadges?.(t)}
                            inlineEdit={editingTagId === t.id ? renderInlineEdit?.(t) : undefined}
                          />
                        ))}
                      </ul>
                    </CollapsibleGroup>
                  </div>
                );
              })}
            </div>
          )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={onToggleOpen}
        title={open ? "ซ่อนรายชื่อ" : "แสดงรายชื่อ"}
        className="hidden shrink-0 flex-col items-center justify-center gap-2 border-r border-gray-200 bg-gray-50 px-1.5 py-3 text-gray-500 hover:bg-gray-100 hover:text-gray-700 max-md:landscape:flex md:flex"
      >
        <span aria-hidden className="text-base leading-none">
          {open ? "‹" : "›"}
        </span>
        <span className="text-[11px] font-medium tracking-wide [writing-mode:vertical-rl]">
          {open ? "ซ่อนรายชื่อ" : "แสดงรายชื่อ"}
        </span>
      </button>
      <button
        type="button"
        onClick={onToggleOpen}
        className="flex shrink-0 items-center justify-center gap-1 border-b border-gray-200 bg-gray-50 py-2 text-xs font-medium text-gray-600 active:bg-gray-100 max-md:landscape:hidden md:hidden"
      >
        {open ? "ซ่อนรายชื่อ ▲" : "แสดงรายชื่อ ▼"}
      </button>
    </>
  );
}
