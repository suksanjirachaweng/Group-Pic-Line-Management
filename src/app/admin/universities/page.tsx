import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AdminRole } from "@/generated/prisma/enums";

const DEFAULT_THEME_COLOR = "#4f46e5";

export default async function UniversitiesPage() {
  const session = await getServerSession(authOptions);
  const user = session!.user;
  const isSuperadmin = user.role === AdminRole.SUPERADMIN;

  const universities = await prisma.university.findMany({
    where: isSuperadmin ? {} : { id: { in: user.universityIds } },
    orderBy: { name: "asc" },
    include: { _count: { select: { registrants: true } } },
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">Universities</h1>
        {isSuperadmin && (
          <Link
            href="/admin/universities/new"
            className="rounded-md bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white"
          >
            New university
          </Link>
        )}
      </div>

      {universities.length === 0 ? (
        <p className="text-sm text-gray-500">No universities yet.</p>
      ) : (
        <ul className="divide-y divide-gray-200 rounded-md border border-gray-200 bg-white">
          {universities.map((u) => (
            <li key={u.id}>
              <Link
                href={`/admin/universities/${u.id}/group-photos`}
                className="flex items-center justify-between px-4 py-3 text-sm hover:bg-gray-50"
              >
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: u.themeColor || DEFAULT_THEME_COLOR }}
                  />
                  {u.name} <span className="text-gray-400">({u.slug})</span>
                  {!u.isActive && (
                    <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                      inactive
                    </span>
                  )}
                </span>
                <span className="text-gray-400">{u._count.registrants} registrants</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
