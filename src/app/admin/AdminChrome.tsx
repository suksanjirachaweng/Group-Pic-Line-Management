"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isFullscreenAdminRoute } from "@/lib/admin/fullscreenAdminRoutes";

export function AdminChrome({
  email,
  role,
  isSuperadmin,
  children,
}: {
  email: string;
  role: string;
  isSuperadmin: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const fullscreen = isFullscreenAdminRoute(pathname);

  if (fullscreen) {
    return <div className="h-dvh bg-sky-50">{children}</div>;
  }

  return (
    <div className="min-h-screen bg-sky-50">
      <header className="bg-indigo-600 px-8 py-1 shadow-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-8">
            <span className="flex items-center gap-3 font-semibold text-white">
              <span className="flex items-center justify-center rounded-md bg-sky-50 px-3 py-1 shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/nsl-logo.png"
                  alt="Newsalon"
                  className="h-6 w-auto"
                />
                <span className="px-1 py-0.1 text-orange-700"> NEWSALON</span>
              </span>
              Group Pic Registration{" "}
              <span className="text-indigo-200">— Admin</span>
            </span>
            <nav className="flex gap-4 text-sm">
              <Link
                href="/admin/universities"
                className="text-indigo-100 transition-colors hover:text-white"
              >
                Universities
              </Link>
              {isSuperadmin && (
                <Link
                  href="/admin/channels"
                  className="text-indigo-100 transition-colors hover:text-white"
                >
                  LINE Channels
                </Link>
              )}
            </nav>
          </div>
          <span className="flex items-center gap-2 text-sm text-indigo-100">
            {email}
            <span
              className={
                isSuperadmin
                  ? "rounded-full bg-white/90 px-2 py-0.5 text-xs font-medium text-indigo-700"
                  : "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"
              }
            >
              {role}
            </span>
          </span>
        </div>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
