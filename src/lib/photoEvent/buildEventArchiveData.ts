import "server-only";
import { prisma } from "@/lib/prisma";
import type { PhotoEventArchiveBundle } from "./archiveTypes";

function extensionFromUrl(url: string): string {
  const path = new URL(url).pathname;
  const match = /\.([a-zA-Z0-9]+)$/.exec(path);
  return match ? match[1].toLowerCase() : "jpg";
}

/** Relative path (within the archive's own prefix) where a photo's copied image will live — kept
 * deterministic from the photo id + its live image's extension so data.json can reference it
 * immediately, before the image-copy stage has actually uploaded the bytes there. */
export function archivedImageRelativePath(groupPhotoId: string, liveImageUrl: string): string {
  return `images/${groupPhotoId}.${extensionFromUrl(liveImageUrl)}`;
}

/** Serializes everything scoped to one PhotoEvent into one JSON-safe bundle — the manifest half of
 * the close-out archive. Deliberately excludes shared, non-event-scoped infrastructure (Channel,
 * Rule rows themselves) — MessageJob/MessageLog/RuleExecution rows still reference those by id,
 * which reimportEventArchive.ts best-effort re-links against whatever still exists live. */
export async function buildEventArchiveData(photoEventId: string): Promise<PhotoEventArchiveBundle> {
  const event = await prisma.photoEvent.findUniqueOrThrow({ where: { id: photoEventId } });

  const [registrants, groupPhotos, legacyReferences] = await Promise.all([
    prisma.registrant.findMany({
      where: { photoEventId },
      include: { ruleExecutions: true, messageJobs: true, messageLogs: true },
    }),
    prisma.groupPhoto.findMany({
      where: { photoEventId },
      include: {
        tags: { include: { history: true } },
        shareLinks: true,
        titleHistory: true,
        autoTagJobs: { include: { hits: true } },
      },
    }),
    prisma.groupPhotoLegacyReference.findMany({ where: { photoEventId } }),
  ]);

  return {
    version: 1,
    archivedAt: new Date().toISOString(),
    photoEvent: {
      id: event.id,
      universityId: event.universityId,
      code: event.code,
      label: event.label,
      startDate: event.startDate.toISOString(),
      endDate: event.endDate.toISOString(),
      codeRangeMin: event.codeRangeMin,
      codeRangeMax: event.codeRangeMax,
      createdAt: event.createdAt.toISOString(),
    },
    registrants: registrants.map((r) => ({
      id: r.id,
      channelId: r.channelId,
      lineUserId: r.lineUserId,
      isFriend: r.isFriend,
      displayName: r.displayName,
      data: r.data,
      status: r.status,
      deliveryStatus: r.deliveryStatus,
      registeredAt: r.registeredAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      ruleExecutions: r.ruleExecutions.map((e) => ({
        id: e.id,
        ruleId: e.ruleId,
        status: e.status,
        attemptedAt: e.attemptedAt.toISOString(),
        sentAt: e.sentAt?.toISOString() ?? null,
        errorDetail: e.errorDetail,
      })),
      messageJobs: r.messageJobs.map((j) => ({
        id: j.id,
        channelId: j.channelId,
        source: j.source,
        ruleExecutionId: j.ruleExecutionId,
        body: j.body,
        imageUrl: j.imageUrl,
        linkUrl: j.linkUrl,
        status: j.status,
        attempts: j.attempts,
        lastError: j.lastError,
        createdAt: j.createdAt.toISOString(),
        processedAt: j.processedAt?.toISOString() ?? null,
      })),
      messageLogs: r.messageLogs.map((l) => ({
        id: l.id,
        channelId: l.channelId,
        body: l.body,
        lineApiResponseStatus: l.lineApiResponseStatus,
        createdAt: l.createdAt.toISOString(),
      })),
    })),
    groupPhotos: groupPhotos.map((p) => ({
      id: p.id,
      name: p.name,
      title: p.title,
      archivedImagePath: archivedImageRelativePath(p.id, p.imageUrl),
      imageWidth: p.imageWidth,
      imageHeight: p.imageHeight,
      sortOrder: p.sortOrder,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      tags: p.tags.map((t) => ({
        id: t.id,
        code: t.code,
        normalizedCode: t.normalizedCode,
        name: t.name,
        row: t.row,
        order: t.order,
        x: t.x,
        y: t.y,
        registrantId: t.registrantId,
        matchSource: t.matchSource,
        nameOverridden: t.nameOverridden,
        editedViaPublicLink: t.editedViaPublicLink,
        publicLinkEditedAt: t.publicLinkEditedAt?.toISOString() ?? null,
        confirmedViaPublicLink: t.confirmedViaPublicLink,
        confirmedAt: t.confirmedAt?.toISOString() ?? null,
        reportedProblem: t.reportedProblem,
        reportedAt: t.reportedAt?.toISOString() ?? null,
        problemAcknowledged: t.problemAcknowledged,
        ocrLowConfidence: t.ocrLowConfidence,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        history: t.history.map((h) => ({
          id: h.id,
          code: h.code,
          name: h.name,
          row: h.row,
          order: h.order,
          source: h.source,
          createdAt: h.createdAt.toISOString(),
        })),
      })),
      shareLinks: p.shareLinks.map((s) => ({
        id: s.id,
        token: s.token,
        isActive: s.isActive,
        createdAt: s.createdAt.toISOString(),
      })),
      titleHistory: p.titleHistory.map((h) => ({
        id: h.id,
        title: h.title,
        source: h.source,
        createdAt: h.createdAt.toISOString(),
      })),
      autoTagJobs: p.autoTagJobs.map((j) => ({
        id: j.id,
        stage: j.stage,
        tilesTotal: j.tilesTotal,
        tilesDone: j.tilesDone,
        errorMessage: j.errorMessage,
        createdAt: j.createdAt.toISOString(),
        completedAt: j.completedAt?.toISOString() ?? null,
        hits: j.hits.map((h) => ({
          id: h.id,
          tileIndex: h.tileIndex,
          code: h.code,
          x: h.x,
          y: h.y,
          confident: h.confident,
        })),
      })),
    })),
    legacyReferences: legacyReferences.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      normalizedCode: r.normalizedCode,
      phone: r.phone,
      source: r.source,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  };
}
