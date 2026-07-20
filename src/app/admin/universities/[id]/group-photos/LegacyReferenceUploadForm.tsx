"use client";

import { useActionState } from "react";
import {
  importLegacyReferences,
  importLegacyReferencesFromSheetLink,
  type LegacyImportState,
} from "@/lib/actions/groupPhotoLegacyReferences";

export function LegacyReferenceUploadForm({
  universityId,
  photoEventId,
}: {
  universityId: string;
  photoEventId: string;
}) {
  const fileAction = importLegacyReferences.bind(null, universityId, photoEventId);
  const [fileState, fileFormAction, fileIsPending] = useActionState<LegacyImportState, FormData>(fileAction, null);

  const sheetAction = importLegacyReferencesFromSheetLink.bind(null, universityId, photoEventId);
  const [sheetState, sheetFormAction, sheetIsPending] = useActionState<LegacyImportState, FormData>(
    sheetAction,
    null,
  );

  return (
    <div className="flex flex-col gap-3">
      <form
        action={fileFormAction}
        className="flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 p-3"
      >
        <span className="inline-flex w-fit flex-none items-center rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white">
          Excel
        </span>
        <label className="flex-none text-xs font-medium text-gray-700">นำเข้าจากไฟล์ Excel</label>
        <input
          type="file"
          name="file"
          accept=".xlsx,.xls"
          required
          className="cursor-pointer text-sm text-gray-500 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-gray-700 file:shadow-sm file:hover:bg-amber-100"
        />
        <button
          type="submit"
          disabled={fileIsPending}
          className="ml-auto flex-none rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium leading-tight text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {fileIsPending ? (
            "กำลังนำเข้า..."
          ) : (
            <>
              Import
              <br />
              (แทนที่ข้อมูลเดิม)
            </>
          )}
        </button>
        {fileState && "error" in fileState && <p className="w-full text-xs text-red-600">{fileState.error}</p>}
        {fileState && "success" in fileState && (
          <p className="w-full text-xs text-green-600">นำเข้าแล้ว {fileState.count} รายการ</p>
        )}
      </form>

      <form
        action={sheetFormAction}
        className="flex flex-wrap items-end gap-3 rounded-md border border-orange-200 bg-orange-50 p-3"
      >
        <div className="flex flex-none flex-col gap-1">
          <span className="inline-flex w-fit items-center rounded-full bg-orange-500 px-2 py-0.5 text-xs font-semibold text-white">
            Google Sheet
          </span>
          <label className="text-xs font-medium text-gray-700">Link:</label>
        </div>
        <input
          type="url"
          name="sheetUrl"
          placeholder="https://docs.google.com/spreadsheets/d/..."
          required
          className="min-w-[220px] flex-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm"
        />
        <label className="flex-none text-xs text-gray-600">
          ตั้งแต่วันที่ (ไม่บังคับ)
          <input
            type="datetime-local"
            name="startDate"
            className="mt-1 block rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex-none text-xs text-gray-600">
          ถึงวันที่ (ไม่บังคับ)
          <input
            type="datetime-local"
            name="endDate"
            className="mt-1 block rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={sheetIsPending}
          className="ml-auto flex-none rounded-md bg-orange-600 px-3 py-1.5 text-sm font-medium leading-tight text-white hover:bg-orange-700 disabled:opacity-50"
        >
          {sheetIsPending ? (
            "กำลังนำเข้า..."
          ) : (
            <>
              Import
              <br />
              (แทนที่ข้อมูลเดิม)
            </>
          )}
        </button>
        {sheetState && "error" in sheetState && <p className="w-full text-xs text-red-600">{sheetState.error}</p>}
        {sheetState && "success" in sheetState && (
          <p className="w-full text-xs text-green-600">นำเข้าแล้ว {sheetState.count} รายการ</p>
        )}
      </form>
    </div>
  );
}
