"use server";

import { prisma } from "@/lib/prisma";
import { requireUniversityAccess } from "@/lib/authz";
import { TagMatchSource } from "@/generated/prisma/enums";
import { buildTagMatchMaps, resolveTagMatch, type TagMatchMaps } from "@/lib/groupPhoto/resolveTagMatch";

export type CrossEventTagMismatch = {
  tagId: string;
  groupPhotoId: string;
  groupPhotoName: string;
  photoEventName: string;
  code: string;
  currentName: string;
  currentMatchSource: TagMatchSource;
  correctName: string | null;
  correctMatchSource: TagMatchSource;
};

/**
 * One-off audit for the pre-2026-07-22 bug where the tag editor matched registrants/legacy
 * references against every event of the university instead of just the tagged photo's own event
 * (see the fix in [photoId]/page.tsx and groupPhotos.ts's importGroupPhotoTagsFromMarkFile). Any
 * tag saved by a human through those paths before the fix could have picked up a name that
 * actually belongs to a different event's registrant/reference under the same code.
 *
 * Recomputes each REGISTRANT/LEGACY_REFERENCE-matched tag's "correct" match using the same
 * event-scoped resolveTagMatch every save path uses today, and flags any tag whose stored
 * name/matchSource/registrantId disagrees with that. Skips nameOverridden tags — a human
 * deliberately typed that name, so it isn't this bug regardless of what it says.
 */
export async function findCrossEventTagMismatches(universityId: string): Promise<CrossEventTagMismatch[]> {
  await requireUniversityAccess(universityId);

  const photos = await prisma.groupPhoto.findMany({
    where: { universityId },
    select: {
      id: true,
      name: true,
      photoEventId: true,
      photoEvent: { select: { code: true, label: true } },
      tags: {
        where: { nameOverridden: false, matchSource: { in: [TagMatchSource.REGISTRANT, TagMatchSource.LEGACY_REFERENCE] } },
        select: { id: true, code: true, normalizedCode: true, name: true, matchSource: true, registrantId: true },
      },
    },
  });

  const mapsByEvent = new Map<string, TagMatchMaps>();
  const results: CrossEventTagMismatch[] = [];

  for (const photo of photos) {
    if (photo.tags.length === 0) continue;
    let maps = mapsByEvent.get(photo.photoEventId);
    if (!maps) {
      maps = await buildTagMatchMaps(universityId, photo.photoEventId);
      mapsByEvent.set(photo.photoEventId, maps);
    }

    for (const tag of photo.tags) {
      const correct = resolveTagMatch(tag.normalizedCode, maps);
      const correctName = correct?.name ?? null;
      const correctMatchSource = correct?.matchSource ?? TagMatchSource.MANUAL;
      const correctRegistrantId = correct?.registrantId ?? null;
      if (
        tag.name !== correctName ||
        tag.matchSource !== correctMatchSource ||
        tag.registrantId !== correctRegistrantId
      ) {
        results.push({
          tagId: tag.id,
          groupPhotoId: photo.id,
          groupPhotoName: photo.name,
          photoEventName: photo.photoEvent.label
            ? `${photo.photoEvent.code} — ${photo.photoEvent.label}`
            : photo.photoEvent.code,
          code: tag.code,
          currentName: tag.name,
          currentMatchSource: tag.matchSource,
          correctName,
          correctMatchSource,
        });
      }
    }
  }

  return results;
}
