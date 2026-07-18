import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, canAccessUniversity } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CardGeneratorForm } from "./CardGeneratorForm";

export default async function CardGeneratorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: universityId } = await params;

  const session = await getServerSession(authOptions);
  if (!canAccessUniversity(session!.user, universityId)) notFound();

  const university = await prisma.university.findUnique({ where: { id: universityId } });
  if (!university) notFound();

  return (
    <div className="max-w-xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">{university.name} — แผ่นป้ายเบอร์</h1>
      </div>
      <p className="mb-4 text-sm text-gray-500">
        สร้างไฟล์ PDF แผ่นป้ายเบอร์ถ่ายภาพหมู่ ขนาด 6x4 นิ้ว หน้าละ 1 ใบ — เลือกช่วงเบอร์แล้วกด
        &quot;สร้าง PDF&quot; เพื่อดาวน์โหลด
      </p>
      <CardGeneratorForm universityId={universityId} />
    </div>
  );
}
