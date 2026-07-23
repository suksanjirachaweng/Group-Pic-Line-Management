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
      <header className="bg-indigo-600 px-3 py-1.5 shadow-md sm:px-8 sm:py-1">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
          <span className="flex shrink-0 items-center gap-2 font-semibold text-white sm:gap-3">
            <span className="flex items-center justify-center rounded-md bg-sky-50 px-2 py-1 shadow-sm sm:px-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/nsl-logo.png"
                alt="Newsalon"
                className="h-5 w-auto sm:h-6"
              />
              <span className="hidden px-1 py-0.1 text-orange-700 sm:inline">
                {" "}
                NEWSALON
              </span>
            </span>
            <span className="hidden sm:inline">ระบบจัดการรูปหมู่ </span>
            <span className="text-orange-300">{email}</span>
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
          <span className="flex shrink-0 items-center text-xs text-indigo-100 sm:order-none sm:text-sm"></span>
          {/* order-3 + w-full forces this onto its own row on mobile (flex-wrap does the rest);
              sm:w-auto puts it back inline with the brand/email row on desktop, matching the
              original single-row layout exactly. Horizontal scroll (not wrap) on mobile so tab
              labels never break into the tall multi-line stack a plain flex-wrap nav produces. */}
          <nav className="order-3 flex w-full gap-4 overflow-x-auto text-sm sm:order-none sm:w-auto sm:overflow-visible">
            <Link
              href="/admin/universities"
              className="shrink-0 whitespace-nowrap text-indigo-100 transition-colors hover:text-white"
            >
              Universities
            </Link>
            {isSuperadmin && (
              <Link
                href="/admin/channels"
                className="shrink-0 whitespace-nowrap text-indigo-100 transition-colors hover:text-white"
              >
                LINE Channels
              </Link>
            )}
            {isSuperadmin && (
              <Link
                href="/admin/system-status"
                className="shrink-0 whitespace-nowrap text-indigo-100 transition-colors hover:text-white"
              >
                สถานะระบบ
              </Link>
            )}
            {isSuperadmin && (
              <Link
                href="/admin/faculty-face-bank"
                className="shrink-0 whitespace-nowrap text-indigo-100 transition-colors hover:text-white"
              >
                คลังใบหน้าอาจารย์
              </Link>
            )}
            <Link
              href="/admin/file-manager"
              className="shrink-0 whitespace-nowrap text-indigo-100 transition-colors hover:text-white"
            >
              จัดการไฟล์
            </Link>
          </nav>
        </div>
      </header>
      <main className="p-3 sm:p-6">{children}</main>
    </div>
  );
}
