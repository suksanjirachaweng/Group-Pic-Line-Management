import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUniversityAccess, AuthzError } from "@/lib/authz";
import { buildRowCaptionText } from "@/lib/groupPhoto/exportFormat";

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

  const text = buildRowCaptionText(photo.tags);

  return new NextResponse(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(photo.name)}.txt"`,
    },
  });
}
