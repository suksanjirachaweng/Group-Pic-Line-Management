import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildGroupPhotoWordDoc } from "@/lib/groupPhoto/exportWord";
import { validateTags, problemTagIds } from "@/lib/groupPhoto/validateTags";

/**
 * Public counterpart of /api/.../export/excel|text — no auth check, scoped by photoId alone.
 * See export/excel/route.ts for why.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ photoId: string }> }) {
  const { photoId } = await params;

  const photo = await prisma.groupPhoto.findUnique({
    where: { id: photoId },
    include: { tags: { orderBy: [{ row: "asc" }, { order: "asc" }] } },
  });
  if (!photo) return new NextResponse("Group photo not found", { status: 404 });

  const problems = validateTags(photo.tags);
  const problemIds = problemTagIds(problems);
  const title = photo.title?.trim() || photo.name;

  const buffer = await buildGroupPhotoWordDoc({
    title,
    imageUrl: photo.imageUrl,
    tags: photo.tags,
    problemTagIds: problemIds,
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(photo.name)}.docx"`,
    },
  });
}
