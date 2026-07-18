"use client";

import { useState, useEffect } from "react";
import { TagMatchSource, LegacyReferenceSource } from "@/generated/prisma/enums";
import { getGroupPhotoTagHistory, type TagHistoryEntry } from "@/lib/actions/groupPhotos";
import { searchFacultyByFace, type FaceSearchResult } from "@/lib/actions/facultyFaceSearch";

export type RegistrantLookup = { id: string; name: string; normalizedCode: string; hasLine: boolean };
export type ReferenceLookup = { name: string; normalizedCode: string; source: LegacyReferenceSource };

export type DialogInitial = {
  id?: string;
  code: string;
  name: string;
  row: number;
  order: number;
  x: number;
  y: number;
  registrantId: string | null;
  matchSource: TagMatchSource;
  problemAcknowledged: boolean;
};

export type SavePayload = {
  code: string;
  name: string;
  row: number;
  order: number;
  registrantId: string | null;
  matchSource: TagMatchSource;
  problemAcknowledged: boolean;
};

const HISTORY_SOURCE_LABEL: Record<TagHistoryEntry["source"], string> = {
  ADMIN: "แก้ไขโดยแอดมิน",
  AUTO_SYNC: "อัปเดตอัตโนมัติ",
  PUBLIC_LINK: "แก้ไขผ่านลิงก์แชร์",
};

export function TagEditDialog({
  open,
  initial,
  ocrLoading,
  universityId,
  groupPhotoId,
  registrantByCode,
  referenceByCode,
  onSave,
  onDelete,
  onClose,
}: {
  open: boolean;
  initial: DialogInitial | null;
  ocrLoading: boolean;
  universityId: string;
  groupPhotoId: string;
  registrantByCode: Map<string, RegistrantLookup>;
  referenceByCode: Map<string, ReferenceLookup>;
  onSave: (input: SavePayload) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [row, setRow] = useState(0);
  const [order, setOrder] = useState(0);
  const [registrantId, setRegistrantId] = useState<string | null>(null);
  const [matchSource, setMatchSource] = useState<TagMatchSource>(TagMatchSource.MANUAL);
  const [referenceSource, setReferenceSource] = useState<LegacyReferenceSource | null>(null);
  const [problemAcknowledged, setProblemAcknowledged] = useState(false);
  const [history, setHistory] = useState<TagHistoryEntry[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [faceSearch, setFaceSearch] = useState<{ loading: boolean; result: FaceSearchResult | null }>({
    loading: false,
    result: null,
  });

  // Reset form fields whenever a different `initial` object is passed in (a new tag opened, a
  // different tag selected, or OCR filling in the code on the currently-open dialog) — derived
  // during render rather than in an effect, per React's "you might not need an effect" guidance.
  // Also re-checks the code against the current registrant/reference lookups on open: a tag's
  // code can outlive the moment it was tagged (e.g. someone fixes their group_photo_index in
  // LINE afterward), so opening it re-syncs the name/match instead of only doing that on the
  // next keystroke in the code field. A code that still matches nothing keeps whatever was
  // already saved, rather than blanking out a manually-entered name.
  const [syncedInitial, setSyncedInitial] = useState(initial);
  if (initial !== syncedInitial) {
    setSyncedInitial(initial);
    setHistory(null);
    setHistoryOpen(false);
    setFaceSearch({ loading: false, result: null });
    if (initial) {
      setCode(initial.code);
      setRow(initial.row);
      setOrder(initial.order);
      setProblemAcknowledged(initial.problemAcknowledged);
      const normalized = initial.code.replace(/\D+/g, "");
      const reg = normalized ? registrantByCode.get(normalized) : undefined;
      const ref = !reg && normalized ? referenceByCode.get(normalized) : undefined;
      if (reg) {
        setName(reg.name);
        setRegistrantId(reg.id);
        setMatchSource(TagMatchSource.REGISTRANT);
        setReferenceSource(null);
      } else if (ref) {
        setName(ref.name);
        setRegistrantId(null);
        setMatchSource(TagMatchSource.LEGACY_REFERENCE);
        setReferenceSource(ref.source);
      } else {
        setName(initial.name);
        setRegistrantId(initial.registrantId);
        setMatchSource(initial.matchSource);
        setReferenceSource(null);
      }
    }
  }

  // Fetch this tag's revision history fresh every time a different (existing) tag is opened —
  // not preloaded with the rest of the canvas's data since most edit sessions never open it.
  // The reset-to-null on tag switch happens above (render-time, alongside the other form-field
  // resets), so this effect only ever needs to kick off the async fetch itself.
  useEffect(() => {
    if (!initial?.id) return;
    let cancelled = false;
    getGroupPhotoTagHistory(universityId, initial.id).then((rows) => {
      if (!cancelled) setHistory(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [initial?.id, universityId]);

  function handleCodeChange(value: string) {
    setCode(value);
    const normalized = value.replace(/\D+/g, "");
    if (!normalized) {
      setRegistrantId(null);
      setMatchSource(TagMatchSource.MANUAL);
      setReferenceSource(null);
      return;
    }
    const reg = registrantByCode.get(normalized);
    if (reg) {
      setName(reg.name);
      setRegistrantId(reg.id);
      setMatchSource(TagMatchSource.REGISTRANT);
      setReferenceSource(null);
      return;
    }
    const ref = referenceByCode.get(normalized);
    if (ref) {
      setName(ref.name);
      setRegistrantId(null);
      setMatchSource(TagMatchSource.LEGACY_REFERENCE);
      setReferenceSource(ref.source);
      return;
    }
    setRegistrantId(null);
    setMatchSource(TagMatchSource.MANUAL);
    setReferenceSource(null);
  }

  async function handleFaceSearch() {
    if (!initial) return;
    setFaceSearch({ loading: true, result: null });
    const result = await searchFacultyByFace(universityId, groupPhotoId, initial.x, initial.y);
    setFaceSearch({ loading: false, result });
  }

  function handlePickFaceCandidate(candidateName: string) {
    setName(candidateName);
    // A face-search suggestion is never as authoritative as a code match — the admin picked it
    // by eye, so it's recorded the same way any other manual entry is.
    setRegistrantId(null);
    setMatchSource(TagMatchSource.MANUAL);
    setReferenceSource(null);
  }

  if (!open || !initial) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-semibold text-gray-900">{initial.id ? "แก้ไขข้อมูล" : "เพิ่มคนใหม่"}</h3>

        <label className="block text-xs font-medium text-gray-700">CODE (หมายเลขถ่ายภาพหมู่)</label>
        <input
          value={code}
          onChange={(e) => handleCodeChange(e.target.value)}
          placeholder={ocrLoading ? "กำลังอ่านตัวเลข..." : "เช่น 0140"}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          autoFocus
        />
        {ocrLoading && <p className="mt-1 text-xs text-gray-400">กำลังอ่านตัวเลขจากป้าย...</p>}

        <label className="mt-3 block text-xs font-medium text-gray-700">
          ชื่อ-นามสกุล
          {matchSource === TagMatchSource.REGISTRANT && (
            <span className="ml-1.5 rounded bg-green-100 px-1.5 py-0.5 text-xs font-semibold text-green-700">LINE</span>
          )}
          {matchSource === TagMatchSource.LEGACY_REFERENCE && referenceSource === LegacyReferenceSource.GOOGLE_SHEET && (
            <span className="ml-1.5 rounded bg-orange-100 px-1.5 py-0.5 text-xs font-semibold text-orange-700">
              Google Sheet
            </span>
          )}
          {matchSource === TagMatchSource.LEGACY_REFERENCE && referenceSource !== LegacyReferenceSource.GOOGLE_SHEET && (
            <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-700">Excel</span>
          )}
          {matchSource === TagMatchSource.MANUAL && code && (
            <span className="ml-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-semibold text-gray-500">
              Manual — ไม่พบข้อมูล
            </span>
          )}
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="เว้นว่างไว้ก่อนได้ — ค่อยกลับมาใส่ทีหลัง"
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />

        {row === 0 && (
          <div className="mt-2">
            <button
              type="button"
              onClick={handleFaceSearch}
              disabled={faceSearch.loading}
              className="text-xs font-medium text-indigo-600 hover:underline disabled:opacity-50"
            >
              {faceSearch.loading ? "กำลังค้นหา..." : "🔍 ค้นหาจากใบหน้า"}
            </button>

            {faceSearch.result?.status === "not_configured" && (
              <p className="mt-1 text-xs text-gray-400">ยังไม่ได้ตั้งค่าระบบจดจำใบหน้า (PC server)</p>
            )}
            {faceSearch.result?.status === "no_face_detected" && (
              <p className="mt-1 text-xs text-gray-400">ไม่พบใบหน้าที่ชัดเจนบริเวณนี้</p>
            )}
            {faceSearch.result?.status === "ok" && faceSearch.result.candidates.length === 0 && (
              <p className="mt-1 text-xs text-gray-400">ยังไม่มีข้อมูลใบหน้าในระบบให้เทียบ</p>
            )}
            {faceSearch.result?.status === "ok" && faceSearch.result.candidates.length > 0 && (
              <div className="mt-2 space-y-1.5 rounded-md border border-gray-200 bg-gray-50 p-2">
                <p className="text-xs text-gray-500">เลือกคนที่ตรงจากรายการ (แอดมินยืนยันเอง ระบบไม่เติมให้อัตโนมัติ):</p>
                {faceSearch.result.candidates.map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => handlePickFaceCandidate(c.name)}
                    className="flex w-full items-center gap-2 rounded-md bg-white p-1.5 text-left hover:bg-indigo-50"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- external, self-hosted-or-Blob crop URL, not a local asset */}
                    <img src={c.sourceCropUrl} alt={c.name} className="h-10 w-10 rounded object-cover" />
                    <span className="min-w-0 flex-1 truncate text-xs text-gray-800">{c.name}</span>
                    <span className="flex-none text-xs text-gray-400">{(c.score * 100).toFixed(0)}%</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-gray-700">แถว (0 = นั่งหน้า)</label>
            <input
              type="number"
              value={row}
              onChange={(e) => setRow(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700">ลำดับ</label>
            <input
              type="number"
              value={order}
              onChange={(e) => setOrder(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <p className="mt-1.5 text-xs text-gray-400">ถ้าลำดับซ้ำกับคนอื่นในแถวเดียวกัน คนที่เหลือจะขยับ +1 ให้อัตโนมัติ</p>

        {initial.id && (
          <div className="mt-3 border-t border-gray-100 pt-2">
            <button
              type="button"
              onClick={() => setHistoryOpen((v) => !v)}
              className="flex w-full items-center justify-between text-xs font-medium text-gray-500 hover:text-gray-700"
            >
              <span>ประวัติการแก้ไข{history ? ` (${history.length})` : ""}</span>
              <span>{historyOpen ? "▲" : "▼"}</span>
            </button>
            {historyOpen && (
              <div className="mt-2 max-h-32 space-y-1.5 overflow-y-auto">
                {history === null && <p className="text-xs text-gray-400">กำลังโหลด...</p>}
                {history?.length === 0 && <p className="text-xs text-gray-400">ยังไม่มีประวัติ</p>}
                {history?.map((h) => (
                  <div key={h.id} className="rounded-md bg-gray-50 px-2 py-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2 text-gray-400">
                      <span>{new Date(h.createdAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}</span>
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
        )}

        <div className="mt-4 flex items-center justify-between gap-2">
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
            >
              ลบ
            </button>
          ) : (
            <span />
          )}
          {initial.id && (
            <button
              type="button"
              onClick={() => setProblemAcknowledged((v) => !v)}
              className={
                problemAcknowledged
                  ? "rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  : "rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
              }
            >
              {problemAcknowledged ? "แสดงปัญหาอีกครั้ง" : "ไม่แสดงปัญหา"}
            </button>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={() => onSave({ code, name, row, order, registrantId, matchSource, problemAcknowledged })}
              disabled={!code.trim()}
              className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              บันทึก
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
