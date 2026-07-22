import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, canAccessUniversity } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listArchivedPhotoEvents } from "@/lib/actions/photoEvents";

/**
 * Every ARCHIVED (closed-out + deleted) event for this university — kept off the main events page
 * and every EventFilterDropdown (see listPhotoEvents' doc comment) since there's nothing live left
 * to filter/select there. Each row links to its own event detail page, where "กู้คืนข้อมูล"
 * (ReimportArchiveButton) restores it back to ACTIVE — at which point it disappears from here and
 * reappears everywhere else automatically.
 */
export default async function ArchivedPhotoEventsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: universityId } = await params;

  const session = await getServerSession(authOptions);
  const user = session!.user;
  if (!canAccessUniversity(user, universityId)) notFound();

  const university = await prisma.university.findUnique({ where: { id: universityId } });
  if (!university) notFound();

  const events = await listArchivedPhotoEvents(universityId);

  return (
    <div className="mx-auto max-w-5xl p-6">
      <Link
        href={`/admin/universities/${universityId}/events`}
        className="text-sm text-gray-500 hover:text-gray-700 hover:underline"
      >
        ← กลับไปรายการงาน
      </Link>

      <h1 className="mt-2 mb-4 text-xl font-semibold text-gray-900">{university.name} — งานที่ปิดแล้ว</h1>

      <p className="mb-4 text-sm text-gray-500">
        งานเหล่านี้ปิดและลบข้อมูลออกจากระบบแล้ว — ไม่แสดงในรายการงานหลักหรือ dropdown เลือก event ใดๆ
        จนกว่าจะกดกู้คืนข้อมูล
      </p>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="whitespace-nowrap px-4 py-2">รหัสงาน</th>
                <th className="whitespace-nowrap px-4 py-2">คำอธิบาย</th>
                <th className="whitespace-nowrap px-4 py-2">ช่วงวันที่</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-4 py-2">
                    <Link
                      href={`/admin/universities/${universityId}/events/${e.id}`}
                      className="font-medium text-indigo-600 hover:underline"
                    >
                      {e.code}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-gray-600">{e.label ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-gray-600">
                    {new Date(e.startDate).toLocaleDateString("th-TH")} – {new Date(e.endDate).toLocaleDateString("th-TH")}
                  </td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-gray-400">
                    ไม่มีงานที่ปิดแล้ว
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
