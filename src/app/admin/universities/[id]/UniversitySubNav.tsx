"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isFullscreenAdminRoute } from "@/lib/admin/fullscreenAdminRoutes";

const TABS = [
  { slug: "group-photos", label: "รูปหมู่" },
  { slug: "events", label: "งานถ่ายรูป" },
  { slug: "registrants", label: "รายชื่อ" },
  { slug: "rules", label: "Rules" },
  { slug: "cards", label: "แผ่นป้ายเบอร์" },
  { slug: "", label: "ตั้งค่า" },
] as const;

/**
 * Wraps every `/admin/universities/[id]/**` page with a breadcrumb + 6-tab sub-nav — added so the
 * two most-buried core pages (university settings, registrants) get real top-level navigation
 * instead of being reachable only via indirect "back to university" links. Fullscreen routes
 * (the tag canvas, quick-tag) pass through untouched — same check AdminChrome.tsx uses, so the two
 * can never disagree about which routes get chrome.
 */
export function UniversitySubNav({
  universityId,
  universityName,
  children,
}: {
  universityId: string;
  universityName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  if (isFullscreenAdminRoute(pathname)) {
    return <>{children}</>;
  }

  const base = `/admin/universities/${universityId}`;

  return (
    <div>
      <div className="mb-3 text-sm text-gray-500">
        <Link href="/admin/universities" className="hover:text-gray-700 hover:underline">
          Universities
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-gray-900">{universityName}</span>
      </div>

      <nav className="mb-6 flex gap-1 border-b border-gray-200">
        {TABS.map((tab) => {
          const href = tab.slug ? `${base}/${tab.slug}` : base;
          const active = tab.slug ? pathname.startsWith(href) : pathname === base;
          return (
            <Link
              key={tab.label}
              href={href}
              className={
                active
                  ? "border-b-2 border-indigo-600 px-3 py-2 text-sm font-medium text-indigo-600"
                  : "border-b-2 border-transparent px-3 py-2 text-sm font-medium text-gray-500 hover:text-gray-700"
              }
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
