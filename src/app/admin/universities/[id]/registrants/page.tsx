import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, canAccessUniversity } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { RegistrantStatus } from "@/generated/prisma/enums";
import { buildRegistrantWhere } from "@/lib/registrantFilters";

const PAGE_SIZE = 50;

export default async function RegistrantsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; status?: string; q?: string; fieldKey?: string; fieldValue?: string }>;
}) {
  const { id: universityId } = await params;
  const { page: pageParam, status, q, fieldKey, fieldValue } = await searchParams;

  const session = await getServerSession(authOptions);
  const user = session!.user;
  if (!canAccessUniversity(user, universityId)) notFound();

  const university = await prisma.university.findUnique({
    where: { id: universityId },
    include: { formFields: { orderBy: { sortOrder: "asc" } } },
  });
  if (!university) notFound();

  const page = Math.max(1, Number(pageParam) || 1);

  const where = buildRegistrantWhere(universityId, { status, q, fieldKey, fieldValue });

  const [registrants, total] = await Promise.all([
    prisma.registrant.findMany({
      where,
      orderBy: { registeredAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { channel: { select: { name: true } } },
    }),
    prisma.registrant.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function pageHref(nextPage: number, overrides: Record<string, string | undefined> = {}) {
    const sp = new URLSearchParams();
    const s = overrides.status ?? status;
    const query = overrides.q ?? q;
    const fk = overrides.fieldKey ?? fieldKey;
    const fv = overrides.fieldValue ?? fieldValue;
    if (s) sp.set("status", s);
    if (query) sp.set("q", query);
    if (fk) sp.set("fieldKey", fk);
    if (fv) sp.set("fieldValue", fv);
    sp.set("page", String(nextPage));
    return `?${sp.toString()}`;
  }

  const exportSp = new URLSearchParams();
  if (status) exportSp.set("status", status);
  if (q) exportSp.set("q", q);
  if (fieldKey) exportSp.set("fieldKey", fieldKey);
  if (fieldValue) exportSp.set("fieldValue", fieldValue);
  const exportHref = `/api/admin/universities/${universityId}/registrants/export?${exportSp.toString()}`;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">
          {university.name} — Registrants
          <span className="ml-2 text-sm font-normal text-gray-400">{total} total</span>
        </h1>
        <div className="flex items-center gap-3">
          <a
            href={exportHref}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Export to Excel
          </a>
          <Link href={`/admin/universities/${universityId}`} className="text-sm text-gray-500 hover:underline">
            Back to university
          </Link>
        </div>
      </div>

      <form className="mb-4 flex flex-wrap gap-2" method="get">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search name or LINE user ID"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        />
        <select name="status" defaultValue={status ?? ""} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm">
          <option value="">All statuses</option>
          {Object.values(RegistrantStatus).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select name="fieldKey" defaultValue={fieldKey ?? ""} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm">
          <option value="">Filter by field…</option>
          {university.formFields.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          name="fieldValue"
          defaultValue={fieldValue}
          placeholder="Field value"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        />
        <button type="submit" className="rounded-md bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white">
          Filter
        </button>
      </form>

      <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">LINE User ID</th>
              <th className="px-4 py-2">LINE Channel</th>
              <th className="px-4 py-2">Friend</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Registered</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {registrants.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-4 py-2">
                  <Link href={`/admin/universities/${universityId}/registrants/${r.id}`} className="text-gray-900 hover:text-indigo-600 hover:underline">
                    {r.displayName ?? "(no name)"}
                  </Link>
                </td>
                <td className="px-4 py-2 font-mono text-xs text-gray-500">
                  {r.lineUserId ? `${r.lineUserId.slice(0, 10)}…` : "—"}
                </td>
                <td className="px-4 py-2 text-gray-500">{r.channel?.name ?? "—"}</td>
                <td className="px-4 py-2 text-gray-500">{r.isFriend ? "Yes" : "No"}</td>
                <td className="px-4 py-2">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-4 py-2 text-gray-500">{r.registeredAt.toLocaleDateString()}</td>
              </tr>
            ))}
            {registrants.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-3 text-gray-400">
                  No registrants match this filter.
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
            Previous
          </Link>
          <span className="text-gray-500">
            Page {page} of {totalPages}
          </span>
          <Link
            href={pageHref(Math.min(totalPages, page + 1))}
            className={page >= totalPages ? "pointer-events-none text-gray-300" : "text-gray-600 hover:underline"}
          >
            Next
          </Link>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: RegistrantStatus }) {
  const colors: Record<RegistrantStatus, string> = {
    PENDING: "bg-gray-100 text-gray-600",
    CONFIRMED: "bg-green-100 text-green-700",
    PROBLEM: "bg-red-100 text-red-700",
    CANCELLED: "bg-gray-100 text-gray-400",
  };
  return <span className={`rounded px-1.5 py-0.5 text-xs ${colors[status]}`}>{status}</span>;
}
