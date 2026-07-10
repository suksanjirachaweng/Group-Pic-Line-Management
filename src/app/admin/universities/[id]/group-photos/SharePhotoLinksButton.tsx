"use client";

import { useState } from "react";

export function SharePhotoLinksButton({
  universityId,
  selectFormId,
  photos,
}: {
  universityId: string;
  selectFormId: string;
  photos: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);

  function handleOpen() {
    const form = document.getElementById(selectFormId) as HTMLFormElement | null;
    if (!form) return;
    const checked = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="photoIds"]:checked'));
    if (checked.length === 0) {
      window.alert("ยังไม่ได้เลือกรูป — ติ๊กเลือกรูปที่ต้องการส่งก่อน");
      return;
    }
    const selectedIds = new Set(checked.map((c) => c.value));
    const origin = window.location.origin;
    const lines = photos
      .filter((p) => selectedIds.has(p.id))
      .map((p) => `${p.name}\n${origin}/admin/universities/${universityId}/group-photos/${p.id}/validate`)
      .join("\n\n");
    setText(lines);
    setCopied(false);
    setOpen(true);
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        ส่ง Share Link ที่เลือก
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-sm font-semibold text-gray-900">ข้อความสำหรับส่งต่อ</h3>
            <p className="mb-3 text-xs text-gray-500">
              คัดลอกข้อความนี้ไปส่งให้ผู้อื่น (เช่น ทาง LINE) เพื่อให้เปิดลิงก์และดำเนินการแท็กรูปนี้ต่อได้
              (ผู้เปิดต้องมีบัญชีแอดมินที่เข้าถึงมหาวิทยาลัยนี้ได้)
            </p>
            <textarea
              readOnly
              value={text}
              rows={Math.min(10, text.split("\n").length + 1)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs"
            />
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                ปิด
              </button>
              <button
                type="button"
                onClick={handleCopy}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
              >
                {copied ? "คัดลอกแล้ว ✓" : "คัดลอก"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
