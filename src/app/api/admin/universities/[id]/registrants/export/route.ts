import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { requireUniversityAccess, AuthzError } from "@/lib/authz";
import { buildRegistrantWhere } from "@/lib/registrantFilters";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: universityId } = await params;

  try {
    await requireUniversityAccess(universityId);
  } catch (err) {
    if (err instanceof AuthzError) return new NextResponse(err.message, { status: 403 });
    throw err;
  }

  const university = await prisma.university.findUnique({
    where: { id: universityId },
    include: { formFields: { orderBy: { sortOrder: "asc" } } },
  });
  if (!university) return new NextResponse("University not found", { status: 404 });

  const sp = request.nextUrl.searchParams;
  const where = buildRegistrantWhere(universityId, {
    status: sp.get("status") ?? undefined,
    q: sp.get("q") ?? undefined,
    fieldKey: sp.get("fieldKey") ?? undefined,
    fieldValue: sp.get("fieldValue") ?? undefined,
  });

  const registrants = await prisma.registrant.findMany({
    where,
    orderBy: { registeredAt: "desc" },
    include: { channel: { select: { name: true } } },
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Registrants");

  sheet.columns = [
    { header: "Name", key: "name", width: 24 },
    { header: "LINE User ID", key: "lineUserId", width: 22 },
    { header: "LINE Channel", key: "channel", width: 20 },
    { header: "Friend", key: "friend", width: 10 },
    { header: "Status", key: "status", width: 12 },
    { header: "Registered", key: "registered", width: 20 },
    ...university.formFields.map((f) => ({ header: f.label, key: f.key, width: 24 })),
  ];
  sheet.getRow(1).font = { bold: true };

  for (const r of registrants) {
    const data = (r.data ?? {}) as Record<string, string>;
    sheet.addRow({
      name: r.displayName ?? "",
      lineUserId: r.lineUserId,
      channel: r.channel?.name ?? "",
      friend: r.isFriend ? "Yes" : "No",
      status: r.status,
      registered: r.registeredAt.toLocaleString(),
      ...Object.fromEntries(university.formFields.map((f) => [f.key, data[f.key] ?? ""])),
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `${university.slug}-registrants.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
