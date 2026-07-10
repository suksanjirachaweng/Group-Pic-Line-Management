import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildRowCaptionText } from "@/lib/groupPhoto/exportFormat";

/**
 * Public counterpart of /api/admin/.../export/text — no auth check, scoped by photoId alone.
 * See export/excel/route.ts for why.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ photoId: string }> }) {
  const { photoId } = await params;

  const photo = await prisma.groupPhoto.findUnique({
    where: { id: photoId },
    include: { tags: { orderBy: [{ row: "asc" }, { order: "asc" }] } },
  });
  if (!photo) return new NextResponse("Group photo not found", { status: 404 });

  const text = buildRowCaptionText(photo.tags);

  return new NextResponse(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(photo.name)}.txt"`,
    },
  });
}
