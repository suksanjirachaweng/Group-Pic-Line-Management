import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { requireUniversityAccess, AuthzError } from "@/lib/authz";
import { LEGACY_EXCEL_HEADERS } from "@/lib/groupPhoto/exportFormat";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; photoId: string }> },
) {
  const { id: universityId, photoId } = await params;

  try {
    await requireUniversityAccess(universityId);
  } catch (err) {
    if (err instanceof AuthzError) return new NextResponse(err.message, { status: 403 });
    throw err;
  }

  const photo = await prisma.groupPhoto.findUnique({
    where: { id: photoId, universityId },
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
