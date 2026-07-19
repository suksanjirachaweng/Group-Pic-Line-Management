import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AdminRole } from "@/generated/prisma/enums";
import { currentYearMonth } from "@/lib/quota";
import { getCronJobsHealth } from "@/lib/cronHeartbeat";

// If a message job has sat QUEUED this long, either the cron isn't running (see the cron health
// section above it on this page) or something is jammed — either way it's worth a look.
const STUCK_QUEUE_THRESHOLD_MINUTES = 10;
const FAILED_MESSAGES_WINDOW_HOURS = 24;
const QUOTA_WARNING_PCT = 90;

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

function timeAgoThai(date: Date): string {
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "เมื่อสักครู่";
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`;
  const days = Math.floor(hours / 24);
  return `${days} วันที่แล้ว`;
}

export default async function SystemStatusPage() {
  const session = await getServerSession(authOptions);
  if (session!.user.role !== AdminRole.SUPERADMIN) {
    redirect("/admin/universities");
  }

  const stuckQueueThreshold = minutesAgo(STUCK_QUEUE_THRESHOLD_MINUTES);
  const failedMessagesSince = minutesAgo(FAILED_MESSAGES_WINDOW_HOURS * 60);
  const yearMonth = currentYearMonth();

  const [
    cronJobs,
    stuckQueuedCount,
    recentFailedMessageCount,
    failedArchiveJobs,
    failedAutoTagJobs,
    channels,
  ] = await Promise.all([
    getCronJobsHealth(),
    prisma.messageJob.count({ where: { status: "QUEUED", createdAt: { lt: stuckQueueThreshold } } }),
    prisma.messageJob.count({ where: { status: "FAILED", processedAt: { gte: failedMessagesSince } } }),
    prisma.photoEventArchiveJob.findMany({
      where: { stage: "FAILED" },
      include: { photoEvent: { include: { university: true } } },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.groupPhotoAutoTagJob.findMany({
      where: { stage: "FAILED" },
      include: { groupPhoto: { include: { university: true, photoEvent: true } } },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.channel.findMany({
      where: { isActive: true },
      include: { usageCounters: { where: { yearMonth } } },
    }),
  ]);

  const quotaWarningChannels = channels
    .map((c) => {
      const used = c.usageCounters[0]?.messagesSent ?? 0;
      const pct = c.monthlyFreeQuota > 0 ? Math.round((used / c.monthlyFreeQuota) * 100) : 0;
      return { channel: c, used, pct };
    })
    .filter((c) => c.pct >= QUOTA_WARNING_PCT)
    .sort((a, b) => b.pct - a.pct);

  const cronProblems = cronJobs.filter((j) => j.isOverdue || j.lastStatus === "ERROR");
  const hasAnyProblem =
    cronProblems.length > 0 ||
    stuckQueuedCount > 0 ||
    recentFailedMessageCount > 0 ||
    failedArchiveJobs.length > 0 ||
    failedAutoTagJobs.length > 0 ||
    quotaWarningChannels.length > 0;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-1 text-xl font-semibold text-gray-900">สถานะระบบ</h1>
      <p className="mb-6 text-sm text-gray-500">
        ภาพรวมสุขภาพของ cron job และงานเบื้องหลังทั้งหมด — สำหรับตรวจสอบว่ามีปัญหาแบบเงียบๆ ค้างอยู่หรือไม่
        (เช่นเหตุการณ์ cron-job.org ปิดงานเองที่เจอเมื่อวันที่ 18-19 ก.ค.)
      </p>

      {!hasAnyProblem && (
        <div className="mb-6 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          ✓ ไม่พบปัญหา — cron job ทุกตัวทำงานปกติ ไม่มีงานค้าง ไม่มี channel ใกล้เต็มโควต้า
        </div>
      )}

      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Cron Jobs</h2>
        {/* Card list instead of a <table> — a 4-column table has no good mobile answer (squeezed
            columns or a horizontal scroll with no visible scrollbar on iOS Safari, both of which
            read as broken); stacking each job's fields works cleanly at every width instead. */}
        <ul className="space-y-2">
          {cronJobs.map((job) => {
            const badge = job.neverRan
              ? { text: "ไม่เคยรัน", cls: "bg-gray-100 text-gray-500" }
              : job.isOverdue
                ? { text: "ค้าง / ไม่รันตามกำหนด", cls: "bg-red-100 text-red-700" }
                : job.lastStatus === "ERROR"
                  ? { text: "เกิดข้อผิดพลาด", cls: "bg-amber-100 text-amber-700" }
                  : { text: "ปกติ", cls: "bg-green-100 text-green-700" };
            return (
              <li key={job.key} className="rounded-md border border-gray-100 bg-gray-50/50 p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-gray-900">{job.label}</div>
                    <div className="text-xs text-gray-400">
                      {job.key} · ทุก {job.expectedIntervalMinutes >= 60 ? `${job.expectedIntervalMinutes / 60} ชม.` : `${job.expectedIntervalMinutes} นาที`}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${badge.cls}`}>{badge.text}</span>
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  รันล่าสุด: {job.lastRunAt ? timeAgoThai(job.lastRunAt) : "—"}
                </div>
                {job.lastError && <div className="mt-1 text-xs text-red-600">{job.lastError}</div>}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">คิวส่งข้อความ LINE</h2>
        <ul className="space-y-1 text-sm">
          <li className="flex items-center justify-between">
            <span className="text-gray-600">
              ข้อความค้างในคิวเกิน {STUCK_QUEUE_THRESHOLD_MINUTES} นาที (ยังไม่ถูกส่ง)
            </span>
            <span className={stuckQueuedCount > 0 ? "font-medium text-red-600" : "text-gray-400"}>
              {stuckQueuedCount} ข้อความ
            </span>
          </li>
          <li className="flex items-center justify-between">
            <span className="text-gray-600">ส่งไม่สำเร็จใน {FAILED_MESSAGES_WINDOW_HOURS} ชม. ที่ผ่านมา</span>
            <span className={recentFailedMessageCount > 0 ? "font-medium text-amber-600" : "text-gray-400"}>
              {recentFailedMessageCount} ข้อความ
            </span>
          </li>
        </ul>
      </section>

      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">งานเบื้องหลังที่ล้มเหลว</h2>
        {failedArchiveJobs.length === 0 && failedAutoTagJobs.length === 0 ? (
          <p className="text-sm text-gray-400">ไม่มีงานที่ล้มเหลว</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {failedArchiveJobs.map((job) => (
              <li key={job.id} className="flex items-start justify-between gap-3">
                <span className="text-gray-700">
                  {job.facesOnly ? "ดึงเข้าคลังใบหน้า" : "สำรองข้อมูล"}: {job.photoEvent.university.name} —{" "}
                  {job.photoEvent.code}
                  {job.errorMessage && <div className="text-xs text-red-600">{job.errorMessage}</div>}
                </span>
                <Link
                  href={`/admin/universities/${job.photoEvent.universityId}/events/${job.photoEventId}`}
                  className="shrink-0 text-xs text-indigo-600 hover:underline"
                >
                  ไปดู
                </Link>
              </li>
            ))}
            {failedAutoTagJobs.map((job) => (
              <li key={job.id} className="flex items-start justify-between gap-3">
                <span className="text-gray-700">
                  แท็กอัตโนมัติ: {job.groupPhoto.university.name} — {job.groupPhoto.name}
                  {job.errorMessage && <div className="text-xs text-red-600">{job.errorMessage}</div>}
                </span>
                <Link
                  href={`/admin/universities/${job.groupPhoto.universityId}/group-photos/${job.groupPhotoId}`}
                  className="shrink-0 text-xs text-indigo-600 hover:underline"
                >
                  ไปดู
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">โควต้า LINE Channel</h2>
        {quotaWarningChannels.length === 0 ? (
          <p className="text-sm text-gray-400">ไม่มี channel ที่ใกล้เต็มโควต้าเดือนนี้ (≥{QUOTA_WARNING_PCT}%)</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {quotaWarningChannels.map(({ channel, used, pct }) => (
              <li key={channel.id} className="flex items-center justify-between gap-3">
                <Link href={`/admin/channels/${channel.id}`} className="text-gray-700 hover:underline">
                  {channel.name}
                </Link>
                <span className={pct >= 100 ? "font-medium text-red-600" : "font-medium text-amber-600"}>
                  {used} / {channel.monthlyFreeQuota} ({pct}%)
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
