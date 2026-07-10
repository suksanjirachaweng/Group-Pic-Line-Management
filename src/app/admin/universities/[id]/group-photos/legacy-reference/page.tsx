import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, canAccessUniversity } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getServiceAccountEmail } from "@/lib/sheets";
import { normalizeCode } from "@/lib/groupPhoto/normalizeCode";
import { LegacyReferenceUploadForm } from "./LegacyReferenceUploadForm";

const PAGE_SIZE = 50;

type CombinedRow = {
  key: string;
  name: string;
  code: string;
  phone: string;
  source: "อ้างอิงเก่า (Excel/Sheet)" | "ลงทะเบียน LINE";
};

export default async function LegacyReferencePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { id: universityId } = await params;
  const { q, page: pageParam } = await searchParams;

  const session = await getServerSession(authOptions);
  const user = session!.user;
  if (!canAccessUniversity(user, universityId)) notFound();

  const university = await prisma.university.findUnique({
    where: { id: universityId },
    include: { formFields: true },
  });
  if (!university) notFound();

  const phoneFieldKey = university.formFields.find((f) => f.fieldType === "PHONE")?.key;

  const [legacyRows, registrantRows] = await Promise.all([
    prisma.groupPhotoLegacyReference.findMany({ where: { universityId }, orderBy: { createdAt: "asc" } }),
    prisma.registrant.findMany({
      where: { universityId },
      select: { id: true, displayName: true, data: true },
      orderBy: { registeredAt: "asc" },
    }),
  ]);

  const combined: CombinedRow[] = [
    ...legacyRows.map((r) => ({
      key: `legacy-${r.id}`,
      name: r.name,
      code: r.code,
      phone: r.phone ?? "—",
      source: "อ้างอิงเก่า (Excel/Sheet)" as const,
    })),
    ...registrantRows.map((r) => {
      const data = (r.data ?? {}) as Record<string, unknown>;
      const rawCode = data.group_photo_index;
      const phoneValue = phoneFieldKey ? data[phoneFieldKey] : undefined;
      return {
        key: `registrant-${r.id}`,
        name: r.displayName ?? "(ไม่มีชื่อ)",
        code: typeof rawCode === "string" && rawCode.trim() ? rawCode : "—",
        phone: typeof phoneValue === "string" && phoneValue.trim() ? phoneValue : "—",
        source: "ลงทะเบียน LINE" as const,
      };
    }),
  ];

  const normalizedQ = q?.trim().toLowerCase() ?? "";
  const normalizedQCode = normalizeCode(q ?? "");
  const filtered = normalizedQ
    ? combined.filter(
        (r) =>
          r.name.toLowerCase().includes(normalizedQ) ||
          r.code.toLowerCase().includes(normalizedQ) ||
          (normalizedQCode && normalizeCode(r.code).includes(normalizedQCode)),
      )
    : combined;

  const page = Math.max(1, Number(pageParam) || 1);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function pageHref(nextPage: number) {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    sp.set("page", String(nextPage));
    return `?${sp.toString()}`;
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <Link href={`/admin/universities/${universityId}/group-photos`} className="text-sm text-gray-500 hover:text-gray-700">
        ← กลับ
      </Link>
      <h1 className="mb-1 mt-2 text-lg font-semibold text-gray-900">{university.name} — รายชื่ออ้างอิงเก่า (Google Form)</h1>
      <p className="mb-4 text-xs text-gray-500">
        ใช้สำหรับค้นหาชื่อจาก CODE ตอนแท็กรูป สำหรับมหาวิทยาลัยที่ไม่มีข้อมูลลงทะเบียนผ่าน LINE — ไม่เกี่ยวข้องกับระบบส่งข้อความ
        ไฟล์ที่อัปโหลดใหม่จะแทนที่ข้อมูลเดิมทั้งหมด
      </p>

      <LegacyReferenceUploadForm universityId={universityId} serviceAccountEmail={getServiceAccountEmail()} />

      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">
          รายชื่อทั้งหมด (รวมทุกแหล่งข้อมูล)
          <span className="ml-2 text-xs font-normal text-gray-400">{filtered.length} รายการ</span>
        </h2>
        <form method="get" className="flex gap-2">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="ค้นหาชื่อหรือ CODE"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
          <button type="submit" className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
            ค้นหา
          </button>
        </form>
      </div>

      <div className="mt-2 overflow-x-auto rounded-md border border-gray-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="whitespace-nowrap px-3 py-2">ชื่อ</th>
              <th className="whitespace-nowrap px-3 py-2">CODE</th>
              <th className="whitespace-nowrap px-3 py-2">เบอร์โทร</th>
              <th className="whitespace-nowrap px-3 py-2">แหล่งข้อมูล</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {pageRows.map((r) => (
              <tr key={r.key}>
                <td className="px-3 py-1.5">{r.name}</td>
                <td className="px-3 py-1.5 font-mono">{r.code}</td>
                <td className="px-3 py-1.5">{r.phone}</td>
                <td className="px-3 py-1.5">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      r.source === "ลงทะเบียน LINE" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {r.source}
                  </span>
                </td>
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-3 text-gray-400">
                  ไม่พบข้อมูลที่ตรงกับการค้นหา
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center gap-3 text-sm">
          <Link
            href={pageHref(Math.max(1, page - 1))}
            className={page <= 1 ? "pointer-events-none text-gray-300" : "text-gray-600 hover:underline"}
          >
            ก่อนหน้า
          </Link>
          <span className="text-gray-500">
            หน้า {page} จาก {totalPages}
          </span>
          <Link
            href={pageHref(Math.min(totalPages, page + 1))}
            className={page >= totalPages ? "pointer-events-none text-gray-300" : "text-gray-600 hover:underline"}
          >
            ถัดไป
          </Link>
        </div>
      )}
    </div>
  );
}
