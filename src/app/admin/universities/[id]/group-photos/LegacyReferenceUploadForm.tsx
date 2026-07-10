"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  importLegacyReferences,
  importLegacyReferencesFromSheetLink,
  type LegacyImportState,
} from "@/lib/actions/groupPhotoLegacyReferences";

export function LegacyReferenceUploadForm({
  universityId,
  serviceAccountEmail,
  registrantCount,
}: {
  universityId: string;
  serviceAccountEmail: string | null;
  registrantCount: number;
}) {
  const fileAction = importLegacyReferences.bind(null, universityId);
  const [fileState, fileFormAction, fileIsPending] = useActionState<LegacyImportState, FormData>(fileAction, null);

  const sheetAction = importLegacyReferencesFromSheetLink.bind(null, universityId);
  const [sheetState, sheetFormAction, sheetIsPending] = useActionState<LegacyImportState, FormData>(
    sheetAction,
    null,
  );

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <form action={fileFormAction} className="flex flex-col rounded-md border border-amber-200 bg-amber-50 p-3">
        <span className="mb-2 inline-flex w-fit items-center rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white">
          Excel
        </span>
        <label className="block text-xs font-medium text-gray-700">นำเข้าจากไฟล์ Excel</label>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="file"
            name="file"
            accept=".xlsx,.xls"
            required
            className="cursor-pointer text-sm text-gray-500 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-gray-700 file:shadow-sm file:hover:bg-amber-100"
          />
        </div>
        <button
          type="submit"
          disabled={fileIsPending}
          className="mt-2 w-fit rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {fileIsPending ? "กำลังนำเข้า..." : "อัปโหลดไฟล์ (แทนที่ข้อมูลเดิม)"}
        </button>
        {fileState && "error" in fileState && <p className="mt-1 text-xs text-red-600">{fileState.error}</p>}
        {fileState && "success" in fileState && (
          <p className="mt-1 text-xs text-green-600">นำเข้าแล้ว {fileState.count} รายการ</p>
        )}
      </form>

      <form action={sheetFormAction} className="flex flex-col rounded-md border border-orange-200 bg-orange-50 p-3">
        <span className="mb-2 inline-flex w-fit items-center rounded-full bg-orange-500 px-2 py-0.5 text-xs font-semibold text-white">
          Google Sheet
        </span>
        <label className="block text-xs font-medium text-gray-700">นำเข้าจากลิงก์ Google Sheet โดยตรง</label>
        <input
          type="url"
          name="sheetUrl"
          placeholder="https://docs.google.com/spreadsheets/d/..."
          required
          className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm"
        />
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-600">
            ตั้งแต่วันที่ (ไม่บังคับ)
            <input
              type="datetime-local"
              name="startDate"
              className="mt-1 block rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-gray-600">
            ถึงวันที่ (ไม่บังคับ)
            <input
              type="datetime-local"
              name="endDate"
              className="mt-1 block rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={sheetIsPending}
          className="mt-2 w-fit rounded-md bg-orange-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
        >
          {sheetIsPending ? "กำลังนำเข้า..." : "นำเข้าจาก Sheet (แทนที่ข้อมูลเดิม)"}
        </button>
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

      <div className="flex flex-col rounded-md border border-green-200 bg-green-50 p-3">
        <span className="mb-2 inline-flex w-fit items-center rounded-full bg-green-500 px-2 py-0.5 text-xs font-semibold text-white">
          LINE
        </span>
        <label className="block text-xs font-medium text-gray-700">ผู้ลงทะเบียนผ่าน LINE</label>
        <p className="mt-2 text-xs text-gray-500">
          ข้อมูลชื่อ/CODE ของผู้ที่ลงทะเบียนผ่านระบบ LINE โดยตรง ไม่ต้องนำเข้าเอง — อัปเดตอัตโนมัติทันทีที่มีคนลงทะเบียนใหม่
        </p>
        <p className="mt-2 text-2xl font-semibold text-gray-900">{registrantCount.toLocaleString()}</p>
        <p className="text-xs text-gray-400">คนลงทะเบียนแล้ว</p>
        <Link
          href={`/admin/universities/${universityId}/registrants`}
          className="mt-auto pt-2 text-xs font-medium text-green-700 hover:underline"
        >
          ดูรายชื่อผู้ลงทะเบียน LINE (ส่งข้อความ/ตัวกรองขั้นสูง) →
        </Link>
      </div>
    </div>
  );
}
