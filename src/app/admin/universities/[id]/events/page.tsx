import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, canAccessUniversity } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listPhotoEvents } from "@/lib/actions/photoEvents";
import { PhotoEventStatus } from "@/generated/prisma/enums";
import { CreatePhotoEventForm } from "./CreatePhotoEventForm";

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

export default async function PhotoEventsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: universityId } = await params;

  const session = await getServerSession(authOptions);
  const user = session!.user;
  if (!canAccessUniversity(user, universityId)) notFound();

  const university = await prisma.university.findUnique({ where: { id: universityId } });
  if (!university) notFound();

  const events = await listPhotoEvents(universityId);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">{university.name} — งานถ่ายรูป (Events)</h1>
      </div>

      <p className="mb-4 text-sm text-gray-500">
        แต่ละงานคือรอบการถ่ายรูปหมู่ 1 ครั้ง (เช่น ปีการศึกษา) — ใช้แยกข้อมูลเมื่อมหาวิทยาลัยเดียวกันจัดถ่ายรูปมากกว่า 1 รอบ
        ที่วันที่หรือช่วงเลข CODE อาจซ้ำกัน
      </p>

      <div className="mb-6">
        <CreatePhotoEventForm universityId={universityId} />
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2">รหัสงาน</th>
              <th className="px-4 py-2">คำอธิบาย</th>
              <th className="px-4 py-2">ช่วงวันที่</th>
              <th className="px-4 py-2">สถานะ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {events.map((e) => (
              <tr key={e.id}>
                <td className="px-4 py-2">
                  <Link
                    href={`/admin/universities/${universityId}/events/${e.id}`}
                    className="font-medium text-indigo-600 hover:underline"
                  >
                    {e.code}
                  </Link>
                </td>
                <td className="px-4 py-2 text-gray-600">{e.label ?? "—"}</td>
                <td className="px-4 py-2 text-gray-600">
                  {new Date(e.startDate).toLocaleDateString("th-TH")} – {new Date(e.endDate).toLocaleDateString("th-TH")}
                </td>
                <td className="px-4 py-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_CLASS[e.status]}`}>
                    {STATUS_LABEL[e.status]}
                  </span>
                </td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-3 text-gray-400">
                  ยังไม่มีงานที่สร้างไว้
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
