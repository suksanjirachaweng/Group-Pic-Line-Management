import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { AdminRole } from "@/generated/prisma/enums";
import { listFacultyFaceProfiles } from "@/lib/actions/facultyFaceBank";
import { FacultyFaceBankBrowser } from "./FacultyFaceBankBrowser";

export default async function FacultyFaceBankPage() {
  const session = await getServerSession(authOptions);
  if (session!.user.role !== AdminRole.SUPERADMIN) {
    redirect("/admin/universities");
  }

  const profiles = await listFacultyFaceProfiles();

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-lg font-semibold text-gray-900">คลังใบหน้าอาจารย์</h1>
      <p className="mb-6 text-sm text-gray-500">
        รายชื่ออาจารย์ที่ระบบเก็บใบหน้าไว้เปรียบเทียบ (ใช้ข้ามมหาวิทยาลัย/ปี ทั้งหมด{" "}
        {profiles.length.toLocaleString()} คน) — ค้นหาจากชื่อ คณะที่ถ่ายรูป หรืออัปโหลดรูปใบหน้าเพื่อค้นหาได้
      </p>

      <FacultyFaceBankBrowser profiles={profiles} />
    </div>
  );
}
