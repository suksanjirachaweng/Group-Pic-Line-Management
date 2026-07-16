import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions, canAccessUniversity } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeCode } from "@/lib/groupPhoto/normalizeCode";
import {
  findCrossPhotoDuplicatesByCode,
  findCrossPhotoDuplicatesByName,
  mergeCrossPhotoDuplicates,
  type MergedDuplicateGroup,
  type TagForCrossPhotoCheck,
  type TagSourceLabel,
} from "@/lib/groupPhoto/crossPhotoDuplicates";
import type { GroupPhotoStatus } from "@/generated/prisma/enums";
import { LegacyReferenceUploadForm } from "./LegacyReferenceUploadForm";
import { StripNameTitlesButton } from "./StripNameTitlesButton";
import { UploadGroupPhotoButton } from "./UploadGroupPhotoButton";
import { DeleteGroupPhotoButton } from "./DeleteGroupPhotoButton";
import { PhotoSelectAll } from "./PhotoSelectAll";
import { SharePhotoLinksButton } from "./SharePhotoLinksButton";

const PAGE_SIZE = 50;
const PHOTO_SELECT_FORM_ID = "photo-select-form";

const PHOTO_STATUS_LABEL: Record<GroupPhotoStatus, string> = {
  NOT_STARTED: "เริ่มดำเนินการ",
  NEEDS_EDIT: "เปิดให้แก้ไข",
  DONE: "แก้ไขเสร็จแล้ว",
};

const PHOTO_STATUS_CLASS: Record<GroupPhotoStatus, string> = {
  NOT_STARTED: "bg-gray-100 text-gray-500",
  NEEDS_EDIT: "bg-amber-100 text-amber-700",
  DONE: "bg-green-100 text-green-700",
};

type CombinedRowSource = "Excel" | "Google Sheet" | "LINE";

type CombinedRow = {
  key: string;
  name: string;
  code: string;
  phone: string;
  source: CombinedRowSource;
};

const COMBINED_ROW_SOURCE_CLASS: Record<CombinedRowSource, string> = {
  Excel: "bg-amber-100 text-amber-700",
  "Google Sheet": "bg-orange-100 text-orange-700",
  LINE: "bg-green-100 text-green-700",
};

const TAG_SOURCE_CLASS: Record<TagSourceLabel, string> = {
  ...COMBINED_ROW_SOURCE_CLASS,
  กรอกเอง: "bg-gray-100 text-gray-600",
};

type SortKey = "name" | "code" | "phone" | "source";
const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "name", label: "ชื่อ" },
  { key: "code", label: "CODE" },
  { key: "phone", label: "เบอร์โทร" },
  { key: "source", label: "แหล่งข้อมูล" },
];

const ACTIVE_DATA_TAB_CLASS = "border-b-2 border-rose-500 px-1 py-3 text-sm font-medium text-rose-600";
const INACTIVE_DATA_TAB_CLASS =
  "border-b-2 border-transparent px-1 py-3 text-sm font-medium text-gray-500 hover:text-gray-700";
const ACTIVE_PHOTOS_TAB_CLASS = "border-b-2 border-emerald-500 px-1 py-3 text-sm font-medium text-emerald-600";
const INACTIVE_PHOTOS_TAB_CLASS =
  "border-b-2 border-transparent px-1 py-3 text-sm font-medium text-gray-500 hover:text-gray-700";

type PhotoSortKey = "upload" | "name";

export default async function GroupPhotosPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    q?: string;
    page?: string;
    tab?: string;
    dtab?: string;
    sort?: string;
    dir?: string;
    psort?: string;
    pdir?: string;
  }>;
}) {
  const { id: universityId } = await params;
  const {
    q,
    page: pageParam,
    tab: tabParam,
    dtab: dtabParam,
    sort: sortParam,
    dir: dirParam,
    psort: psortParam,
    pdir: pdirParam,
  } = await searchParams;
  const tab: "data" | "photos" = tabParam === "data" ? "data" : "photos";
  const dataSubTab: "list" | "alerts" = dtabParam === "alerts" ? "alerts" : "list";
  const sort = SORT_COLUMNS.some((c) => c.key === sortParam) ? (sortParam as SortKey) : undefined;
  const dir: "asc" | "desc" = dirParam === "desc" ? "desc" : "asc";
  // Separate `psort`/`pdir` query params (not `sort`/`dir`) so switching tabs never carries the
  // other tab's sort state along by accident.
  const photoSort: PhotoSortKey = psortParam === "name" ? "name" : "upload";
  const photoDir: "asc" | "desc" = pdirParam === "desc" ? "desc" : "asc";

  const session = await getServerSession(authOptions);
  const user = session!.user;
  if (!canAccessUniversity(user, universityId)) notFound();

  const university = await prisma.university.findUnique({
    where: { id: universityId },
    include: { formFields: true },
  });
  if (!university) notFound();

  const [photoCount, dataCount] = await Promise.all([
    prisma.groupPhoto.count({ where: { universityId } }),
    prisma.groupPhotoLegacyReference.count({ where: { universityId } }).then(async (legacy) => {
      const registrants = await prisma.registrant.count({ where: { universityId } });
      return legacy + registrants;
    }),
  ]);

  function tabHref(nextTab: "data" | "photos") {
    return `?tab=${nextTab}`;
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">{university.name} — รูปหมู่</h1>
        <Link href={`/admin/universities/${universityId}`} className="text-sm text-gray-500 hover:text-gray-700 hover:underline">
          ตั้งค่ามหาวิทยาลัย / LINE Channel
        </Link>
      </div>

      <div className="mb-6 border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          <Link href={tabHref("photos")} className={tab === "photos" ? ACTIVE_PHOTOS_TAB_CLASS : INACTIVE_PHOTOS_TAB_CLASS}>
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-500" />
            ภาพหมู่
            <span className="ml-1.5 text-xs font-normal text-gray-400">{photoCount}</span>
          </Link>
          <Link href={tabHref("data")} className={tab === "data" ? ACTIVE_DATA_TAB_CLASS : INACTIVE_DATA_TAB_CLASS}>
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-rose-500" />
            ข้อมูล
            <span className="ml-1.5 text-xs font-normal text-gray-400">{dataCount}</span>
          </Link>
        </nav>
      </div>

      {tab === "data" ? (
        <DataTab
          universityId={universityId}
          q={q}
          pageParam={pageParam}
          sort={sort}
          dir={dir}
          dataSubTab={dataSubTab}
        />
      ) : (
        <PhotosTab universityId={universityId} photoSort={photoSort} photoDir={photoDir} />
      )}
    </div>
  );
}

async function DataTab({
  universityId,
  q,
  pageParam,
  sort,
  dir,
  dataSubTab,
}: {
  universityId: string;
  q: string | undefined;
  pageParam: string | undefined;
  sort: SortKey | undefined;
  dir: "asc" | "desc";
  dataSubTab: "list" | "alerts";
}) {
  const formFields = await prisma.formFieldDefinition.findMany({ where: { universityId } });
  const phoneFieldKey = formFields.find((f) => f.fieldType === "PHONE")?.key;

  const [legacyRows, registrantRows, tagRows] = await Promise.all([
    prisma.groupPhotoLegacyReference.findMany({ where: { universityId }, orderBy: { createdAt: "asc" } }),
    prisma.registrant.findMany({
      where: { universityId },
      select: { id: true, displayName: true, data: true },
      orderBy: { registeredAt: "asc" },
    }),
    prisma.groupPhotoTag.findMany({
      where: { groupPhoto: { universityId } },
      select: {
        id: true,
        groupPhotoId: true,
        code: true,
        normalizedCode: true,
        name: true,
        matchSource: true,
        groupPhoto: { select: { name: true } },
      },
    }),
  ]);

  // Resolves each tag's underlying reference source for the cross-photo alert panel below —
  // reuses the same LINE/Excel/Google Sheet convention as the combined list's own "แหล่งข้อมูล"
  // column, rather than inventing a separate labeling scheme.
  const legacySourceByCode = new Map<string, "Excel" | "Google Sheet">();
  for (const r of legacyRows) {
    const normalized = normalizeCode(r.code);
    if (normalized) legacySourceByCode.set(normalized, r.source === "GOOGLE_SHEET" ? "Google Sheet" : "Excel");
  }
  function resolveTagSource(matchSource: string, normalizedCode: string): TagSourceLabel {
    if (matchSource === "REGISTRANT") return "LINE";
    if (matchSource === "LEGACY_REFERENCE") return legacySourceByCode.get(normalizedCode) ?? "Excel";
    return "กรอกเอง";
  }
  const tagsForCrossPhotoCheck: TagForCrossPhotoCheck[] = tagRows.map((t) => ({
    id: t.id,
    groupPhotoId: t.groupPhotoId,
    groupPhotoName: t.groupPhoto.name,
    code: t.code,
    name: t.name,
    normalizedCode: t.normalizedCode,
    source: resolveTagSource(t.matchSource, t.normalizedCode),
  }));
  const codeDuplicates = findCrossPhotoDuplicatesByCode(tagsForCrossPhotoCheck);
  const nameDuplicates = findCrossPhotoDuplicatesByName(tagsForCrossPhotoCheck);
  const mergedDuplicateGroups = mergeCrossPhotoDuplicates(codeDuplicates, nameDuplicates);

  const combined: CombinedRow[] = [
    ...legacyRows.map((r) => ({
      key: `legacy-${r.id}`,
      name: r.name,
      code: r.code,
      phone: r.phone ?? "—",
      source: (r.source === "GOOGLE_SHEET" ? "Google Sheet" : "Excel") as CombinedRowSource,
    })),
    ...registrantRows.map((r) => {
      const data = (r.data ?? {}) as Record<string, unknown>;
      const rawCode = data.group_photo_index;
      const phoneValue = phoneFieldKey ? data[phoneFieldKey] : undefined;
      return {
        key: `registrant-${r.id}`,
        name: r.displayName ?? "(ไม่มีชื่อ)",
        code: typeof rawCode === "string" && rawCode.trim() ? rawCode : "—",
        phone: typeof phoneValue === "string" && phoneValue.trim() ? phoneValue : "—",
        source: "LINE" as const,
      };
    }),
  ];

  const normalizedQ = q?.trim().toLowerCase() ?? "";
  const normalizedQCode = normalizeCode(q ?? "");
  const filtered = normalizedQ
    ? combined.filter(
        (r) =>
          r.name.toLowerCase().includes(normalizedQ) ||
          r.code.toLowerCase().includes(normalizedQ) ||
          (normalizedQCode && normalizeCode(r.code).includes(normalizedQCode)),
      )
    : combined;

  const sorted = sort
    ? [...filtered].sort((a, b) => {
        const cmp = a[sort].localeCompare(b[sort], "th", { numeric: true, sensitivity: "base" });
        return dir === "desc" ? -cmp : cmp;
      })
    : filtered;

  const page = Math.max(1, Number(pageParam) || 1);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function pageHref(nextPage: number) {
    const sp = new URLSearchParams();
    sp.set("tab", "data");
    if (q) sp.set("q", q);
    if (sort) {
      sp.set("sort", sort);
      sp.set("dir", dir);
    }
    sp.set("page", String(nextPage));
    return `?${sp.toString()}`;
  }

  function sortHref(key: SortKey) {
    const sp = new URLSearchParams();
    sp.set("tab", "data");
    if (q) sp.set("q", q);
    sp.set("sort", key);
    sp.set("dir", sort === key && dir === "asc" ? "desc" : "asc");
    return `?${sp.toString()}`;
  }

  // "list"-only params (search/sort/page) never carry over onto the alerts sub-tab, since it has
  // neither — switching back to "list" restores them from the current values.
  function dataSubTabHref(next: "list" | "alerts") {
    const sp = new URLSearchParams();
    sp.set("tab", "data");
    if (next === "alerts") {
      sp.set("dtab", "alerts");
    } else {
      if (q) sp.set("q", q);
      if (sort) {
        sp.set("sort", sort);
        sp.set("dir", dir);
      }
    }
    return `?${sp.toString()}`;
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <LegacyReferenceUploadForm universityId={universityId} registrantCount={registrantRows.length} />

      <div className="mt-5 border-t border-gray-100 pt-4">
        <div className="mb-4 flex w-fit items-center gap-1 rounded-md border border-gray-300 p-0.5 text-xs">
          <Link
            href={dataSubTabHref("list")}
            className={`rounded px-3 py-1.5 font-medium ${
              dataSubTab === "list" ? "bg-indigo-600 text-white" : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            รายชื่อทั้งหมด <span className="text-xs opacity-80">({filtered.length})</span>
          </Link>
          <Link
            href={dataSubTabHref("alerts")}
            className={`rounded px-3 py-1.5 font-medium ${
              dataSubTab === "alerts" ? "bg-amber-500 text-white" : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            รายการแจ้งเตือน{" "}
            {mergedDuplicateGroups.length > 0 && (
              <span className="text-xs opacity-80">({mergedDuplicateGroups.length})</span>
            )}
          </Link>
        </div>

        {dataSubTab === "alerts" ? (
          <CrossPhotoDuplicateAlerts groups={mergedDuplicateGroups} />
        ) : (
          <>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-900">
                รายชื่อทั้งหมด (รวมทุกแหล่งข้อมูล)
                <span className="ml-2 text-xs font-normal text-gray-400">{filtered.length} รายการ</span>
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <StripNameTitlesButton universityId={universityId} />
                <form method="get" className="flex gap-2">
                  <input type="hidden" name="tab" value="data" />
                  {sort && <input type="hidden" name="sort" value={sort} />}
                  {sort && <input type="hidden" name="dir" value={dir} />}
                  <input
                    type="text"
                    name="q"
                    defaultValue={q}
                    placeholder="ค้นหาชื่อหรือ CODE"
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                  />
                  <button
                    type="submit"
                    className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
                  >
                    ค้นหา
                  </button>
                </form>
              </div>
            </div>

            <div className="overflow-x-auto rounded-md border border-gray-200">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-left text-gray-500">
                  <tr>
                    {SORT_COLUMNS.map(({ key, label }) => (
                      <th key={key} className="whitespace-nowrap px-3 py-2">
                        <Link href={sortHref(key)} className="flex items-center gap-1 hover:text-gray-900">
                          {label}
                          <span className="w-3 text-gray-400">
                            {sort === key ? (dir === "asc" ? "▲" : "▼") : ""}
                          </span>
                        </Link>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pageRows.map((r) => (
                    <tr key={r.key}>
                      <td className="px-3 py-1.5">{r.name}</td>
                      <td className="px-3 py-1.5 font-mono">{r.code}</td>
                      <td className="px-3 py-1.5">{r.phone}</td>
                      <td className="px-3 py-1.5">
                        <span className={`rounded px-1.5 py-0.5 text-xs ${COMBINED_ROW_SOURCE_CLASS[r.source]}`}>
                          {r.source}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-3 text-gray-400">
                        ไม่พบข้อมูลที่ตรงกับการค้นหา
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="mt-3 flex items-center gap-3 text-sm">
                <Link
                  href={pageHref(Math.max(1, page - 1))}
                  className={page <= 1 ? "pointer-events-none text-gray-300" : "text-gray-600 hover:underline"}
                >
                  ก่อนหน้า
                </Link>
                <span className="text-gray-500">
                  หน้า {page} จาก {totalPages}
                </span>
                <Link
                  href={pageHref(Math.min(totalPages, page + 1))}
                  className={
                    page >= totalPages ? "pointer-events-none text-gray-300" : "text-gray-600 hover:underline"
                  }
                >
                  ถัดไป
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

const DUPLICATE_KIND_LABEL: Record<"code" | "name", string> = { code: "CODE", name: "ชื่อ" };

/**
 * Cross-photo duplicate check — different from validateTags.ts's per-photo duplicate-code check
 * (which only looks within one photo). Here the same code or name legitimately CAN show up in
 * more than one of the university's photos, so this is a heads-up list for an admin to double-
 * check, not a hard error blocking anything. One flat table (grouped visually, not one card per
 * group) so a long list of duplicates stays scannable instead of stacking into many small boxes.
 */
function CrossPhotoDuplicateAlerts({ groups }: { groups: MergedDuplicateGroup[] }) {
  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
        ไม่พบ CODE หรือชื่อที่ซ้ำกันคนละภาพ
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-amber-800">
        <span aria-hidden>⚠️</span>
        รายการแจ้งเตือน — พบ CODE หรือชื่อซ้ำกันคนละภาพ
        <span className="text-xs font-normal text-amber-600">({groups.length} รายการ)</span>
      </h3>
      <div className="overflow-x-auto rounded-md border border-amber-200">
        <table className="w-full text-xs">
          <thead className="bg-amber-100/60 text-left text-amber-800">
            <tr>
              <th className="whitespace-nowrap px-3 py-2">ชื่อ-นามสกุล</th>
              <th className="whitespace-nowrap px-3 py-2">CODE</th>
              <th className="whitespace-nowrap px-3 py-2">ปรากฏในภาพ</th>
              <th className="whitespace-nowrap px-3 py-2">แหล่งข้อมูล</th>
              <th className="whitespace-nowrap px-3 py-2">ประเภทที่ซ้ำ</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group, gi) =>
              group.matches.map((m, mi) => (
                <tr
                  key={m.id}
                  className={`${gi % 2 === 0 ? "bg-white" : "bg-amber-50/50"} ${
                    mi === 0 ? "border-t-2 border-amber-200" : "border-t border-amber-100/70"
                  }`}
                >
                  <td className="whitespace-nowrap px-3 py-1.5">{m.name}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono">{m.code}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">{m.groupPhotoName}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    <span className={`rounded px-1.5 py-0.5 ${TAG_SOURCE_CLASS[m.source]}`}>{m.source}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    {mi === 0 ? group.kinds.map((k) => DUPLICATE_KIND_LABEL[k]).join(" + ") : ""}
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

async function PhotosTab({
  universityId,
  photoSort,
  photoDir,
}: {
  universityId: string;
  photoSort: PhotoSortKey;
  photoDir: "asc" | "desc";
}) {
  const photos = await prisma.groupPhoto.findMany({
    where: { universityId },
    orderBy: photoSort === "name" ? { name: photoDir } : { sortOrder: photoDir },
    include: { _count: { select: { tags: true } } },
  });

  function photoSortHref(key: PhotoSortKey) {
    const sp = new URLSearchParams();
    sp.set("tab", "photos");
    sp.set("psort", key);
    sp.set("pdir", photoSort === key && photoDir === "asc" ? "desc" : "asc");
    return `?${sp.toString()}`;
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <SharePhotoLinksButton
          selectFormId={PHOTO_SELECT_FORM_ID}
          photos={photos.map((p) => ({ id: p.id, name: p.name }))}
        />
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">เรียงตาม:</span>
          <div className="flex items-center gap-1 rounded-md border border-gray-300 p-0.5 text-xs">
            <Link
              href={photoSortHref("upload")}
              className={`flex items-center gap-1 rounded px-2 py-1 font-medium ${
                photoSort === "upload" ? "bg-indigo-600 text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              ลำดับอัปโหลด
              {photoSort === "upload" && <span aria-hidden>{photoDir === "asc" ? "▲" : "▼"}</span>}
            </Link>
            <Link
              href={photoSortHref("name")}
              className={`flex items-center gap-1 rounded px-2 py-1 font-medium ${
                photoSort === "name" ? "bg-indigo-600 text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              ชื่อ
              {photoSort === "name" && <span aria-hidden>{photoDir === "asc" ? "▲" : "▼"}</span>}
            </Link>
          </div>
          <UploadGroupPhotoButton universityId={universityId} />
        </div>
      </div>

      {photos.length === 0 ? (
        <p className="text-sm text-gray-400">ยังไม่มีรูปหมู่ — อัปโหลดรูปแรกได้เลย</p>
      ) : (
        <form id={PHOTO_SELECT_FORM_ID}>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            <li className="flex items-center gap-3 bg-gray-50 px-4 py-2">
              <PhotoSelectAll formId={PHOTO_SELECT_FORM_ID} />
              <span className="text-xs text-gray-500">เลือกทั้งหมด</span>
            </li>
            {photos.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <input type="checkbox" name="photoIds" value={p.id} aria-label={`เลือก ${p.name}`} />
                  <Link
                    href={`/admin/universities/${universityId}/group-photos/${p.id}`}
                    className="truncate text-sm text-gray-900 hover:text-indigo-600 hover:underline"
                  >
                    {p.name}
                  </Link>
                  <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${PHOTO_STATUS_CLASS[p.status]}`}>
                    {PHOTO_STATUS_LABEL[p.status]}
                  </span>
                </div>
                <div className="flex flex-none items-center gap-3">
                  <span className="text-xs text-gray-400">{p._count.tags} คน</span>
                  <DeleteGroupPhotoButton universityId={universityId} groupPhotoId={p.id} photoName={p.name} />
                </div>
              </li>
            ))}
          </ul>
        </form>
      )}
    </section>
  );
}
