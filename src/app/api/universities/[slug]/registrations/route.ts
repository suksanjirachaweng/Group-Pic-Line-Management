import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeCode } from "@/lib/groupPhoto/normalizeCode";

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

  // Matched by each registrant's *current* group_photo_index, not by a tag's stored registrantId
  // — that link is only ever refreshed when an admin re-opens the tagging page, so it goes stale
  // the moment someone corrects their code in LINE after already being tagged. A registrant's code
  // can also be tagged in more than one group photo (e.g. photographed with more than one
  // faculty), so this is a one-to-many lookup, not a single match.
  const codeToRegistrantId = new Map<string, string>();
  for (const r of registrants) {
    const data = (r.data ?? {}) as Record<string, unknown>;
    const rawCode = data.group_photo_index;
    if (typeof rawCode !== "string" || !rawCode.trim()) continue;
    const normalizedCode = normalizeCode(rawCode);
    if (normalizedCode) codeToRegistrantId.set(normalizedCode, r.id);
  }

  const tags = await prisma.groupPhotoTag.findMany({
    where: {
      normalizedCode: { in: [...codeToRegistrantId.keys()] },
      groupPhoto: { universityId: university.id },
    },
    include: { groupPhoto: { select: { id: true, name: true } } },
  });
  const taggedPhotosByRegistrant = new Map<string, { groupPhotoId: string; tagId: string; photoName: string }[]>();
  for (const t of tags) {
    const registrantId = codeToRegistrantId.get(t.normalizedCode);
    if (!registrantId) continue;
    const list = taggedPhotosByRegistrant.get(registrantId) ?? [];
    list.push({ groupPhotoId: t.groupPhoto.id, tagId: t.id, photoName: t.groupPhoto.name });
    taggedPhotosByRegistrant.set(registrantId, list);
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
