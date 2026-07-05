import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { AdminRole } from "@/generated/prisma/enums";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/login");
  }

  const isSuperadmin = session.user.role === AdminRole.SUPERADMIN;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b-2 border-indigo-500 bg-white px-6 py-3 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <span className="flex items-center gap-2 font-semibold text-gray-900">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500" />
              Group Pic Registration <span className="text-indigo-600">— Admin</span>
            </span>
            <nav className="flex gap-4 text-sm">
              <Link href="/admin/universities" className="text-gray-600 transition-colors hover:text-indigo-600">
                Universities
              </Link>
              {isSuperadmin && (
                <Link href="/admin/channels" className="text-gray-600 transition-colors hover:text-[#06C755]">
                  LINE Channels
                </Link>
              )}
            </nav>
          </div>
          <span className="flex items-center gap-2 text-sm text-gray-500">
            {session.user.email}
            <span
              className={
                isSuperadmin
                  ? "rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700"
                  : "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"
              }
            >
              {session.user.role}
            </span>
          </span>
        </div>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
