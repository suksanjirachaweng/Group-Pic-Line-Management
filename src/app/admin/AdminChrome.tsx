"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { isFullscreenAdminRoute } from "@/lib/admin/fullscreenAdminRoutes";

/** A dropdown grouping a handful of related nav links under one label — keeps the header from
 * turning into a long flat row of unrelated links as more admin sections get added. */
function NavGroup({
  label,
  align = "left",
  children,
}: {
  label: string;
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 whitespace-nowrap text-indigo-100 transition-colors hover:text-white"
      >
        {label}
        <span aria-hidden className={`text-[10px] transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
      {open && (
        <div
          className={`absolute top-full z-20 mt-2 w-52 rounded-md border border-gray-200 bg-white py-1 shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function NavGroupLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="block px-3 py-2 text-sm text-gray-700 hover:bg-sky-50 hover:text-indigo-700">
      {children}
    </Link>
  );
}

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
          <nav className="order-3 flex w-full items-center gap-4 overflow-x-auto text-sm sm:order-none sm:w-auto sm:overflow-visible">
            <Link
              href="/admin/universities"
              className="shrink-0 whitespace-nowrap text-indigo-100 transition-colors hover:text-white"
            >
              Universities
            </Link>
            {isSuperadmin && (
              <NavGroup label="ระบบ">
                <NavGroupLink href="/admin/channels">LINE Channels</NavGroupLink>
                <NavGroupLink href="/admin/system-status">สถานะระบบ</NavGroupLink>
              </NavGroup>
            )}
            {isSuperadmin ? (
              <NavGroup label="เครื่องมือ" align="right">
                <NavGroupLink href="/admin/faculty-face-bank">คลังใบหน้าอาจารย์</NavGroupLink>
                <NavGroupLink href="/admin/file-manager">จัดการไฟล์</NavGroupLink>
              </NavGroup>
            ) : (
              <Link
                href="/admin/file-manager"
                className="shrink-0 whitespace-nowrap text-indigo-100 transition-colors hover:text-white"
              >
                จัดการไฟล์
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main className="p-3 sm:p-6">{children}</main>
    </div>
  );
}
