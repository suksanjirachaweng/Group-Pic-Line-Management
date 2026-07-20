"use client";

import { useActionState, useRef, useState } from "react";
import { sendBulkMessage, type BulkSendState } from "@/lib/actions/messages";
import { MessageTemplatePicker } from "./MessageTemplatePicker";

export function BulkSendButton({ universityId, selectFormId }: { universityId: string; selectFormId: string }) {
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [hasImage, setHasImage] = useState(false);
  const [hasText, setHasText] = useState(false);
  const [imageName, setImageName] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [templateImageUrl, setTemplateImageUrl] = useState<string | null>(null);
  const [linkValue, setLinkValue] = useState("");
  const imageInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const [, formAction, isPending] = useActionState<BulkSendState, FormData>(async (prevState, formData) => {
    const result = await sendBulkMessage(universityId, prevState, formData);
    if (result?.success) {
      window.alert(`ส่งข้อความเข้าคิวให้ ${result.count} คนแล้ว (จะทยอยส่งจริงภายในไม่กี่นาที)`);
      setOpen(false);
    } else if (result) {
      window.alert(`ไม่สำเร็จ: ${result.error}`);
    }
    return result;
  }, null);

  function resetComposer() {
    setHasImage(false);
    setHasText(false);
    setImageName(null);
    if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setTemplateImageUrl(null);
    setLinkValue("");
  }

  function handleOpen() {
    const form = document.getElementById(selectFormId) as HTMLFormElement | null;
    if (!form) return;
    const checked = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="registrantIds"]:checked'));
    if (checked.length === 0) {
      window.alert("ยังไม่ได้เลือกผู้รับ — ติ๊กเลือกรายชื่อในตารางก่อนครับ");
      return;
    }
    setSelectedIds(checked.map((c) => c.value));
    resetComposer();
    setOpen(true);
  }

  function handleImageChange(file: File | undefined) {
    setHasImage(!!file);
    setImageName(file?.name ?? null);
    setTemplateImageUrl(null);
    if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(file ? URL.createObjectURL(file) : null);
  }

  function handleRemoveImage() {
    if (imageInputRef.current) imageInputRef.current.value = "";
    if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setImageName(null);
    setTemplateImageUrl(null);
    setHasImage(false);
  }

  const quotaCost = selectedIds.length * ((hasImage ? 1 : 0) + (hasText ? 1 : 0) || 1);

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
      >
        ส่งข้อความให้ที่เลือก
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <form
            action={formAction}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl"
          >
            {selectedIds.map((id) => (
              <input key={id} type="hidden" name="registrantIds" value={id} />
            ))}
            <input type="hidden" name="imageUrl" value={templateImageUrl ?? ""} />
            <h3 className="mb-3 text-sm font-semibold text-gray-900">ส่งข้อความให้ {selectedIds.length} คนที่เลือก</h3>

            <label className="block text-xs font-medium text-gray-700">
              ข้อความ (ใช้ {"{{full_name}}"} หรือ {"{{key}}"} ของ field อื่นแทนค่าได้ — เว้นว่างได้ถ้าจะส่งแต่รูป)
            </label>

            {previewUrl && (
              <div className="mt-1 flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl} alt="" className="h-20 w-20 rounded-md border border-gray-200 object-cover" />
                <button type="button" onClick={handleRemoveImage} className="text-xs text-gray-400 hover:text-red-600">
                  เอารูปออก
                </button>
              </div>
            )}

            <div className="mt-1 flex gap-2">
              <textarea
                ref={bodyRef}
                name="body"
                rows={4}
                placeholder="สวัสดีคุณ {{full_name}} ..."
                onChange={(e) => setHasText(!!e.target.value.trim())}
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <div className="flex w-24 shrink-0 flex-col items-start gap-1">
                <input
                  ref={imageInputRef}
                  type="file"
                  name="image"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(e) => handleImageChange(e.target.files?.[0])}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  className="w-full rounded-md border border-gray-300 bg-gray-50 px-2 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
                >
                  แนบรูป
                </button>
                {imageName && <span className="w-full truncate text-xs text-gray-500">{imageName}</span>}
              </div>
            </div>

            {hasImage && (
              <>
                <label className="mt-3 block text-xs font-medium text-gray-700">
                  ลิงก์ (ไม่บังคับ — ใส่แล้วกดที่รูปจะเปิดลิงก์นี้ เหมือนแบนเนอร์โฆษณา)
                </label>
                <input
                  type="url"
                  name="link"
                  value={linkValue}
                  onChange={(e) => setLinkValue(e.target.value)}
                  placeholder="https://..."
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </>
            )}

            <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              จะส่งไปหา {selectedIds.length} คน — ใช้โควต้าประมาณ {quotaCost} ข้อความ
              {hasImage && hasText && " (รูป + ข้อความ นับ 2 ต่อคน)"}
            </p>

            <div className="mt-4 flex items-center justify-between gap-2">
              <MessageTemplatePicker
                bodyRef={bodyRef}
                imageInputRef={imageInputRef}
                templateImageUrl={templateImageUrl}
                linkValue={linkValue}
                onLoad={(t) => {
                  if (bodyRef.current) bodyRef.current.value = t.body;
                  setHasText(!!t.body.trim());
                  if (imageInputRef.current) imageInputRef.current.value = "";
                  setImageName(t.imageUrl ? "รูปจาก template" : null);
                  if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
                  setPreviewUrl(t.imageUrl);
                  setTemplateImageUrl(t.imageUrl);
                  setHasImage(!!t.imageUrl);
                  setLinkValue(t.linkUrl ?? "");
                }}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {isPending ? "กำลังส่ง..." : "ยืนยันส่ง"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
