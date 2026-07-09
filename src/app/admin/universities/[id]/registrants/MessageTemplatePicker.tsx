"use client";

import { useState, useTransition, type RefObject } from "react";
import {
  listMessageTemplates,
  saveMessageTemplate,
  deleteMessageTemplate,
  type MessageTemplateSummary,
} from "@/lib/actions/messageTemplates";

export function MessageTemplatePicker({
  bodyRef,
  imageInputRef,
  templateImageUrl,
  linkValue,
  onLoad,
}: {
  bodyRef: RefObject<HTMLTextAreaElement | null>;
  imageInputRef: RefObject<HTMLInputElement | null>;
  templateImageUrl: string | null;
  linkValue: string;
  onLoad: (template: MessageTemplateSummary) => void;
}) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<MessageTemplateSummary[] | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleOpen() {
    setOpen(true);
    if (templates === null) {
      startTransition(async () => {
        setTemplates(await listMessageTemplates());
      });
    }
  }

  function handleSave() {
    const body = bodyRef.current?.value ?? "";
    const file = imageInputRef.current?.files?.[0];
    if (!body.trim() && !file && !templateImageUrl) {
      window.alert("พิมพ์ข้อความ หรือแนบรูปก่อนถึงจะบันทึกเป็น template ได้");
      return;
    }
    const name = window.prompt("ตั้งชื่อ template (ตั้งชื่อซ้ำของเดิมจะบันทึกทับ):");
    if (!name || !name.trim()) return;

    const fd = new FormData();
    fd.set("name", name);
    fd.set("body", body);
    fd.set("link", linkValue);
    if (file) {
      fd.set("image", file);
    } else if (templateImageUrl) {
      fd.set("imageUrl", templateImageUrl);
    }

    startTransition(async () => {
      const result = await saveMessageTemplate(fd);
      if (result && "error" in result) {
        window.alert(result.error);
        return;
      }
      setTemplates(null);
      window.alert(`บันทึก template "${name.trim()}" แล้ว`);
    });
  }

  function handleDelete(t: MessageTemplateSummary) {
    if (!window.confirm(`ลบ template "${t.name}"?`)) return;
    startTransition(async () => {
      await deleteMessageTemplate(t.id);
      setTemplates((prev) => prev?.filter((x) => x.id !== t.id) ?? null);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleOpen}
        title="โหลด template"
        aria-label="โหลด template"
        className="rounded-md border border-gray-300 p-1.5 text-gray-700 hover:bg-gray-50"
      >
        <LoadIcon />
      </button>
      <button
        type="button"
        onClick={handleSave}
        disabled={isPending}
        title="บันทึกเป็น template"
        aria-label="บันทึกเป็น template"
        className="rounded-md border border-gray-300 p-1.5 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        <SaveIcon />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[70vh] w-full max-w-sm overflow-y-auto rounded-lg bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-900">Template ที่บันทึกไว้</h4>
              <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
                ✕
              </button>
            </div>
            {templates === null ? (
              <p className="text-sm text-gray-400">กำลังโหลด...</p>
            ) : templates.length === 0 ? (
              <p className="text-sm text-gray-400">ยังไม่มี template ที่บันทึกไว้</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {templates.map((t) => (
                  <li key={t.id} className="flex items-start justify-between gap-2 py-2">
                    <button
                      type="button"
                      onClick={() => {
                        onLoad(t);
                        setOpen(false);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      {t.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={t.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
                      )}
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900">{t.name}</div>
                        <div className="truncate text-xs text-gray-500">{t.body || "(ไม่มีข้อความ — ส่งแต่รูป)"}</div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(t)}
                      className="shrink-0 text-xs text-gray-400 hover:text-red-600"
                    >
                      ลบ
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function LoadIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
      <path d="M2.5 6.5v9A1.5 1.5 0 0 0 4 17h12a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 16 7H9.5L8 5H4a1.5 1.5 0 0 0-1.5 1.5Z" strokeLinejoin="round" />
      <path d="M10 10v4M8 12h4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
      <path d="M4 3.5h9.5L16.5 6.5V16a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5Z" strokeLinejoin="round" />
      <path d="M6 3.5v4h6v-4" strokeLinejoin="round" />
      <path d="M6.5 12h5" strokeLinecap="round" />
    </svg>
  );
}
