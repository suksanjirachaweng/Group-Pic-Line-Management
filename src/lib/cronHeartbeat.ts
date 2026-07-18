import "server-only";
import { prisma } from "@/lib/prisma";

/** Every scheduled cron route registered with cron-job.org — see reference_infra memory for the
 * actual external schedule config. sync-sheets is deliberately excluded: it's manual-trigger-only
 * (its own SheetExportConfig.lastSyncStatus already tracks per-university status). */
export const CRON_JOBS: { key: string; label: string; expectedIntervalMinutes: number }[] = [
  { key: "process-message-jobs", label: "ส่งข้อความ LINE (queue)", expectedIntervalMinutes: 1 },
  { key: "process-group-photo-auto-tag-jobs", label: "แท็กรูปหมู่อัตโนมัติ (mobile express upload)", expectedIntervalMinutes: 1 },
  { key: "process-photo-event-archive-jobs", label: "สำรองข้อมูล / คลังใบหน้าอาจารย์", expectedIntervalMinutes: 1 },
  { key: "evaluate-scheduled-rules", label: "ประเมิน Rule ตามเวลา", expectedIntervalMinutes: 15 },
  { key: "refresh-channel-tokens", label: "ต่ออายุ token ช่องทาง LINE", expectedIntervalMinutes: 24 * 60 },
];

/** A job is considered overdue once it's gone this many multiples of its own expected cadence
 * without a heartbeat — generous enough to not false-positive on a single slow/delayed tick, but
 * tight enough to catch a cron-job.org silent-disable (the real incident this exists for) well
 * before it's been broken for days. */
const OVERDUE_MULTIPLIER = 5;

export async function recordCronHeartbeat(jobKey: string, status: "OK" | "ERROR", errorMessage?: string) {
  await prisma.cronHeartbeat.upsert({
    where: { jobKey },
    create: { jobKey, lastRunAt: new Date(), lastStatus: status, lastError: errorMessage ?? null },
    update: { lastRunAt: new Date(), lastStatus: status, lastError: errorMessage ?? null },
  });
}

export type CronJobHealth = {
  key: string;
  label: string;
  expectedIntervalMinutes: number;
  lastRunAt: Date | null;
  lastStatus: "OK" | "ERROR" | null;
  lastError: string | null;
  isOverdue: boolean;
  neverRan: boolean;
};

export async function getCronJobsHealth(): Promise<CronJobHealth[]> {
  const heartbeats = await prisma.cronHeartbeat.findMany({
    where: { jobKey: { in: CRON_JOBS.map((j) => j.key) } },
  });
  const byKey = new Map(heartbeats.map((h) => [h.jobKey, h]));
  const now = Date.now();

  return CRON_JOBS.map((job) => {
    const hb = byKey.get(job.key);
    if (!hb) {
      return {
        ...job,
        lastRunAt: null,
        lastStatus: null,
        lastError: null,
        isOverdue: true,
        neverRan: true,
      };
    }
    const minutesSince = (now - hb.lastRunAt.getTime()) / 60_000;
    return {
      ...job,
      lastRunAt: hb.lastRunAt,
      lastStatus: hb.lastStatus,
      lastError: hb.lastError,
      isOverdue: minutesSince > job.expectedIntervalMinutes * OVERDUE_MULTIPLIER,
      neverRan: false,
    };
  });
}
