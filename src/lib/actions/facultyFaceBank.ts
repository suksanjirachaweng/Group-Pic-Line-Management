"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { requireSuperadmin } from "@/lib/authz";
import { embedFace, isPcPhotoServerConfigured } from "@/lib/pcPhotoServer";
import { cosineSimilarity } from "@/lib/groupPhoto/faceMatching";

export type FacultyFaceProfileListItem = {
  id: string;
  name: string;
  sourceCropUrl: string;
  timesMatched: number;
  updatedAt: string;
  // Both resolved via best-effort lookups (lastEmbeddedTagId / lastSeenPhotoEventId are
  // intentionally not real FKs — see FacultyFaceProfile's own schema docstring — so either can be
  // null once the source tag/event no longer exists, e.g. after an event close-out deletes it).
  facultyName: string | null;
  universityName: string | null;
  photoEventId: string | null;
  photoEventLabel: string | null;
};

/** Global bank browse — not scoped to a university (superadmin only, same as /admin/channels). */
export async function listFacultyFaceProfiles(): Promise<FacultyFaceProfileListItem[]> {
  await requireSuperadmin();

  const profiles = await prisma.facultyFaceProfile.findMany({ orderBy: { name: "asc" } });

  const tagIds = [...new Set(profiles.map((p) => p.lastEmbeddedTagId).filter((id): id is string => !!id))];
  const tags = tagIds.length
    ? await prisma.groupPhotoTag.findMany({
        where: { id: { in: tagIds } },
        select: { id: true, groupPhoto: { select: { name: true, university: { select: { name: true } } } } },
      })
    : [];
  const tagById = new Map(tags.map((t) => [t.id, t]));

  const eventIds = [...new Set(profiles.map((p) => p.lastSeenPhotoEventId).filter((id): id is string => !!id))];
  const events = eventIds.length
    ? await prisma.photoEvent.findMany({ where: { id: { in: eventIds } }, select: { id: true, code: true, label: true } })
    : [];
  const eventById = new Map(events.map((e) => [e.id, e]));

  return profiles.map((p) => {
    const tag = p.lastEmbeddedTagId ? tagById.get(p.lastEmbeddedTagId) : undefined;
    const event = p.lastSeenPhotoEventId ? eventById.get(p.lastSeenPhotoEventId) : undefined;
    return {
      id: p.id,
      name: p.name,
      sourceCropUrl: p.sourceCropUrl,
      timesMatched: p.timesMatched,
      updatedAt: p.updatedAt.toISOString(),
      facultyName: tag?.groupPhoto.name ?? null,
      universityName: tag?.groupPhoto.university.name ?? null,
      photoEventId: p.lastSeenPhotoEventId,
      photoEventLabel: event ? (event.label ? `${event.code} — ${event.label}` : event.code) : null,
    };
  });
}

export type FaceBankSearchCandidate = { name: string; score: number; sourceCropUrl: string };
export type FaceBankSearchResult =
  | { status: "not_configured" }
  | { status: "no_face_detected" }
  | { status: "ok"; candidates: FaceBankSearchCandidate[] }
  | { status: "error"; message: string };

const TOP_CANDIDATES = 5;

/**
 * Search-by-face for the face-bank management page — unlike searchFacultyByFace (which crops a
 * point on an existing GroupPhoto), this takes a photo the admin uploads on the spot, so the
 * whole image goes straight to the PC server's own face detector with no crop math needed here.
 */
export async function searchFaceBankByUpload(
  _prevState: FaceBankSearchResult | null,
  formData: FormData,
): Promise<FaceBankSearchResult> {
  await requireSuperadmin();
  if (!isPcPhotoServerConfigured()) return { status: "not_configured" };

  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "กรุณาเลือกรูปภาพ" };
  }

  let embedResult: Awaited<ReturnType<typeof embedFace>>;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    embedResult = await embedFace(buf);
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "ค้นหาไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
  if (!embedResult) return { status: "no_face_detected" };

  const profiles = await prisma.facultyFaceProfile.findMany({
    select: { name: true, embedding: true, sourceCropUrl: true },
  });
  const ranked = profiles
    .map((p) => ({
      name: p.name,
      sourceCropUrl: p.sourceCropUrl,
      score: cosineSimilarity(embedResult!.embedding, p.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_CANDIDATES);

  return { status: "ok", candidates: ranked };
}

export type FaceBankProfileActionState = { error: string } | { success: true } | null;

export async function renameFacultyFaceProfile(
  id: string,
  _prevState: FaceBankProfileActionState,
  formData: FormData,
): Promise<FaceBankProfileActionState> {
  await requireSuperadmin();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "กรุณากรอกชื่อ" };

  try {
    await prisma.facultyFaceProfile.update({ where: { id }, data: { name } });
  } catch (err) {
    // name is @unique — renaming to a name another profile already has is a real, expected user
    // error (e.g. merging two entries manually isn't supported, so this surfaces instead of
    // silently overwriting the other row).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { error: `มีชื่อ "${name}" อยู่ในคลังแล้ว` };
    }
    return { error: err instanceof Error ? err.message : "บันทึกไม่สำเร็จ" };
  }

  revalidatePath("/admin/faculty-face-bank");
  return { success: true };
}

export async function deleteFacultyFaceProfile(id: string): Promise<{ error: string } | { success: true }> {
  await requireSuperadmin();

  try {
    await prisma.facultyFaceProfile.delete({ where: { id } });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "ลบไม่สำเร็จ" };
  }

  revalidatePath("/admin/faculty-face-bank");
  return { success: true };
}
