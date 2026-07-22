"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const STAGE_LABEL: Record<string, string> = {
  EXPORTING_DATA: "กำลังบันทึกข้อมูล",
  COPYING_IMAGES: "กำลังคัดลอกรูปภาพ",
  EMBEDDING_FACES: "กำลังสำรองข้อมูลใบหน้าอาจารย์",
  DONE: "เสร็จสิ้น",
  FAILED: "ล้มเหลว",
};

// Past this many minutes still sitting on a live stage, this is almost certainly the same
// cron-job.org silent-disable pattern that's already bitten this feature once (the processing
// cron gets auto-disabled after failures and just never runs again) rather than genuinely slow
// work — worth pointing the admin at /admin/system-status instead of leaving them guessing.
const STALL_WARNING_MINUTES = 3;

type Job = {
  stage: string;
  imagesDone: number;
  imagesTotal: number;
  facesDone: number;
  facesTotal: number;
  errorMessage: string | null;
  createdAt: string;
};

/**
 * Replaces the old static text-only status line with an actual progress bar, live-polled (via
 * router.refresh(), which just re-runs this server-rendered page's data fetch) so an admin
 * watching this page doesn't have to keep clicking "รีเฟรชสถานะ" by hand — and a stall warning
 * once a stage has clearly run long past normal, since the underlying cron has silently died
 * before with zero visible symptom other than "this page never moves."
 */
export function ArchiveJobProgress({ job, universityId, photoEventId }: {
  job: Job;
  universityId: string;
  photoEventId: string;
}) {
  const router = useRouter();
  const inProgress = job.stage === "EXPORTING_DATA" || job.stage === "COPYING_IMAGES" || job.stage === "EMBEDDING_FACES";
  const [elapsedMs, setElapsedMs] = useState(() => Date.now() - new Date(job.createdAt).getTime());

  useEffect(() => {
    if (!inProgress) return;
    const tick = () => setElapsedMs(Date.now() - new Date(job.createdAt).getTime());
    tick();
    const interval = setInterval(() => {
      tick();
      router.refresh();
    }, 5000);
    return () => clearInterval(interval);
  }, [inProgress, job.createdAt, router]);

  const elapsedMinutes = Math.floor(elapsedMs / 60000);
  const stalled = inProgress && elapsedMinutes >= STALL_WARNING_MINUTES;

  let percent: number | null = null;
  let countLabel = "";
  if (job.stage === "COPYING_IMAGES" && job.imagesTotal > 0) {
    percent = (job.imagesDone / job.imagesTotal) * 100;
    countLabel = `${job.imagesDone}/${job.imagesTotal} รูป`;
  } else if (job.stage === "EMBEDDING_FACES" && job.facesTotal > 0) {
    percent = (job.facesDone / job.facesTotal) * 100;
    countLabel = `${job.facesDone}/${job.facesTotal} คน`;
  } else if (job.stage === "DONE") {
    percent = 100;
  }

  const barColor = job.stage === "FAILED" ? "bg-red-500" : job.stage === "DONE" ? "bg-green-500" : "bg-indigo-500";

  return (
    <div className="mb-3 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
      <div className="flex items-center justify-between gap-2">
        <span>
          สถานะล่าสุด: <span className="font-medium">{STAGE_LABEL[job.stage]}</span>
          {countLabel && <span> ({countLabel})</span>}
          {job.stage === "FAILED" && job.errorMessage && <span className="ml-1 text-red-600">— {job.errorMessage}</span>}
        </span>
        {inProgress && (
          <span className="whitespace-nowrap text-gray-400">
            ผ่านไป {elapsedMinutes < 1 ? "ไม่ถึง 1 นาที" : `${elapsedMinutes} นาที`}
          </span>
        )}
      </div>

      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
        {percent !== null ? (
          <div
            className={`h-full rounded-full ${barColor} transition-[width] duration-500`}
            style={{ width: `${Math.max(4, Math.min(100, percent))}%` }}
          />
        ) : job.stage === "FAILED" ? (
          <div className={`h-full w-full rounded-full ${barColor}`} />
        ) : (
          // EXPORTING_DATA has no natural done/total count — an indeterminate pulse still tells
          // the admin something is actively expected to happen, rather than a bar frozen at 0%.
          <div className={`h-full w-full animate-pulse rounded-full ${barColor} opacity-60`} />
        )}
      </div>

      {stalled && (
        <p className="mt-1.5 text-amber-700">
          ค้างอยู่ที่ขั้นตอนนี้นานผิดปกติ — เคยเกิดจาก cron ประมวลผลถูกปิดเองมาก่อน ลองเช็คที่{" "}
          <Link href="/admin/system-status" className="text-indigo-600 hover:underline">
            สถานะระบบ
          </Link>
        </p>
      )}

      {inProgress && (
        <Link
          href={`/admin/universities/${universityId}/events/${photoEventId}`}
          className="mt-1 inline-block text-indigo-600 hover:underline"
        >
          รีเฟรชสถานะ
        </Link>
      )}
    </div>
  );
}
