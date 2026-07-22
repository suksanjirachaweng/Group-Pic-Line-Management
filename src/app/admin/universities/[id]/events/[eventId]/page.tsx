import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, canAccessUniversity } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AdminRole, PhotoEventStatus } from "@/generated/prisma/enums";
import { StartArchiveButton } from "./StartArchiveButton";
import { DeleteEventDataButton } from "./DeleteEventDataButton";
import { ReimportArchiveButton } from "./ReimportArchiveButton";
import { BuildFaceBankButton } from "./BuildFaceBankButton";
import { EditPhotoEventForm } from "./EditPhotoEventForm";
import { ToggleLiffVisibilityButton } from "../ToggleLiffVisibilityButton";
import { ArchiveJobProgress } from "./ArchiveJobProgress";

const STATUS_LABEL: Record<PhotoEventStatus, string> = {
  ACTIVE: "กำลังดำเนินการ",
  ARCHIVE_READY: "สำรองข้อมูลแล้ว รอลบ",
  ARCHIVED: "ปิดงานแล้ว (ลบข้อมูลแล้ว)",
};

const STATUS_CLASS: Record<PhotoEventStatus, string> = {
  ACTIVE: "bg-green-100 text-green-700",
  ARCHIVE_READY: "bg-amber-100 text-amber-700",
  ARCHIVED: "bg-gray-100 text-gray-500",
};

export default async function PhotoEventDetailPage({
  params,
}: {
  params: Promise<{ id: string; eventId: string }>;
}) {
  const { id: universityId, eventId } = await params;

  const session = await getServerSession(authOptions);
  const user = session!.user;
  if (!canAccessUniversity(user, universityId)) notFound();

  const event = await prisma.photoEvent.findUnique({ where: { id: eventId, universityId } });
  if (!event) notFound();

  const [registrantCount, groupPhotoCount, legacyReferenceCount, latestJob, latestFaceBankJob] = await Promise.all([
    prisma.registrant.count({ where: { photoEventId: eventId } }),
    prisma.groupPhoto.count({ where: { photoEventId: eventId } }),
    prisma.groupPhotoLegacyReference.count({ where: { photoEventId: eventId } }),
    prisma.photoEventArchiveJob.findFirst({ where: { photoEventId: eventId, facesOnly: false }, orderBy: { createdAt: "desc" } }),
    prisma.photoEventArchiveJob.findFirst({ where: { photoEventId: eventId, facesOnly: true }, orderBy: { createdAt: "desc" } }),
  ]);

  const jobInProgress =
    latestJob &&
    (latestJob.stage === "EXPORTING_DATA" || latestJob.stage === "COPYING_IMAGES" || latestJob.stage === "EMBEDDING_FACES");

  const faceBankJobInProgress = latestFaceBankJob && latestFaceBankJob.stage === "EMBEDDING_FACES";

  return (
    <div className="mx-auto max-w-3xl p-6">
      <Link
        href={`/admin/universities/${universityId}/events`}
        className="text-sm text-gray-500 hover:text-gray-700 hover:underline"
      >
        ← กลับไปรายการงาน
      </Link>

      <div className="mt-2 mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-gray-900">
          {event.code}
          {event.label && <span className="ml-2 text-base font-normal text-gray-500">({event.label})</span>}
        </h1>
        <span className={`rounded px-2 py-1 text-xs ${STATUS_CLASS[event.status]}`}>{STATUS_LABEL[event.status]}</span>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <span className="text-xs text-gray-500">แสดงรายการลงทะเบียนของงานนี้ในหน้า LINE ของนักศึกษา:</span>
        <ToggleLiffVisibilityButton universityId={universityId} photoEventId={eventId} hiddenFromLiff={event.hiddenFromLiff} />
      </div>

      <div className="mb-4">
        <EditPhotoEventForm
          universityId={universityId}
          photoEventId={eventId}
          code={event.code}
          label={event.label}
          startDate={event.startDate.toISOString()}
          endDate={event.endDate.toISOString()}
          codeRangeMin={event.codeRangeMin}
          codeRangeMax={event.codeRangeMax}
        />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 rounded-lg border border-gray-200 bg-white p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-gray-400">ช่วงวันที่</dt>
          <dd className="mt-0.5 text-gray-900">
            {new Date(event.startDate).toLocaleDateString("th-TH")} – {new Date(event.endDate).toLocaleDateString("th-TH")}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-gray-400">ผู้ลงทะเบียน</dt>
          <dd className="mt-0.5 text-gray-900">{registrantCount.toLocaleString()} คน</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-400">รูปหมู่</dt>
          <dd className="mt-0.5 text-gray-900">{groupPhotoCount.toLocaleString()} รูป</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-400">ข้อมูลอ้างอิงเดิม</dt>
          <dd className="mt-0.5 text-gray-900">{legacyReferenceCount.toLocaleString()} รายการ</dd>
        </div>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">ปิดงาน / สำรองข้อมูล</h2>
        <p className="mb-3 text-xs text-gray-500">
          บันทึกข้อมูลผู้ลงทะเบียน รูปหมู่ และแท็กทั้งหมดของงานนี้ลงไฟล์สำรองที่กู้คืนได้ภายหลัง จากนั้นจึงลบข้อมูลออกจากฐานข้อมูลจริงเพื่อลดภาระของ server
        </p>

        {latestJob && (
          <ArchiveJobProgress
            job={{
              stage: latestJob.stage,
              registrantsDone: latestJob.registrantsDone,
              registrantsTotal: latestJob.registrantsTotal,
              imagesDone: latestJob.imagesDone,
              imagesTotal: latestJob.imagesTotal,
              facesDone: latestJob.facesDone,
              facesTotal: latestJob.facesTotal,
              errorMessage: latestJob.errorMessage,
              createdAt: latestJob.createdAt.toISOString(),
            }}
            universityId={universityId}
            photoEventId={eventId}
          />
        )}

        {event.archiveFileUrl && (
          <p className="mb-3 text-xs text-gray-500">
            ไฟล์ manifest:{" "}
            <a href={event.archiveFileUrl} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
              data.json
            </a>
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {event.status === "ACTIVE" && !jobInProgress && (
            <StartArchiveButton universityId={universityId} photoEventId={eventId} />
          )}
          {event.status === "ARCHIVE_READY" && (
            <DeleteEventDataButton universityId={universityId} photoEventId={eventId} eventCode={event.code} />
          )}
          {event.status === "ARCHIVED" && (
            <ReimportArchiveButton universityId={universityId} photoEventId={eventId} />
          )}
        </div>
      </section>

      <section className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">คลังใบหน้าอาจารย์</h2>
        <p className="mb-3 text-xs text-gray-500">
          ครอบตัดใบหน้าจากทุกแท็กแถวหน้า (แถว 0) ที่มีชื่อและไม่มีปัญหาค้างอยู่ ส่งไปคำนวณค่าเปรียบเทียบแล้วเก็บเข้าคลังใบหน้า
          ไว้ใช้กับปุ่ม &quot;ค้นหาจากใบหน้า&quot; ในหน้าแท็กรูป — ทำได้ทันทีโดยไม่ต้องปิดงาน/สำรองข้อมูลก่อน และไม่ลบหรือแก้ไขข้อมูลอื่นของ event นี้เลย
        </p>

        {latestFaceBankJob && (
          <ArchiveJobProgress
            job={{
              stage: latestFaceBankJob.stage,
              registrantsDone: latestFaceBankJob.registrantsDone,
              registrantsTotal: latestFaceBankJob.registrantsTotal,
              imagesDone: latestFaceBankJob.imagesDone,
              imagesTotal: latestFaceBankJob.imagesTotal,
              facesDone: latestFaceBankJob.facesDone,
              facesTotal: latestFaceBankJob.facesTotal,
              errorMessage: latestFaceBankJob.errorMessage,
              createdAt: latestFaceBankJob.createdAt.toISOString(),
            }}
            universityId={universityId}
            photoEventId={eventId}
          />
        )}

        <div className="flex flex-wrap items-center gap-2">
          {event.status !== "ARCHIVED" && !faceBankJobInProgress && (
            <BuildFaceBankButton universityId={universityId} photoEventId={eventId} />
          )}
          {user.role === AdminRole.SUPERADMIN && (
            <Link
              href="/admin/faculty-face-bank"
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              จัดการคลังใบหน้า (ดูทั้งหมด/ค้นหา)
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}
