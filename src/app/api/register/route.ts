import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { evaluateOnRegistrationRules } from "@/lib/rules/trigger";
import { syncRegistrantGroupPhotoTags } from "@/lib/groupPhoto/syncRegistrantTags";

const registerSchema = z.object({
  universitySlug: z.string().min(1),
  liffId: z.string().min(1),
  lineUserId: z.string().min(1),
  displayName: z.string().optional(),
  isFriend: z.boolean(),
  data: z.record(z.string(), z.union([z.string(), z.number()])),
  // When set, updates that specific prior registration instead of creating a new one.
  registrantId: z.string().optional(),
});

export async function POST(request: Request) {
  const parsed = registerSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }
  const { universitySlug, liffId, lineUserId, displayName, isFriend, data, registrantId } = parsed.data;

  const university = await prisma.university.findUnique({
    where: { slug: universitySlug },
    include: { formFields: true },
  });
  if (!university || !university.isActive) {
    return NextResponse.json({ error: "University not found" }, { status: 404 });
  }

  const channel = await prisma.channel.findFirst({
    where: {
      liffId,
      isActive: true,
      universityPool: { some: { universityId: university.id, isActive: true } },
    },
  });
  if (!channel) {
    return NextResponse.json({ error: "Channel not recognized for this university" }, { status: 400 });
  }

  const missingRequired = university.formFields
    .filter((f) => f.isRequired)
    .filter((f) => data[f.key] === undefined || data[f.key] === "");
  if (missingRequired.length > 0) {
    return NextResponse.json(
      { error: "Missing required fields", fields: missingRequired.map((f) => f.key) },
      { status: 400 },
    );
  }

  // Only persist keys that are actually defined fields for this university — never trust
  // arbitrary client-supplied keys straight into the JSON column.
  const knownKeys = new Set(university.formFields.map((f) => f.key));
  const cleanData = Object.fromEntries(Object.entries(data).filter(([key]) => knownKeys.has(key)));

  let registrant;
  if (registrantId) {
    const existing = await prisma.registrant.findUnique({ where: { id: registrantId } });
    if (!existing || existing.universityId !== university.id || existing.lineUserId !== lineUserId) {
      return NextResponse.json({ error: "Registration not found" }, { status: 404 });
    }
    registrant = await prisma.registrant.update({
      where: { id: registrantId },
      data: { channelId: channel.id, displayName, isFriend, data: cleanData },
    });
  } else {
    registrant = await prisma.registrant.create({
      data: {
        universityId: university.id,
        channelId: channel.id,
        lineUserId,
        displayName,
        isFriend,
        data: cleanData,
      },
    });
  }

  // Best-effort: keep this registrant's group-photo tag(s) in sync with their (possibly just
  // corrected) code right away, rather than waiting for an admin to reopen the tagging page —
  // plenty of graduates never revisit their self-check link to trigger that page's own fallback.
  try {
    await syncRegistrantGroupPhotoTags(university.id, registrant.id);
  } catch (err) {
    console.error("Group-photo tag sync failed for registrant", registrant.id, err);
  }

  // Best-effort: a bug in a rule's condition tree shouldn't fail the registration itself.
  try {
    await evaluateOnRegistrationRules(registrant.id);
  } catch (err) {
    console.error("Rule evaluation failed for registrant", registrant.id, err);
  }

  return NextResponse.json({ ok: true, registrantId: registrant.id });
}
