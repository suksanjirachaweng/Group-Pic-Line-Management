import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, canAccessUniversity } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getServiceAccountEmail } from "@/lib/sheets";
import { LegacyReferenceUploadForm } from "./LegacyReferenceUploadForm";

export default async function LegacyReferencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: universityId } = await params;

  const session = await getServerSession(authOptions);
  const user = session!.user;
  if (!canAccessUniversity(user, universityId)) notFound();

  const university = await prisma.university.findUnique({ where: { id: universityId } });
  if (!university) notFound();

  const [count, sample] = await Promise.all([
    prisma.groupPhotoLegacyReference.count({ where: { universityId } }),
    prisma.groupPhotoLegacyReference.findMany({ where: { universityId }, take: 10, orderBy: { createdAt: "asc" } }),
  ]);

  return (
    <div className="mx-auto max-w-2xl p-6">
      <Link href={`/admin/universities/${universityId}/group-photos`} className="text-sm text-gray-500 hover:text-gray-700">
        ← กลับ
      </Link>
      <h1 className="mb-1 mt-2 text-lg font-semibold text-gray-900">{university.name} — รายชื่ออ้างอิงเก่า (Google Form)</h1>
      <p className="mb-4 text-xs text-gray-500">
        ใช้สำหรับค้นหาชื่อจาก CODE ตอนแท็กรูป สำหรับมหาวิทยาลัยที่ไม่มีข้อมูลลงทะเบียนผ่าน LINE — ไม่เกี่ยวข้องกับระบบส่งข้อความ
        ไฟล์ที่อัปโหลดใหม่จะแทนที่ข้อมูลเดิมทั้งหมด
      </p>

      <LegacyReferenceUploadForm universityId={universityId} serviceAccountEmail={getServiceAccountEmail()} />

      <p className="mt-4 text-sm text-gray-600">มีข้อมูลอยู่ {count} รายการ</p>
      {sample.length > 0 && (
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="py-1">ชื่อ</th>
              <th className="py-1">CODE</th>
              <th className="py-1">เบอร์โทร</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sample.map((r) => (
              <tr key={r.id}>
                <td className="py-1">{r.name}</td>
                <td className="py-1 font-mono">{r.code}</td>
                <td className="py-1">{r.phone ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
