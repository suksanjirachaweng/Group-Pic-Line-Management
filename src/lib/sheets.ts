import "server-only";
import { google } from "googleapis";
import { prisma } from "@/lib/prisma";

const SHEET_RANGE = "Sheet1";

function getSheetsClient() {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
  }
  const credentials = JSON.parse(json);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

/**
 * One-way DB -> Sheet mirror for a single university: clears the sheet then writes the
 * full registrant table in a single batched call (keeps well under Sheets API's
 * per-minute quota regardless of row count). Edits made directly in the Sheet are
 * overwritten on the next sync — the DB is the source of truth.
 */
export async function syncUniversityToSheet(universityId: string): Promise<void> {
  const config = await prisma.sheetExportConfig.findUnique({ where: { universityId } });
  if (!config) return;

  const university = await prisma.university.findUnique({
    where: { id: universityId },
    include: { formFields: { orderBy: { sortOrder: "asc" } } },
  });
  if (!university) return;

  const registrants = await prisma.registrant.findMany({
    where: { universityId },
    orderBy: { registeredAt: "asc" },
    include: { channel: { select: { name: true } } },
  });

  const headers = [
    "Display Name",
    "LINE User ID",
    "Channel",
    "Friend",
    "Status",
    "Registered At",
    ...university.formFields.map((f) => f.label),
  ];

  const rows = registrants.map((r) => {
    const data = r.data as Record<string, unknown>;
    return [
      r.displayName ?? "",
      r.lineUserId ?? "",
      r.channel?.name ?? "",
      r.isFriend ? "Yes" : "No",
      r.status,
      r.registeredAt.toISOString(),
      ...university.formFields.map((f) => String(data[f.key] ?? "")),
    ];
  });

  const sheets = getSheetsClient();

  await sheets.spreadsheets.values.clear({ spreadsheetId: config.googleSheetId, range: SHEET_RANGE });
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.googleSheetId,
    range: `${SHEET_RANGE}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [headers, ...rows] },
  });
}

/** Syncs every university that has a SheetExportConfig, isolating failures per-university. */
export async function syncAllUniversitySheets(): Promise<{ synced: number; failed: number }> {
  const configs = await prisma.sheetExportConfig.findMany();
  let synced = 0;
  let failed = 0;

  for (const config of configs) {
    try {
      await syncUniversityToSheet(config.universityId);
      await prisma.sheetExportConfig.update({
        where: { universityId: config.universityId },
        data: { lastSyncedAt: new Date(), lastSyncStatus: "SUCCESS", lastSyncError: null },
      });
      synced++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.sheetExportConfig.update({
        where: { universityId: config.universityId },
        data: { lastSyncedAt: new Date(), lastSyncStatus: "FAILED", lastSyncError: message },
      });
      failed++;
    }
  }

  return { synced, failed };
}
