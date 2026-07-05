"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUniversityAccess } from "@/lib/authz";
import { RegistrantStatus } from "@/generated/prisma/enums";

export async function updateRegistrantStatus(
  universityId: string,
  registrantId: string,
  formData: FormData,
) {
  await requireUniversityAccess(universityId);

  const status = z.nativeEnum(RegistrantStatus).parse(formData.get("status"));

  await prisma.registrant.update({
    where: { id: registrantId, universityId },
    data: { status },
  });

  revalidatePath(`/admin/universities/${universityId}/registrants/${registrantId}`);
  revalidatePath(`/admin/universities/${universityId}/registrants`);
}

export async function sendManualMessage(
  universityId: string,
  registrantId: string,
  formData: FormData,
) {
  await requireUniversityAccess(universityId);

  const body = z.string().min(1).max(2000).parse(formData.get("body"));

  const registrant = await prisma.registrant.findUnique({
    where: { id: registrantId, universityId },
  });
  if (!registrant) throw new Error("Registrant not found");
  if (!registrant.channelId) {
    throw new Error("This registrant has no LINE channel bound yet — they haven't completed registration");
  }

  await prisma.messageJob.create({
    data: {
      registrantId,
      channelId: registrant.channelId,
      source: "MANUAL",
      body,
    },
  });

  revalidatePath(`/admin/universities/${universityId}/registrants/${registrantId}`);
}
