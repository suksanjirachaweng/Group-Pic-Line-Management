"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isFullscreenAdminRoute } from "@/lib/admin/fullscreenAdminRoutes";

const TABS = [
  { slug: "events", label: "ชื่องาน" },
  { slug: "group-photos", label: "จัดการ File และรายชื่อ" },
  { slug: "registrants", label: "LINE Registrants" },
  { slug: "rules", label: "Rules" },
  { slug: "cards", label: "ทำแผ่นป้ายเบอร์" },
  { slug: "", label: "ตั้งค่าหน้าลงทะเบียน" },
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
        <Link
          href="/admin/universities"
          className="hover:text-gray-700 hover:underline"
        >
          Universities
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-gray-900">{universityName}</span>
      </div>

      {/* overflow-x-auto + whitespace-nowrap on each tab — without it, a narrow viewport wraps
          every multi-word label onto its own stack of lines instead of scrolling, turning a
          one-line tab bar into a tall, hard-to-read grid. */}
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-gray-200">
        {TABS.map((tab) => {
          const href = tab.slug ? `${base}/${tab.slug}` : base;
          const active = tab.slug
            ? pathname.startsWith(href)
            : pathname === base;
          // "LINE Registrants" gets the LINE-green accent instead of the usual indigo when active —
          // ties it visually to the green "ผู้ลงทะเบียนผ่าน LINE" panel on the group-photos page.
          // Two full literal class strings (not a template-interpolated color name) — Tailwind's
          // build-time scanner only generates CSS for class names it can find as literal substrings
          // in the source, so `border-${color}-600` would silently produce no CSS at all.
          const activeClass =
            tab.slug === "registrants"
              ? "shrink-0 whitespace-nowrap border-b-2 border-green-600 px-3 py-2 text-sm font-medium text-green-600"
              : "shrink-0 whitespace-nowrap border-b-2 border-indigo-600 px-3 py-2 text-sm font-medium text-indigo-600";
          return (
            <Link
              key={tab.label}
              href={href}
              className={
                active
                  ? activeClass
                  : "shrink-0 whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm font-medium text-gray-500 hover:text-gray-700"
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
