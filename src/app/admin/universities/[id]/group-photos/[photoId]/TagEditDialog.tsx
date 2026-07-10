"use client";

import { useState } from "react";
import { TagMatchSource, LegacyReferenceSource } from "@/generated/prisma/enums";

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
};

export type SavePayload = {
  code: string;
  name: string;
  row: number;
  order: number;
  registrantId: string | null;
  matchSource: TagMatchSource;
};

export function TagEditDialog({
  open,
  initial,
  ocrLoading,
  registrantByCode,
  referenceByCode,
  onSave,
  onDelete,
  onClose,
}: {
  open: boolean;
  initial: DialogInitial | null;
  ocrLoading: boolean;
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
    if (initial) {
      setCode(initial.code);
      setRow(initial.row);
      setOrder(initial.order);
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

        <div className="mt-4 flex justify-between gap-2">
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
              onClick={() => onSave({ code, name, row, order, registrantId, matchSource })}
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
