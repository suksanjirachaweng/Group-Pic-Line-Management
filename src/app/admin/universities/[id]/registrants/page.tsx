import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, canAccessUniversity } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { RegistrantStatus } from "@/generated/prisma/enums";
import { buildRegistrantWhere, sortRegistrants } from "@/lib/registrantFilters";

const PAGE_SIZE = 50;

const FIXED_COLUMNS = [
  { key: "lineUserId", label: "LINE User ID" },
  { key: "channel", label: "LINE Channel" },
  { key: "friend", label: "Friend" },
  { key: "status", label: "Status" },
  { key: "registered", label: "Registered" },
] as const;

export default async function RegistrantsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    page?: string;
    status?: string;
    q?: string;
    fieldKey?: string;
    fieldValue?: string;
    sortBy?: string;
    sortDir?: string;
  }>;
}) {
  const { id: universityId } = await params;
  const { page: pageParam, status, q, fieldKey, fieldValue, sortBy, sortDir } = await searchParams;

  const session = await getServerSession(authOptions);
  const user = session!.user;
  if (!canAccessUniversity(user, universityId)) notFound();

  const university = await prisma.university.findUnique({
    where: { id: universityId },
    include: { formFields: { orderBy: { sortOrder: "asc" } } },
  });
  if (!university) notFound();

  const page = Math.max(1, Number(pageParam) || 1);
  const formFieldKeys = new Set(university.formFields.map((f) => f.key));

  const where = buildRegistrantWhere(universityId, { status, q, fieldKey, fieldValue });

  const matched = await prisma.registrant.findMany({
    where,
    orderBy: { registeredAt: "desc" },
    include: { channel: { select: { name: true } } },
  });

  const sorted = sortRegistrants(matched, sortBy, sortDir, formFieldKeys);
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const registrants = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const baseParams = { status, q, fieldKey, fieldValue, sortBy, sortDir };

  function pageHref(nextPage: number, overrides: Record<string, string | undefined> = {}) {
    const merged = { ...baseParams, ...overrides };
    const sp = new URLSearchParams();
    if (merged.status) sp.set("status", merged.status);
    if (merged.q) sp.set("q", merged.q);
    if (merged.fieldKey) sp.set("fieldKey", merged.fieldKey);
    if (merged.fieldValue) sp.set("fieldValue", merged.fieldValue);
    if (merged.sortBy) sp.set("sortBy", merged.sortBy);
    if (merged.sortDir) sp.set("sortDir", merged.sortDir);
    sp.set("page", String(nextPage));
    return `?${sp.toString()}`;
  }

  function sortHref(column: string) {
    const nextDir = sortBy === column && sortDir !== "desc" ? "desc" : "asc";
    return pageHref(1, { sortBy: column, sortDir: nextDir });
  }

  function sortIndicator(column: string) {
    if (sortBy !== column) return null;
    return sortDir === "desc" ? " ▼" : " ▲";
  }

  const exportSp = new URLSearchParams();
  if (status) exportSp.set("status", status);
  if (q) exportSp.set("q", q);
  if (fieldKey) exportSp.set("fieldKey", fieldKey);
  if (fieldValue) exportSp.set("fieldValue", fieldValue);
  if (sortBy) exportSp.set("sortBy", sortBy);
  if (sortDir) exportSp.set("sortDir", sortDir);
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
        {sortBy && <input type="hidden" name="sortBy" value={sortBy} />}
        {sortDir && <input type="hidden" name="sortDir" value={sortDir} />}
        <button type="submit" className="rounded-md bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white">
          Filter
        </button>
      </form>

      <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="whitespace-nowrap px-4 py-2">
                <Link href={sortHref("name")} className="hover:text-gray-700">
                  Name{sortIndicator("name")}
                </Link>
              </th>
              {university.formFields.map((f) => (
                <th key={f.key} className="whitespace-nowrap px-4 py-2">
                  <Link href={sortHref(f.key)} className="hover:text-gray-700">
                    {f.label}
                    {sortIndicator(f.key)}
                  </Link>
                </th>
              ))}
              {FIXED_COLUMNS.map((c) => (
                <th key={c.key} className="whitespace-nowrap px-4 py-2">
                  <Link href={sortHref(c.key)} className="hover:text-gray-700">
                    {c.label}
                    {sortIndicator(c.key)}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {registrants.map((r) => {
              const data = (r.data ?? {}) as Record<string, string>;
              return (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-2">
                    <Link href={`/admin/universities/${universityId}/registrants/${r.id}`} className="text-gray-900 hover:text-indigo-600 hover:underline">
                      {r.displayName ?? "(no name)"}
                    </Link>
                  </td>
                  {university.formFields.map((f) => (
                    <td key={f.key} className="whitespace-nowrap px-4 py-2 text-gray-500">
                      {data[f.key] || "—"}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-gray-500">
                    {r.lineUserId ? `${r.lineUserId.slice(0, 10)}…` : "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-gray-500">{r.channel?.name ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-gray-500">{r.isFriend ? "Yes" : "No"}</td>
                  <td className="whitespace-nowrap px-4 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-gray-500">{r.registeredAt.toLocaleDateString()}</td>
                </tr>
              );
            })}
            {registrants.length === 0 && (
              <tr>
                <td colSpan={1 + university.formFields.length + FIXED_COLUMNS.length} className="px-4 py-3 text-gray-400">
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
