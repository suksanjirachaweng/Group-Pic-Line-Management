"use client";

import { useState, useTransition } from "react";
import { sendProblemTagMessages, createGroupPhotoShareLink } from "@/lib/actions/groupPhotos";

type ProblemTag = { id: string; name: string; code: string; canDirectMessage: boolean };

export function ProblemActionsPanel({
  universityId,
  groupPhotoId,
  problemTags,
}: {
  universityId: string;
  groupPhotoId: string;
  problemTags: ProblemTag[];
}) {
  const directMessageable = problemTags.filter((t) => t.canDirectMessage);
  const [selectedIds, setSelectedIds] = useState<string[]>(directMessageable.map((t) => t.id));
  const [body, setBody] = useState("");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function handleSend() {
    if (selectedIds.length === 0) {
      window.alert("ยังไม่ได้เลือกคนที่จะส่ง");
      return;
    }
    if (!body.trim()) {
      window.alert("พิมพ์ข้อความก่อนส่ง");
      return;
    }
    startTransition(async () => {
      const result = await sendProblemTagMessages(universityId, groupPhotoId, selectedIds, body);
      window.alert(`ส่งข้อความเข้าคิวให้ ${result.count} คนแล้ว (จะทยอยส่งจริงภายในไม่กี่นาที)`);
    });
  }

  function handleCreateShareLink() {
    startTransition(async () => {
      const result = await createGroupPhotoShareLink(universityId, groupPhotoId);
      setShareUrl(result.url);
    });
  }

  function handleCopyLink() {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    window.alert("คัดลอกลิงก์แล้ว");
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">แก้ไขปัญหา ({problemTags.length} คน)</h2>

      <div className="mb-4">
        <h3 className="mb-2 text-xs font-medium text-gray-700">
          ส่ง LINE ตรง (เลือกได้เฉพาะคนที่ระบบมีข้อมูล LINE)
        </h3>
        <ul className="mb-2 max-h-48 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200">
          {problemTags.map((t) => (
            <li key={t.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
              <input
                type="checkbox"
                disabled={!t.canDirectMessage}
                checked={selectedIds.includes(t.id)}
                onChange={() => toggle(t.id)}
                className="h-4 w-4"
              />
              <span className={t.canDirectMessage ? "text-gray-900" : "text-gray-400"}>
                <span className="font-mono">{t.code}</span> — {t.name}
              </span>
              {!t.canDirectMessage && <span className="ml-auto text-xs text-gray-400">ไม่มีข้อมูล LINE</span>}
            </li>
          ))}
        </ul>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="สวัสดีครับ ขอรบกวนช่วยยืนยันหมายเลขในรูปถ่ายหมู่อีกครั้ง..."
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={isPending || directMessageable.length === 0}
          className="mt-2 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          ส่ง LINE ให้ {selectedIds.length} คนที่เลือก
        </button>
        {directMessageable.length === 0 && (
          <p className="mt-1 text-xs text-gray-400">ไม่มีใครในรายการนี้ที่ผูก LINE ไว้ — ใช้ลิงก์แชร์แทน</p>
        )}
      </div>

      <div className="border-t border-gray-100 pt-3">
        <h3 className="mb-2 text-xs font-medium text-gray-700">
          หรือส่งลิงก์ให้คนอื่นแก้ไขเองแทน (เช่น ฝ่ายคณะ) — ไม่ต้องล็อกอิน
        </h3>
        {shareUrl ? (
          <div className="flex items-center gap-2">
            <input readOnly value={shareUrl} className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700" />
            <button
              type="button"
              onClick={handleCopyLink}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              คัดลอก
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleCreateShareLink}
            disabled={isPending}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            สร้างลิงก์แชร์
          </button>
        )}
      </div>
    </div>
  );
}
