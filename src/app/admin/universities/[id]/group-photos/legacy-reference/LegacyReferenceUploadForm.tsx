"use client";

import { useActionState } from "react";
import {
  importLegacyReferences,
  importLegacyReferencesFromSheetLink,
  type LegacyImportState,
} from "@/lib/actions/groupPhotoLegacyReferences";

export function LegacyReferenceUploadForm({
  universityId,
  serviceAccountEmail,
}: {
  universityId: string;
  serviceAccountEmail: string | null;
}) {
  const fileAction = importLegacyReferences.bind(null, universityId);
  const [fileState, fileFormAction, fileIsPending] = useActionState<LegacyImportState, FormData>(fileAction, null);

  const sheetAction = importLegacyReferencesFromSheetLink.bind(null, universityId);
  const [sheetState, sheetFormAction, sheetIsPending] = useActionState<LegacyImportState, FormData>(
    sheetAction,
    null,
  );

  return (
    <div className="space-y-3">
      <form action={fileFormAction} className="flex items-center gap-2">
        <input
          type="file"
          name="file"
          accept=".xlsx,.xls"
          required
          className="cursor-pointer text-sm text-gray-500 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-gray-700 file:hover:bg-gray-200"
        />
        <button
          type="submit"
          disabled={fileIsPending}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {fileIsPending ? "กำลังนำเข้า..." : "อัปโหลดไฟล์ (แทนที่ข้อมูลเดิม)"}
        </button>
        {fileState && "error" in fileState && <p className="text-xs text-red-600">{fileState.error}</p>}
        {fileState && "success" in fileState && <p className="text-xs text-green-600">นำเข้าแล้ว {fileState.count} รายการ</p>}
      </form>

      <form action={sheetFormAction} className="rounded-md border border-gray-200 bg-white p-3">
        <label className="block text-xs font-medium text-gray-700">หรือนำเข้าจากลิงก์ Google Sheet โดยตรง</label>
        <input
          type="url"
          name="sheetUrl"
          placeholder="https://docs.google.com/spreadsheets/d/..."
          required
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        />
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-600">
            ตั้งแต่วันที่ (ไม่บังคับ)
            <input
              type="datetime-local"
              name="startDate"
              className="mt-1 block rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-gray-600">
            ถึงวันที่ (ไม่บังคับ)
            <input
              type="datetime-local"
              name="endDate"
              className="mt-1 block rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={sheetIsPending}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {sheetIsPending ? "กำลังนำเข้า..." : "นำเข้าจาก Sheet (แทนที่ข้อมูลเดิม)"}
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-400">
          ไม่ระบุช่วงเวลา = นำเข้าทุกแถว ต้องแชร์สิทธิ์ดู Sheet นี้ให้
          {serviceAccountEmail ? (
            <span className="font-mono"> {serviceAccountEmail}</span>
          ) : (
            " service account ของระบบ"
          )}{" "}
          ก่อน
        </p>
        {sheetState && "error" in sheetState && <p className="mt-1 text-xs text-red-600">{sheetState.error}</p>}
        {sheetState && "success" in sheetState && (
          <p className="mt-1 text-xs text-green-600">นำเข้าแล้ว {sheetState.count} รายการ</p>
        )}
      </form>
    </div>
  );
}
