"use client";

import { useEffect, useState } from "react";
import { createShareLink, deactivateShareLink, listShareLinks } from "@/lib/actions/fileManager";
import type { ShareLinkInfo } from "@/lib/actions/fileManager";

export function ShareDialog({
  path,
  entryName,
  isFolder,
  onClose,
}: {
  path: string;
  entryName: string;
  isFolder: boolean;
  onClose: () => void;
}) {
  const [links, setLinks] = useState<ShareLinkInfo[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    listShareLinks(path)
      .then(setLinks)
      .catch((err) => setError(err instanceof Error ? err.message : "โหลดลิงก์แชร์ไม่สำเร็จ"));
  }

  useEffect(refresh, [path]);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      await createShareLink(path, isFolder);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "สร้างลิงก์แชร์ไม่สำเร็จ");
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy(link: ShareLinkInfo) {
    await navigator.clipboard.writeText(link.url);
    setCopiedId(link.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  async function handleRevoke(id: string) {
    if (!window.confirm("ยกเลิกลิงก์แชร์นี้? ใครก็ตามที่มีลิงก์นี้อยู่จะเปิดดูไม่ได้อีก")) return;
    await deactivateShareLink(id);
    refresh();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
        <h3 className="mb-1 text-sm font-semibold text-gray-900">แชร์ &quot;{entryName}&quot;</h3>
        <p className="mb-3 text-xs text-gray-500">
          {isFolder
            ? "ลิงก์นี้ให้บุคคลภายนอกดู/โหลดไฟล์ในโฟลเดอร์นี้ได้ และอัปโหลดไฟล์ใหม่เพิ่มเข้ามาได้ (แต่แก้ไข/ลบ/เปลี่ยนชื่อไฟล์ที่มีอยู่แล้วไม่ได้)"
            : "ลิงก์นี้ให้บุคคลภายนอกดู/โหลดไฟล์นี้ได้อย่างเดียว"}
        </p>

        {links === null ? (
          <p className="text-xs text-gray-400">กำลังโหลด...</p>
        ) : links.length === 0 ? (
          <p className="mb-3 text-xs text-gray-400">ยังไม่มีลิงก์แชร์สำหรับรายการนี้</p>
        ) : (
          <ul className="mb-3 space-y-2">
            {links.map((link) => (
              <li key={link.id} className="flex items-center gap-2 rounded-md border border-gray-200 p-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-mono text-gray-700">{link.url}</span>
                <button
                  type="button"
                  onClick={() => void handleCopy(link)}
                  className="shrink-0 rounded border border-gray-300 px-2 py-1 hover:bg-gray-50"
                >
                  {copiedId === link.id ? "คัดลอกแล้ว" : "คัดลอก"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleRevoke(link.id)}
                  className="shrink-0 rounded border border-red-300 px-2 py-1 text-red-600 hover:bg-red-50"
                >
                  ยกเลิก
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
            ปิด
          </button>
          <button
            type="button"
            disabled={creating}
            onClick={() => void handleCreate()}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {creating ? "กำลังสร้าง..." : "สร้างลิงก์แชร์ใหม่"}
          </button>
        </div>
      </div>
    </div>
  );
}
