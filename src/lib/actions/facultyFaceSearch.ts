"use server";

import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { requireUniversityAccess } from "@/lib/authz";
import { embedFace, isPcPhotoServerConfigured } from "@/lib/pcPhotoServer";
import { cosineSimilarity } from "@/lib/groupPhoto/faceMatching";

// Same generous crop window validated in the de-risk spike (pc-photo-server/spike-face-recognition)
// against real, extremely high-resolution production photos — see EMBEDDING_FACES stage's own
// comment in process-photo-event-archive-jobs/route.ts for the full reasoning.
const FACE_CROP_SIZE = 1400;
const TOP_CANDIDATES = 5;

export type FaceSearchCandidate = { name: string; score: number; sourceCropUrl: string };
export type FaceSearchResult =
  | { status: "not_configured" }
  | { status: "no_face_detected" }
  | { status: "ok"; candidates: FaceSearchCandidate[] }
  | { status: "error"; message: string };

/**
 * Crops a generous window around (x, y) on the given photo, embeds it via the self-hosted PC
 * server, and returns the top faculty candidates ranked by cosine similarity — the admin always
 * makes the final call (this never auto-fills a name), matching the plan's explicit
 * "list candidates, let the admin decide" requirement.
 */
export async function searchFacultyByFace(
  universityId: string,
  groupPhotoId: string,
  x: number,
  y: number,
): Promise<FaceSearchResult> {
  await requireUniversityAccess(universityId);

  if (!isPcPhotoServerConfigured()) return { status: "not_configured" };

  const photo = await prisma.groupPhoto.findUniqueOrThrow({
    where: { id: groupPhotoId, universityId },
    select: { imageUrl: true, imageWidth: true, imageHeight: true },
  });

  const half = FACE_CROP_SIZE / 2;
  const left = Math.max(0, Math.min(photo.imageWidth - FACE_CROP_SIZE, Math.round(x - half)));
  const top = Math.max(0, Math.min(photo.imageHeight - FACE_CROP_SIZE, Math.round(y - half)));

  // Everything past this point crosses the network (photo fetch, the self-hosted PC embedding
  // server) or does raw image processing — any of those can fail or time out. Without this
  // try/catch, an uncaught rejection here leaves the caller's `loading` state stuck forever with
  // no feedback (found via a real "กำลังค้นหา..." that never resolved).
  let embedResult: Awaited<ReturnType<typeof embedFace>>;
  try {
    const resp = await fetch(photo.imageUrl);
    if (!resp.ok) throw new Error(`Failed to fetch photo image (${resp.status})`);
    const fullBuf = Buffer.from(await resp.arrayBuffer());
    const cropBuf = await sharp(fullBuf)
      .extract({
        left,
        top,
        width: Math.min(FACE_CROP_SIZE, photo.imageWidth),
        height: Math.min(FACE_CROP_SIZE, photo.imageHeight),
      })
      .jpeg({ quality: 90 })
      .toBuffer();

    embedResult = await embedFace(cropBuf);
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "ค้นหาไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
  if (!embedResult) return { status: "no_face_detected" };

  const profiles = await prisma.facultyFaceProfile.findMany({
    select: { name: true, embedding: true, sourceCropUrl: true },
  });
  const ranked = profiles
    .map((p) => ({ name: p.name, sourceCropUrl: p.sourceCropUrl, score: cosineSimilarity(embedResult.embedding, p.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_CANDIDATES);

  return { status: "ok", candidates: ranked };
}
