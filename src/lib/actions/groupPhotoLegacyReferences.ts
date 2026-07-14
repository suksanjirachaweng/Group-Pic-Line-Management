"use server";

import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUniversityAccess } from "@/lib/authz";
import { normalizeCode } from "@/lib/groupPhoto/normalizeCode";
import { stripNameTitle } from "@/lib/groupPhoto/normalizeName";
import { getSheetsClient } from "@/lib/sheets";
import { LegacyReferenceSource } from "@/generated/prisma/enums";

export type LegacyImportState = { error: string } | { success: true; count: number } | null;

/**
 * Imports the legacy Google Form export (real format confirmed: header-less, columns
 * timestamp/blank/name/code/phone). Replaces the university's whole reference set on every
 * upload — this is reference data only, never merged into Registrant (see schema comment on
 * GroupPhotoLegacyReference for why).
 */
export async function importLegacyReferences(
  universityId: string,
  _prevState: LegacyImportState,
  formData: FormData,
): Promise<LegacyImportState> {
  await requireUniversityAccess(universityId);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "ยังไม่ได้เลือกไฟล์" };

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets[0];
  if (!sheet) return { error: "ไฟล์ Excel ว่างเปล่า" };

  const rows: { name: string; code: string; phone: string | null }[] = [];
  sheet.eachRow((row) => {
    const name = stripNameTitle(String(row.getCell(3).value ?? ""));
    const code = String(row.getCell(4).value ?? "").trim();
    const phoneCell = row.getCell(5).value;
    const phone = phoneCell ? String(phoneCell).trim() : null;
    if (!name || !code) return;
    rows.push({ name, code, phone });
  });

  if (rows.length === 0) {
    return { error: "ไม่พบข้อมูลที่ใช้ได้ในไฟล์ (คอลัมน์ที่ต้องมี: เวลา, ว่าง, ชื่อ, รหัส, เบอร์โทร)" };
  }

  await prisma.$transaction([
    prisma.groupPhotoLegacyReference.deleteMany({ where: { universityId } }),
    prisma.groupPhotoLegacyReference.createMany({
      data: rows.map((r) => ({
        universityId,
        name: r.name,
        code: r.code,
        normalizedCode: normalizeCode(r.code),
        phone: r.phone,
        source: LegacyReferenceSource.EXCEL_FILE,
      })),
    }),
  ]);

  revalidatePath(`/admin/universities/${universityId}/group-photos`);
  return { success: true, count: rows.length };
}

/** Accepts either a bare spreadsheet id or a full Google Sheets URL (with an optional `gid` tab reference). */
function parseSheetUrl(input: string): { spreadsheetId: string; gid: string | null } | null {
  const trimmed = input.trim();
  const idMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const spreadsheetId = idMatch ? idMatch[1] : /^[a-zA-Z0-9-_]+$/.test(trimmed) ? trimmed : null;
  if (!spreadsheetId) return null;
  const gidMatch = trimmed.match(/[?#&]gid=(\d+)/);
  return { spreadsheetId, gid: gidMatch ? gidMatch[1] : null };
}

/**
 * Imports directly from a live Google Sheet (e.g. a Google Form's response sheet) instead of a
 * one-off file upload — the same form link/sheet is reused across many events and years, so an
 * optional timestamp range lets the admin pull just the rows for the current one. Same column
 * layout as the file-upload path (timestamp, email, name, code, phone) but WITH a header row,
 * since that's how a real Google Form response sheet is always shaped — row 0 is always skipped.
 */
export async function importLegacyReferencesFromSheetLink(
  universityId: string,
  _prevState: LegacyImportState,
  formData: FormData,
): Promise<LegacyImportState> {
  await requireUniversityAccess(universityId);

  const sheetUrl = String(formData.get("sheetUrl") ?? "").trim();
  if (!sheetUrl) return { error: "กรุณาใส่ลิงก์ Google Sheet" };
  const parsed = parseSheetUrl(sheetUrl);
  if (!parsed) return { error: "ลิงก์ Google Sheet ไม่ถูกต้อง" };

  const startRaw = String(formData.get("startDate") ?? "").trim();
  const endRaw = String(formData.get("endDate") ?? "").trim();
  const start = startRaw ? new Date(startRaw) : null;
  const end = endRaw ? new Date(endRaw) : null;

  let values: unknown[][];
  try {
    const sheets = getSheetsClient();
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: parsed.spreadsheetId,
      fields: "sheets.properties",
    });
    const tabs = meta.data.sheets ?? [];
    const targetTab = parsed.gid ? tabs.find((t) => String(t.properties?.sheetId) === parsed.gid) : tabs[0];
    const sheetTitle = targetTab?.properties?.title;
    if (!sheetTitle) return { error: "ไม่พบชีทที่ระบุใน Google Sheet นี้" };

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: parsed.spreadsheetId,
      range: `'${sheetTitle}'!A:E`,
    });
    values = res.data.values ?? [];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `อ่าน Google Sheet ไม่สำเร็จ (ตรวจสอบว่าแชร์สิทธิ์ให้ service account แล้ว): ${message}` };
  }

  const rows: { name: string; code: string; phone: string | null }[] = [];
  for (const row of values.slice(1)) {
    const timestampRaw = String(row[0] ?? "").trim();
    const name = stripNameTitle(String(row[2] ?? ""));
    const code = String(row[3] ?? "").trim();
    const phoneRaw = row[4];
    const phone = phoneRaw ? String(phoneRaw).trim() : null;
    if (!name || !code) continue;

    if (start || end) {
      const timestamp = timestampRaw ? new Date(timestampRaw) : null;
      if (!timestamp || Number.isNaN(timestamp.getTime())) continue;
      if (start && timestamp < start) continue;
      if (end && timestamp > end) continue;
    }

    rows.push({ name, code, phone });
  }

  if (rows.length === 0) {
    return { error: "ไม่พบข้อมูลที่ใช้ได้ในช่วงเวลาที่เลือก" };
  }

  await prisma.$transaction([
    prisma.groupPhotoLegacyReference.deleteMany({ where: { universityId } }),
    prisma.groupPhotoLegacyReference.createMany({
      data: rows.map((r) => ({
        universityId,
        name: r.name,
        code: r.code,
        normalizedCode: normalizeCode(r.code),
        phone: r.phone,
        source: LegacyReferenceSource.GOOGLE_SHEET,
      })),
    }),
  ]);

  revalidatePath(`/admin/universities/${universityId}/group-photos`);
  return { success: true, count: rows.length };
}

/**
 * Retroactively strips unnecessary name-title prefixes (นาย/นาง/นางสาว/น.ส./Mr./Mrs./etc, see
 * `stripNameTitle`) from every existing `GroupPhotoLegacyReference` row for this university — for
 * data imported before that stripping existed at import time, or from a source (e.g. an older
 * Excel/Sheet import) that predates it. Only touches rows whose name actually changes; never
 * touches `Registrant.displayName` (that's the person's own live LINE profile name, not an
 * admin-imported reference the admin should be editing).
 */
export async function stripLegacyReferenceNameTitles(
  universityId: string,
): Promise<{ changed: number }> {
  await requireUniversityAccess(universityId);

  const rows = await prisma.groupPhotoLegacyReference.findMany({
    where: { universityId },
    select: { id: true, name: true },
  });

  const updates = rows
    .map((r) => ({ id: r.id, originalName: r.name, strippedName: stripNameTitle(r.name) }))
    .filter((r) => r.strippedName !== r.originalName && r.strippedName.length > 0);

  if (updates.length > 0) {
    await prisma.$transaction(
      updates.map((u) =>
        prisma.groupPhotoLegacyReference.update({
          where: { id: u.id },
          data: { name: u.strippedName },
        }),
      ),
    );
  }

  revalidatePath(`/admin/universities/${universityId}/group-photos`);
  return { changed: updates.length };
}
