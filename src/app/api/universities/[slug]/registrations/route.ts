import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const lineUserId = new URL(request.url).searchParams.get("lineUserId");
  if (!lineUserId) {
    return NextResponse.json({ error: "Missing lineUserId" }, { status: 400 });
  }

  const university = await prisma.university.findUnique({ where: { slug } });
  if (!university || !university.isActive) {
    return NextResponse.json({ error: "University not found" }, { status: 404 });
  }

  const registrants = await prisma.registrant.findMany({
    where: { universityId: university.id, lineUserId },
    orderBy: { registeredAt: "asc" },
  });

  // A registrant's code can be tagged in more than one group photo (e.g. photographed with more
  // than one faculty), so this is a one-to-many lookup, not a single match.
  const tags = await prisma.groupPhotoTag.findMany({
    where: { registrantId: { in: registrants.map((r) => r.id) } },
    include: { groupPhoto: { select: { id: true, name: true } } },
  });
  const taggedPhotosByRegistrant = new Map<string, { groupPhotoId: string; tagId: string; photoName: string }[]>();
  for (const t of tags) {
    if (!t.registrantId) continue;
    const list = taggedPhotosByRegistrant.get(t.registrantId) ?? [];
    list.push({ groupPhotoId: t.groupPhoto.id, tagId: t.id, photoName: t.groupPhoto.name });
    taggedPhotosByRegistrant.set(t.registrantId, list);
  }

  return NextResponse.json({
    registrations: registrants.map((r) => ({
      id: r.id,
      registeredAt: r.registeredAt,
      data: r.data,
      taggedPhotos: taggedPhotosByRegistrant.get(r.id) ?? [],
    })),
  });
}
