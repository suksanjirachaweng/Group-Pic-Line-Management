"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The tagging canvas wants the entire viewport — it already has its own back link and toolbar,
// so the shared admin header/nav is redundant chrome eating into space on what's effectively a
// full-screen editor, not a normal padded admin page.
const FULLSCREEN_PATTERN = /^\/admin\/universities\/[^/]+\/group-photos\/[^/]+$/;

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
  const fullscreen = FULLSCREEN_PATTERN.test(pathname);

  if (fullscreen) {
    return <div className="h-dvh bg-gray-50">{children}</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b-2 border-indigo-500 bg-white px-6 py-3 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <span className="flex items-center gap-2 font-semibold text-gray-900">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/nsl-logo.png" alt="Newsalon" className="h-7 w-auto" />
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
            {email}
            <span
              className={
                isSuperadmin
                  ? "rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700"
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
