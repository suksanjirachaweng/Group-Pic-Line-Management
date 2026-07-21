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

  // Every event this university has ever run, so an unstamped registrant's eligible event(s) can
  // be resolved the same "bootstrap" way the admin matching logic already does (see
  // buildEventScopedRegistrantWhere in resolveTagMatch.ts): a registrant with no photoEventId yet
  // is only a candidate for an event whose [startDate,endDate] window actually contains their
  // registeredAt. Without this, a registrant whose registeredAt falls in a gap between events (or
  // after the last one) would match tags from EVERY event's photos by code alone — the exact bug
  // reported 2026-07-21 (a registrant invisible on the admin Registrants page under any event
  // filter, yet the LIFF list still showed a matched photo link).
  const events = await prisma.photoEvent.findMany({
    where: { universityId: university.id },
    select: { id: true, startDate: true, endDate: true, hiddenFromLiff: true },
  });
  const hiddenEventIds = new Set(events.filter((e) => e.hiddenFromLiff).map((e) => e.id));

  // `null` here means "no restriction" (every tag is eligible), used only when the university has
  // zero PhotoEvent rows at all — e.g. every event has been archived-and-deleted (see the
  // PhotoEventArchiveJob close-out flow) and a new one hasn't been created yet. With truly no
  // events to bootstrap against, treating unstamped registrants as belonging to nothing would be
  // wrong (there's nothing to scope against, not a genuine gap) — they're one merged pool until a
  // new event exists to bootstrap into, same as a single wide-open event would behave.
  function eligibleEventIds(r: (typeof registrants)[number]): Set<string> | null {
    if (r.photoEventId) return new Set([r.photoEventId]);
    if (events.length === 0) return null;
    return new Set(
      events.filter((e) => r.registeredAt >= e.startDate && r.registeredAt <= e.endDate).map((e) => e.id),
    );
  }
  const eligibleEventsByRegistrant = new Map(registrants.map((r) => [r.id, eligibleEventIds(r)]));

  // A registrant whose ONLY possible event(s) are all admin-hidden (PhotoEvent.hiddenFromLiff)
  // should disappear from the list entirely, not just lose its photo matches — e.g. a professor
  // who registered last year under an old, now-superseded event, then registered again this year
  // under a new one; last year's entry shouldn't show at all once the admin hides that old event.
  // A registrant eligible for a MIX of hidden and visible events (overlapping-date case) still
  // shows, just without matching the hidden event's photos (handled in the tag loop below). A
  // registrant with an empty or null eligible set (genuine gap / zero-events pool) is untouched —
  // hiding is only for a deliberately-superseded event, not for "no event data at all."
  const excludedRegistrantIds = new Set<string>();
  for (const r of registrants) {
    const eligible = eligibleEventsByRegistrant.get(r.id);
    if (eligible && eligible.size > 0 && [...eligible].every((id) => hiddenEventIds.has(id))) {
      excludedRegistrantIds.add(r.id);
    }
  }

  // Matched by each registrant's *current* group_photo_index, not by a tag's stored registrantId
  // — that link is only ever refreshed when an admin re-opens the tagging page, so it goes stale
  // the moment someone corrects their code in LINE after already being tagged. A registrant's code
  // can also be tagged in more than one group photo (e.g. photographed with more than one
  // faculty), so this is a one-to-many lookup, not a single match.
  //
  // A single code can also map to MORE THAN ONE registrant — e.g. someone submits the form twice
  // without changing their group-photo number (to fix a typo, or by mistake). Real incident,
  // 2026-07-21: this used to be a single-value map (`.set()` overwriting on collision), so the
  // newer of two same-code registrations silently stole every matched photo and the older one
  // showed "photo not found" even though its code genuinely matched real tags. Every registrant
  // sharing a code must see the same matched photos, not just whichever one happened to be last.
  const codeToRegistrantIds = new Map<string, string[]>();
  for (const r of registrants) {
    const data = (r.data ?? {}) as Record<string, unknown>;
    const rawCode = data.group_photo_index;
    if (typeof rawCode !== "string" || !rawCode.trim()) continue;
    const normalizedCode = normalizeCode(rawCode);
    if (!normalizedCode) continue;
    const list = codeToRegistrantIds.get(normalizedCode) ?? [];
    list.push(r.id);
    codeToRegistrantIds.set(normalizedCode, list);
  }

  const tags = await prisma.groupPhotoTag.findMany({
    where: {
      normalizedCode: { in: [...codeToRegistrantIds.keys()] },
      groupPhoto: { universityId: university.id },
    },
    include: { groupPhoto: { select: { id: true, name: true, photoEventId: true } } },
  });
  const taggedPhotosByRegistrant = new Map<string, { groupPhotoId: string; tagId: string; photoName: string }[]>();
  for (const t of tags) {
    const registrantIds = codeToRegistrantIds.get(t.normalizedCode);
    if (!registrantIds) continue;
    for (const registrantId of registrantIds) {
      if (excludedRegistrantIds.has(registrantId)) continue;
      const eligible = eligibleEventsByRegistrant.get(registrantId);
      if (eligible !== null && !eligible?.has(t.groupPhoto.photoEventId)) continue;
      if (hiddenEventIds.has(t.groupPhoto.photoEventId)) continue;
      const list = taggedPhotosByRegistrant.get(registrantId) ?? [];
      list.push({ groupPhotoId: t.groupPhoto.id, tagId: t.id, photoName: t.groupPhoto.name });
      taggedPhotosByRegistrant.set(registrantId, list);
    }
  }

  return NextResponse.json({
    registrations: registrants
      .filter((r) => !excludedRegistrantIds.has(r.id))
      .map((r) => ({
        id: r.id,
        registeredAt: r.registeredAt,
        data: r.data,
        taggedPhotos: taggedPhotosByRegistrant.get(r.id) ?? [],
      })),
  });
}
