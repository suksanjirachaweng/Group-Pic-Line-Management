"use client";

import { useEffect, useState, useTransition } from "react";
import {
  updateGroupPhotoTitle,
  getGroupPhotoTitleHistory,
  type TitleHistoryEntry,
} from "@/lib/actions/groupPhotos";

const TITLE_HISTORY_SOURCE_LABEL: Record<TitleHistoryEntry["source"], string> = {
  ADMIN: "แก้ไขโดยแอดมิน",
  AUTO_SYNC: "อัปเดตอัตโนมัติ",
  PUBLIC_LINK: "แก้ไขผ่านลิงก์แชร์",
};

export function PhotoTitleEditor({
  universityId,
  groupPhotoId,
  name,
  title,
}: {
  universityId: string;
  groupPhotoId: string;
  name: string;
  title: string | null;
}) {
  const [currentTitle, setCurrentTitle] = useState(title);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title ?? "");
  const [isPending, startTransition] = useTransition();
  const [history, setHistory] = useState<TitleHistoryEntry[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Fetch fresh every time the edit box opens — matches TagEditDialog's history-fetch convention
  // (state reset happens in the "แก้ไข" button's onClick, not here, since resetting
  // synchronously inside an effect body trips react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    getGroupPhotoTitleHistory(universityId, groupPhotoId).then((rows) => {
      if (!cancelled) setHistory(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [editing, universityId, groupPhotoId]);

  const displayTitle = currentTitle?.trim() || name;

  function save() {
    const next = value.trim() || null;
    startTransition(async () => {
      await updateGroupPhotoTitle(universityId, groupPhotoId, next);
      setCurrentTitle(next);
      setEditing(false);
    });
  }

  if (!editing) {
    return (
      <div className="flex min-w-0 flex-col items-center gap-0.5 text-center">
        <div className="flex items-center gap-1.5">
          <h1 className="whitespace-pre-wrap text-sm font-semibold leading-snug text-gray-900">{displayTitle}</h1>
          <button
            type="button"
            onClick={() => {
              setValue(currentTitle ?? "");
              setEditing(true);
              setHistory(null);
              setHistoryOpen(false);
            }}
            title="แก้ไขหัวข้อรูป"
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-600"
          >
            <span aria-hidden>✎</span> แก้ไข
          </button>
        </div>
        {currentTitle?.trim() && currentTitle.trim() !== name && (
          <span className="text-xs text-gray-400">(คณะ: {name})</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-2xl flex-col items-center gap-1.5">
      <textarea
        autoFocus
        rows={3}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={name}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            setEditing(false);
          }
        }}
        className="w-full resize-none rounded-md border border-gray-300 px-2.5 py-1.5 text-center text-sm leading-snug"
      />
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={isPending}
          onClick={save}
          className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {isPending ? "..." : "บันทึก"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
        >
          ยกเลิก
        </button>
        <span className="text-xs text-gray-400">Ctrl/Cmd+Enter = บันทึก</span>
      </div>

      <div className="w-full max-w-xs">
        <button
          type="button"
          onClick={() => setHistoryOpen((v) => !v)}
          className="flex w-full items-center justify-between text-xs font-medium text-gray-500 hover:text-gray-700"
        >
          <span>ประวัติการแก้ไข{history ? ` (${history.length})` : ""}</span>
          <span>{historyOpen ? "▲" : "▼"}</span>
        </button>
        {historyOpen && (
          <div className="mt-1 max-h-32 space-y-1 overflow-y-auto">
            {history === null && <p className="text-xs text-gray-400">กำลังโหลด...</p>}
            {history?.length === 0 && <p className="text-xs text-gray-400">ยังไม่มีประวัติ</p>}
            {history?.map((h) => (
              <div key={h.id} className="rounded-md bg-gray-50 px-2 py-1 text-xs">
                <div className="flex items-center justify-between gap-2 text-gray-400">
                  <span>
                    {new Date(h.createdAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                  <span>{TITLE_HISTORY_SOURCE_LABEL[h.source]}</span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-gray-700">{h.title?.trim() || `(ไม่ระบุ — แสดง "${name}")`}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
