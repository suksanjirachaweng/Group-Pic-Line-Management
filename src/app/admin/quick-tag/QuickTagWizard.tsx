"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { uploadLargePhoto } from "@/lib/groupPhoto/uploadLargePhoto";
import { createGroupPhoto } from "@/lib/actions/groupPhotos";
import { startGroupPhotoAutoTag } from "@/lib/actions/groupPhotoAutoTag";
import { MobileCropTool } from "./MobileCropTool";

type University = { id: string; name: string };

type Step = "select-university" | "upload" | "crop" | "saving" | "done";

export function QuickTagWizard({ universities }: { universities: University[] }) {
  const [step, setStep] = useState<Step>(universities.length === 1 ? "upload" : "select-university");
  const [universityId, setUniversityId] = useState<string | null>(
    universities.length === 1 ? universities[0].id : null,
  );
  const [title, setTitle] = useState("");
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createdPhotoId, setCreatedPhotoId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const university = universities.find((u) => u.id === universityId);

  function resetForNextPhoto() {
    setTitle("");
    setBitmap(null);
    setError(null);
    setCreatedPhotoId(null);
    setStep("upload");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFilePicked(file: File) {
    setError(null);
    try {
      const decoded = await createImageBitmap(file);
      setBitmap(decoded);
      setStep("crop");
    } catch {
      setError("เปิดไฟล์รูปไม่สำเร็จ ลองเลือกไฟล์ใหม่");
    }
  }

  async function handleCropConfirm(blob: Blob, width: number, height: number) {
    if (!universityId) return;
    setStep("saving");
    setError(null);
    try {
      const file = new File([blob], "cropped.jpg", { type: "image/jpeg" });
      const { url } = await uploadLargePhoto(universityId, file);
      const { id: groupPhotoId } = await createGroupPhoto(universityId, {
        name: title.trim() || "ไม่ระบุชื่อ",
        imageUrl: url,
        imageWidth: width,
        imageHeight: height,
      });
      await startGroupPhotoAutoTag(universityId, groupPhotoId);
      setCreatedPhotoId(groupPhotoId);
      setStep("done");
    } catch (err) {
      setError(`บันทึกไม่สำเร็จ: ${err instanceof Error ? err.message : "unknown error"}`);
      setStep("crop");
    }
  }

  return (
    <div className="flex h-dvh flex-col bg-gray-50">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <Link href="/admin/universities" className="text-sm text-gray-500 hover:text-gray-700">
          ← กลับ
        </Link>
        <span className="text-sm font-semibold text-gray-900">อัปโหลดด่วน</span>
        <span className="w-10" aria-hidden />
      </header>

      <main className="flex-1 overflow-y-auto">
        {error && (
          <div className="m-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {step === "select-university" && (
          <div className="p-4">
            <h2 className="mb-3 text-base font-semibold text-gray-900">1. เลือกมหาวิทยาลัย</h2>
            <ul className="space-y-2">
              {universities.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setUniversityId(u.id);
                      setStep("upload");
                    }}
                    className="w-full rounded-lg border border-gray-300 bg-white px-4 py-4 text-left text-base font-medium text-gray-900 hover:bg-gray-50"
                  >
                    {u.name}
                  </button>
                </li>
              ))}
              {universities.length === 0 && (
                <li className="text-sm text-gray-400">ไม่พบมหาวิทยาลัยที่คุณมีสิทธิ์เข้าถึง</li>
              )}
            </ul>
          </div>
        )}

        {step === "upload" && (
          <div className="p-4">
            <h2 className="mb-3 text-base font-semibold text-gray-900">
              2. อัปโหลดรูป{university ? ` — ${university.name}` : ""}
            </h2>
            {universities.length > 1 && (
              <button
                type="button"
                onClick={() => setStep("select-university")}
                className="mb-4 text-sm text-indigo-600 hover:underline"
              >
                เปลี่ยนมหาวิทยาลัย
              </button>
            )}
            <label className="mb-4 block">
              <span className="mb-1 block text-sm font-medium text-gray-700">ชื่อรูป (เช่น ชื่อคณะ)</span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="เช่น คณะวิศวกรรมศาสตร์"
                className="w-full rounded-md border border-gray-300 px-3 py-2.5 text-base"
              />
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFilePicked(file);
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full rounded-lg bg-indigo-600 px-4 py-4 text-base font-medium text-white hover:bg-indigo-700"
            >
              ถ่ายรูป / เลือกรูป
            </button>
          </div>
        )}

        {step === "crop" && bitmap && (
          <MobileCropTool
            bitmap={bitmap}
            onCancel={() => setStep("upload")}
            onConfirm={(blob, width, height) => void handleCropConfirm(blob, width, height)}
          />
        )}

        {step === "saving" && (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
            <p className="text-base font-medium text-gray-900">กำลังอัปโหลด...</p>
            <p className="text-sm text-gray-500">อย่าปิดหน้านี้จนกว่าจะอัปโหลดเสร็จ</p>
          </div>
        )}

        {step === "done" && createdPhotoId && universityId && (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
            <div className="text-4xl">✅</div>
            <p className="text-base font-semibold text-gray-900">เริ่มประมวลผลอัตโนมัติแล้ว</p>
            <p className="text-sm text-gray-600">
              ปิดหน้านี้หรือปิดแอปได้เลย ระบบจะอ่านป้ายและจัดเรียงแถว/ลำดับให้เองในเบื้องหลัง
              (ใช้เวลาประมาณ 2-5 นาที ขึ้นอยู่กับขนาดรูป)
            </p>
            <Link
              href={`/admin/universities/${universityId}/group-photos/${createdPhotoId}`}
              className="rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              ดูความคืบหน้า / เปิดหน้าแท็ก
            </Link>
            <button
              type="button"
              onClick={resetForNextPhoto}
              className="rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700"
            >
              อัปโหลดภาพถัดไป
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
