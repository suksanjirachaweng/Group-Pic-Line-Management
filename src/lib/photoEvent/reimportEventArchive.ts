import "server-only";
import { prisma } from "@/lib/prisma";
import { fetchArchiveDataJson } from "./archiveStorage";
import { PhotoEventStatus, RegistrantStatus, DeliveryStatus, GroupPhotoStatus, TagMatchSource, TagHistorySource } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

export type ReimportSummary = {
  registrants: number;
  groupPhotos: number;
  tags: number;
  legacyReferences: number;
  skippedMessageJobs: number;
  skippedMessageLogs: number;
  skippedRuleExecutions: number;
};

/** Recreates every child row of a PhotoEvent from its close-out archive — the reverse of
 * buildEventArchiveData.ts. The PhotoEvent row itself is never deleted by close-out (see
 * deletePhotoEventData.ts), so this reimports INTO the same still-existing event, just flipping
 * its status back to ACTIVE once done.
 *
 * Recreated rows always get fresh ids (Prisma default) — old ids in the archive exist only to
 * cross-reference rows within the bundle, remapped here via old->new id maps. Recreated
 * GroupPhoto.imageUrl points directly at the archive's own durable image copy rather than
 * re-uploading a duplicate — see the "don't delete an image still referenced by a live row" guard
 * in deletePhotoEventData.ts, which is what makes this safe to do twice across repeat
 * close-out/reimport cycles.
 *
 * MessageJob/MessageLog/RuleExecution rows reference shared, non-archived infrastructure
 * (Channel, Rule) by id — if that channel/rule no longer exists, the row is skipped rather than
 * failing the whole reimport; counts are returned so the admin can see if anything was dropped.
 */
export async function reimportEventArchive(photoEventId: string): Promise<ReimportSummary> {
  const event = await prisma.photoEvent.findUniqueOrThrow({ where: { id: photoEventId } });
  if (!event.archiveFileUrl) {
    throw new Error("งานนี้ไม่มีไฟล์ backup ให้กู้คืน");
  }
  if (event.status !== PhotoEventStatus.ARCHIVED) {
    throw new Error("กู้คืนได้เฉพาะงานที่ปิดและลบข้อมูลแล้วเท่านั้น");
  }

  const bundle = await fetchArchiveDataJson(event.archiveFileUrl);

  const [validChannelIds, validRuleIds] = await Promise.all([
    prisma.channel.findMany({ select: { id: true } }).then((rows) => new Set(rows.map((r) => r.id))),
    prisma.rule
      .findMany({ where: { universityId: event.universityId }, select: { id: true } })
      .then((rows) => new Set(rows.map((r) => r.id))),
  ]);

  const summary: ReimportSummary = {
    registrants: 0,
    groupPhotos: 0,
    tags: 0,
    legacyReferences: 0,
    skippedMessageJobs: 0,
    skippedMessageLogs: 0,
    skippedRuleExecutions: 0,
  };

  const registrantIdMap = new Map<string, string>();
  const ruleExecutionIdMap = new Map<string, string>();

  for (const r of bundle.registrants) {
    const created = await prisma.registrant.create({
      data: {
        universityId: event.universityId,
        photoEventId: event.id,
        channelId: r.channelId && validChannelIds.has(r.channelId) ? r.channelId : null,
        lineUserId: r.lineUserId,
        isFriend: r.isFriend,
        displayName: r.displayName,
        data: r.data as Prisma.InputJsonValue,
        status: r.status as RegistrantStatus,
        deliveryStatus: r.deliveryStatus as DeliveryStatus,
        registeredAt: new Date(r.registeredAt),
      },
    });
    registrantIdMap.set(r.id, created.id);
    summary.registrants++;

    for (const e of r.ruleExecutions) {
      if (!validRuleIds.has(e.ruleId)) {
        summary.skippedRuleExecutions++;
        continue;
      }
      const createdExec = await prisma.ruleExecution.create({
        data: {
          ruleId: e.ruleId,
          registrantId: created.id,
          status: e.status as Prisma.RuleExecutionCreateInput["status"],
          attemptedAt: new Date(e.attemptedAt),
          sentAt: e.sentAt ? new Date(e.sentAt) : null,
          errorDetail: e.errorDetail,
        },
      });
      ruleExecutionIdMap.set(e.id, createdExec.id);
    }

    for (const j of r.messageJobs) {
      if (!validChannelIds.has(j.channelId)) {
        summary.skippedMessageJobs++;
        continue;
      }
      await prisma.messageJob.create({
        data: {
          registrantId: created.id,
          channelId: j.channelId,
          source: j.source as Prisma.MessageJobCreateInput["source"],
          ruleExecutionId: j.ruleExecutionId ? (ruleExecutionIdMap.get(j.ruleExecutionId) ?? null) : null,
          body: j.body,
          imageUrl: j.imageUrl,
          linkUrl: j.linkUrl,
          status: j.status as Prisma.MessageJobCreateInput["status"],
          attempts: j.attempts,
          lastError: j.lastError,
          createdAt: new Date(j.createdAt),
          processedAt: j.processedAt ? new Date(j.processedAt) : null,
        },
      });
    }

    for (const l of r.messageLogs) {
      if (!validChannelIds.has(l.channelId)) {
        summary.skippedMessageLogs++;
        continue;
      }
      await prisma.messageLog.create({
        data: {
          registrantId: created.id,
          channelId: l.channelId,
          body: l.body,
          lineApiResponseStatus: l.lineApiResponseStatus,
          createdAt: new Date(l.createdAt),
        },
      });
    }
  }

  for (const p of bundle.groupPhotos) {
    const archivedImageUrl = new URL(p.archivedImagePath, event.archiveFileUrl).toString();
    const createdPhoto = await prisma.groupPhoto.create({
      data: {
        universityId: event.universityId,
        photoEventId: event.id,
        name: p.name,
        title: p.title,
        imageUrl: archivedImageUrl,
        imageWidth: p.imageWidth,
        imageHeight: p.imageHeight,
        sortOrder: p.sortOrder,
        status: p.status as GroupPhotoStatus,
        createdAt: new Date(p.createdAt),
      },
    });
    summary.groupPhotos++;

    for (const t of p.tags) {
      const createdTag = await prisma.groupPhotoTag.create({
        data: {
          groupPhotoId: createdPhoto.id,
          code: t.code,
          normalizedCode: t.normalizedCode,
          name: t.name,
          row: t.row,
          order: t.order,
          x: t.x,
          y: t.y,
          registrantId: t.registrantId ? (registrantIdMap.get(t.registrantId) ?? null) : null,
          matchSource: t.matchSource as TagMatchSource,
          nameOverridden: t.nameOverridden,
          editedViaPublicLink: t.editedViaPublicLink,
          publicLinkEditedAt: t.publicLinkEditedAt ? new Date(t.publicLinkEditedAt) : null,
          confirmedViaPublicLink: t.confirmedViaPublicLink,
          confirmedAt: t.confirmedAt ? new Date(t.confirmedAt) : null,
          reportedProblem: t.reportedProblem,
          reportedAt: t.reportedAt ? new Date(t.reportedAt) : null,
          problemAcknowledged: t.problemAcknowledged,
          ocrLowConfidence: t.ocrLowConfidence,
        },
      });
      summary.tags++;

      if (t.history.length > 0) {
        await prisma.groupPhotoTagHistory.createMany({
          data: t.history.map((h) => ({
            tagId: createdTag.id,
            code: h.code,
            name: h.name,
            row: h.row,
            order: h.order,
            source: h.source as TagHistorySource,
            createdAt: new Date(h.createdAt),
          })),
        });
      }
    }

    if (p.shareLinks.length > 0) {
      await prisma.groupPhotoShareLink.createMany({
        // Reimported links are always deactivated regardless of their archived state — a safe
        // default so a previously-shared link doesn't silently come back to life; the admin can
        // reactivate deliberately if they still want it.
        data: p.shareLinks.map((s) => ({ groupPhotoId: createdPhoto.id, token: s.token, isActive: false })),
      });
    }
    if (p.titleHistory.length > 0) {
      await prisma.groupPhotoTitleHistory.createMany({
        data: p.titleHistory.map((h) => ({
          groupPhotoId: createdPhoto.id,
          title: h.title,
          source: h.source as TagHistorySource,
          createdAt: new Date(h.createdAt),
        })),
      });
    }
  }

  if (bundle.legacyReferences.length > 0) {
    await prisma.groupPhotoLegacyReference.createMany({
      data: bundle.legacyReferences.map((r) => ({
        universityId: event.universityId,
        photoEventId: event.id,
        name: r.name,
        code: r.code,
        normalizedCode: r.normalizedCode,
        phone: r.phone,
        source: r.source as Prisma.GroupPhotoLegacyReferenceCreateInput["source"],
        createdAt: new Date(r.createdAt),
      })),
    });
    summary.legacyReferences = bundle.legacyReferences.length;
  }

  await prisma.photoEvent.update({
    where: { id: event.id },
    data: { status: PhotoEventStatus.ACTIVE, hiddenFromLiff: false },
  });

  return summary;
}
