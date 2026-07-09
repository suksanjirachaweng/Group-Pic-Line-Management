"use server";

import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUniversityAccess } from "@/lib/authz";
import { normalizeCode } from "@/lib/groupPhoto/normalizeCode";

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
    const name = String(row.getCell(3).value ?? "").trim();
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
      })),
    }),
  ]);

  revalidatePath(`/admin/universities/${universityId}/group-photos/legacy-reference`);
  return { success: true, count: rows.length };
}
