import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, canAccessUniversity } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteRule } from "@/lib/actions/rules";

export default async function RulesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: universityId } = await params;

  const session = await getServerSession(authOptions);
  if (!canAccessUniversity(session!.user, universityId)) notFound();

  const university = await prisma.university.findUnique({ where: { id: universityId } });
  if (!university) notFound();

  const rules = await prisma.rule.findMany({
    where: { universityId },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">{university.name} — Rules</h1>
        <div className="flex gap-3">
          <Link
            href={`/admin/universities/${universityId}/rules/new`}
            className="rounded-md bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white"
          >
            New rule
          </Link>
        </div>
      </div>

      <ul className="divide-y divide-gray-200 rounded-md border border-gray-200 bg-white">
        {rules.map((r) => (
          <li key={r.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <Link href={`/admin/universities/${universityId}/rules/${r.id}`} className="hover:underline">
              {r.name}
              {!r.isActive && (
                <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">inactive</span>
              )}
              <span className="ml-2 text-xs text-gray-400">{r.trigger}</span>
            </Link>
            <form action={deleteRule.bind(null, universityId, r.id)}>
              <button type="submit" className="text-red-600 hover:underline">
                Delete
              </button>
            </form>
          </li>
        ))}
        {rules.length === 0 && <li className="px-4 py-3 text-sm text-gray-400">No rules yet.</li>}
      </ul>
    </div>
  );
}
