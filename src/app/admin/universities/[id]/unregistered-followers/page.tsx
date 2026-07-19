import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, canAccessUniversity } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUnregisteredFollowers } from "@/lib/actions/lineFollowers";

export default async function UnregisteredFollowersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: universityId } = await params;

  const session = await getServerSession(authOptions);
  const user = session!.user;
  if (!canAccessUniversity(user, universityId)) notFound();

  const university = await prisma.university.findUnique({ where: { id: universityId } });
  if (!university) notFound();

  const followers = await getUnregisteredFollowers(universityId);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex flex-wrap items-center gap-3 text-lg font-semibold text-gray-900">
          <Link
            href={`/admin/universities/${universityId}/registrants`}
            className="text-sm font-normal text-gray-500 hover:text-gray-700"
          >
            ← กลับ
          </Link>
          {university.name} — เพิ่มเพื่อน LINE แต่ยังไม่ลงทะเบียน
          <span className="ml-2 text-sm font-normal text-gray-400">{followers.length} คน</span>
        </h1>
      </div>

      <p className="mb-4 text-sm text-gray-500">
        รายชื่อคนที่เพิ่มเพื่อน LINE ของมหาวิทยาลัยนี้แล้ว แต่ยังไม่ได้กรอกแบบฟอร์มลงทะเบียน — เผื่อต้องการส่งข้อความเชิญชวนหรือติดตามเพิ่มเติม
      </p>

      <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="whitespace-nowrap px-4 py-2"></th>
              <th className="whitespace-nowrap px-4 py-2">ชื่อ LINE</th>
              <th className="whitespace-nowrap px-4 py-2">LINE Channel</th>
              <th className="whitespace-nowrap px-4 py-2">เพิ่มเพื่อนเมื่อ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {followers.map((f) => (
              <tr key={f.id} className="hover:bg-gray-50">
                <td className="whitespace-nowrap px-4 py-2">
                  {f.pictureUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f.pictureUrl} alt="" className="h-8 w-8 rounded-full" />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-gray-200" />
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-gray-900">{f.displayName ?? "(ไม่มีชื่อ)"}</td>
                <td className="whitespace-nowrap px-4 py-2 text-gray-500">{f.channelName}</td>
                <td className="whitespace-nowrap px-4 py-2 text-gray-500">
                  {new Date(f.followedAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}
                </td>
              </tr>
            ))}
            {followers.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-3 text-gray-400">
                  ไม่พบคนที่เพิ่มเพื่อนแต่ยังไม่ลงทะเบียน
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
