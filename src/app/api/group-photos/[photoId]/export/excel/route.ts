import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { LEGACY_EXCEL_HEADERS } from "@/lib/groupPhoto/exportFormat";

/**
 * Public counterpart of /api/admin/.../export/excel — deliberately no auth check, so a
 * forwarded /group-photos/[photoId]/validate link works for reviewers without an admin
 * account. Scoped by photoId alone (no universityId needed, unlike the admin route).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ photoId: string }> }) {
  const { photoId } = await params;

  const photo = await prisma.groupPhoto.findUnique({
    where: { id: photoId },
    include: { tags: { orderBy: [{ row: "asc" }, { order: "asc" }] } },
  });
  if (!photo) return new NextResponse("Group photo not found", { status: 404 });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("tags");
  sheet.addRow([...LEGACY_EXCEL_HEADERS]);
  sheet.getRow(1).font = { bold: true };

  for (const t of photo.tags) {
    sheet.addRow([t.name, t.code, t.row, t.order, Math.round(t.x), Math.round(t.y), photo.name]);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(photo.name)}.xlsx"`,
    },
  });
}
