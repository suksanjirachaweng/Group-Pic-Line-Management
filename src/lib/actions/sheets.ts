"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUniversityAccess } from "@/lib/authz";
import { syncUniversityToSheet } from "@/lib/sheets";

export async function setSheetExportConfig(universityId: string, formData: FormData) {
  await requireUniversityAccess(universityId);

  const googleSheetId = z.string().min(1).parse(formData.get("googleSheetId"));

  await prisma.sheetExportConfig.upsert({
    where: { universityId },
    update: { googleSheetId },
    create: { universityId, googleSheetId },
  });

  revalidatePath(`/admin/universities/${universityId}`);
}

export async function triggerSheetSync(universityId: string) {
  await requireUniversityAccess(universityId);

  try {
    await syncUniversityToSheet(universityId);
    await prisma.sheetExportConfig.update({
      where: { universityId },
      data: { lastSyncedAt: new Date(), lastSyncStatus: "SUCCESS", lastSyncError: null },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.sheetExportConfig.update({
      where: { universityId },
      data: { lastSyncedAt: new Date(), lastSyncStatus: "FAILED", lastSyncError: message },
    });
  }

  revalidatePath(`/admin/universities/${universityId}`);
}
