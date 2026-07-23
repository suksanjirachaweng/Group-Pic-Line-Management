"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteEntry } from "@/lib/actions/fileManager";
import type { FmEntry } from "@/lib/actions/fileManager";
import { FM_ROOT, encodePathForUrl } from "@/lib/fileManager/pathScope";
import { formatBytes } from "@/lib/fileManager/formatBytes";
import { uploadOne } from "@/lib/fileManager/uploadOne";
import { UploadButton } from "./UploadButton";
import { NewFolderDialog } from "./NewFolderDialog";
import { RenameDialog } from "./RenameDialog";
import { MoveDialog } from "./MoveDialog";
import { ShareDialog } from "./ShareDialog";

const PC_BASE_URL = process.env.NEXT_PUBLIC_PC_PHOTO_STORAGE_URL;
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]);

function isImageName(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase();
  return !!ext && IMAGE_EXTENSIONS.has(ext);
}

// Same 5 modes + labels as the faculty face bank browser (FacultyFaceBankBrowser.tsx) — kept
// visually consistent across both admin pages rather than inventing a second view-mode taxonomy.
type ViewMode = "xlarge" | "icons" | "list" | "details" | "content";
const VIEW_MODE_LABEL: Record<ViewMode, string> = {
  xlarge: "ไอคอนใหญ่พิเศษ",
  icons: "ไอคอน",
  list: "รายการ",
  details: "รายละเอียด",
  content: "เนื้อหา",
};

type DialogState =
  | { type: "newFolder" }
  | { type: "rename"; entry: FmEntry }
  | { type: "move"; entry: FmEntry }
  | { type: "share"; entry: FmEntry };

export function FileManagerView({
  currentPath,
  initialEntries,
  diskSpace,
}: {
  currentPath: string;
  initialEntries: FmEntry[];
  diskSpace: { free: number; size: number };
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("details");
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ name: string; pct: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [zipping, setZipping] = useState(false);

  const segments = currentPath === FM_ROOT ? [] : currentPath.split("/").slice(1);
  const sorted = [...initialEntries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, "th");
  });

  const usedPct = diskSpace.size > 0 ? Math.min(100, Math.round(((diskSpace.size - diskSpace.free) / diskSpace.size) * 100)) : 0;

  function urlFor(relSegments: string[]) {
    return relSegments.length === 0 ? "/admin/file-manager" : `/admin/file-manager/${relSegments.map(encodeURIComponent).join("/")}`;
  }

  function downloadUrlFor(entryName: string): string | null {
    if (!PC_BASE_URL) return null;
    return `${PC_BASE_URL.replace(/\/+$/, "")}/photos/${encodePathForUrl(`${currentPath}/${entryName}`)}`;
  }

  function toggleSelected(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function handleDownloadSelected() {
    const names = [...selected];
    if (names.length === 0) return;
    if (names.length === 1) {
      const url = downloadUrlFor(names[0]);
      if (url) window.open(url, "_blank", "noreferrer");
      return;
    }
    setZipping(true);
    try {
      const resp = await fetch("/api/admin/file-manager/zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentPath: currentPath, fileNames: names }),
      });
      if (!resp.ok) throw new Error("สร้างไฟล์ ZIP ไม่สำเร็จ");
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "download.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "สร้างไฟล์ ZIP ไม่สำเร็จ");
    } finally {
      setZipping(false);
    }
  }

  async function handleDelete(entry: FmEntry) {
    const label = entry.isDir ? `โฟลเดอร์ "${entry.name}" และทุกอย่างข้างในถาวร` : `ไฟล์ "${entry.name}" ถาวร`;
    if (!window.confirm(`ต้องการลบ${label}หรือไม่? ย้อนกลับไม่ได้`)) return;
    setDeleting(entry.name);
    try {
      await deleteEntry(`${currentPath}/${entry.name}`);
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
    } finally {
      setDeleting(null);
    }
  }

  async function handleDroppedFiles(files: FileList) {
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        setProgress({ name: file.name, pct: 0 });
        await uploadOne(currentPath, file, (pct) => setProgress({ name: file.name, pct }));
      }
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "อัปโหลดไม่สำเร็จ");
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  function SelectCheckbox({ entry }: { entry: FmEntry }) {
    if (entry.isDir) return null;
    return (
      <input
        type="checkbox"
        checked={selected.has(entry.name)}
        onChange={() => toggleSelected(entry.name)}
        aria-label={`เลือก ${entry.name}`}
        className="h-4 w-4 shrink-0 rounded border-gray-300"
      />
    );
  }

  /** Google-Drive-style "⋮" menu — replaces what used to be an always-visible row of 4-5 buttons
   * per entry. A dropdown here also sidesteps the earlier grid-view bug where a wrapped
   * multi-button row (hidden via opacity alone) still reserved its full wrapped height, leaving
   * blank space under every card — a single small button can't wrap. */
  function EntryMenu({ entry }: { entry: FmEntry }) {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
    const btnRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const downloadUrl = !entry.isDir ? downloadUrlFor(entry.name) : null;
    const MENU_WIDTH = 160; // matches the menu's own w-40

    useEffect(() => {
      if (!open) return;
      function onClickOutside(e: MouseEvent) {
        const target = e.target as Node;
        if (menuRef.current?.contains(target) || btnRef.current?.contains(target)) return;
        setOpen(false);
      }
      // Also close on scroll — the menu is `position: fixed` at a coordinate computed once on
      // open, so it would otherwise stay stuck in place while the table/page scrolls underneath it.
      function onScroll() {
        setOpen(false);
      }
      document.addEventListener("mousedown", onClickOutside);
      window.addEventListener("scroll", onScroll, true);
      return () => {
        document.removeEventListener("mousedown", onClickOutside);
        window.removeEventListener("scroll", onScroll, true);
      };
    }, [open]);

    // `position: fixed` (viewport-relative, computed from the button's own on-screen position)
    // rather than `absolute` inside a `relative` wrapper — the details-view table sits inside an
    // `overflow-hidden` container (for rounded corners), which silently clipped an absolutely
    // positioned dropdown that tried to render outside those bounds. Fixed positioning is
    // immune to any ancestor's overflow/clipping, wherever this menu is used (table, list, grid).
    function toggle() {
      if (!open && btnRef.current) {
        const rect = btnRef.current.getBoundingClientRect();
        setPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - MENU_WIDTH) });
      }
      setOpen((o) => !o);
    }

    const itemClass = "block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50";

    return (
      <>
        <button
          ref={btnRef}
          type="button"
          onClick={toggle}
          aria-label="ตัวเลือกเพิ่มเติม"
          className="rounded-full px-2 py-1 text-lg leading-none text-gray-500 hover:bg-gray-100"
        >
          ⋮
        </button>
        {open && pos && (
          <div
            ref={menuRef}
            style={{ position: "fixed", top: pos.top, left: pos.left, width: MENU_WIDTH }}
            className="z-50 rounded-md border border-gray-200 bg-white py-1 shadow-lg"
          >
            {downloadUrl && (
              <a
                href={downloadUrl}
                target="_blank"
                rel="noreferrer"
                onClick={() => setOpen(false)}
                className={itemClass}
              >
                ดาวน์โหลด
              </a>
            )}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setDialog({ type: "share", entry });
              }}
              className={itemClass}
            >
              แชร์
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setDialog({ type: "rename", entry });
              }}
              className={itemClass}
            >
              เปลี่ยนชื่อ
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setDialog({ type: "move", entry });
              }}
              className={itemClass}
            >
              ย้าย
            </button>
            <button
              type="button"
              disabled={deleting === entry.name}
              onClick={() => {
                setOpen(false);
                void handleDelete(entry);
              }}
              className={`${itemClass} text-red-600 disabled:opacity-50`}
            >
              {deleting === entry.name ? "กำลังลบ..." : "ลบ"}
            </button>
          </div>
        )}
      </>
    );
  }

  function EntryThumb({ entry, className }: { entry: FmEntry; className: string }) {
    const downloadUrl = !entry.isDir ? downloadUrlFor(entry.name) : null;
    if (entry.isDir) {
      return <div className={`flex items-center justify-center rounded-md bg-gray-50 text-4xl ${className}`}>📁</div>;
    }
    if (downloadUrl && isImageName(entry.name)) {
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={downloadUrl} alt={entry.name} className={`rounded-md bg-gray-50 object-cover ${className}`} />;
    }
    return <div className={`flex items-center justify-center rounded-md bg-gray-50 text-4xl ${className}`}>📄</div>;
  }

  const emptyMessage = "โฟลเดอร์นี้ยังไม่มีไฟล์หรือโฟลเดอร์ย่อย";

  return (
    <div
      className="relative mx-auto max-w-5xl p-6"
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragActive(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragActive(false);
        if (e.dataTransfer.files.length > 0) void handleDroppedFiles(e.dataTransfer.files);
      }}
    >
      {dragActive && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-lg border-2 border-dashed border-indigo-400 bg-indigo-50/80">
          <p className="text-lg font-medium text-indigo-700">วางไฟล์เพื่ออัปโหลด</p>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-gray-900">จัดการไฟล์</h1>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>พื้นที่เหลือ {formatBytes(diskSpace.free)} จาก {formatBytes(diskSpace.size)} ทั้งหมด</span>
          <span className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-100">
            <span
              className={usedPct >= 90 ? "block h-full bg-red-500" : "block h-full bg-indigo-600"}
              style={{ width: `${usedPct}%` }}
            />
          </span>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <nav className="flex flex-wrap items-center gap-1 text-sm text-indigo-600">
          <Link href={urlFor([])} className="hover:underline">
            หน้าแรก
          </Link>
          {segments.map((seg, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="text-gray-300">/</span>
              <Link href={urlFor(segments.slice(0, i + 1))} className="hover:underline">
                {seg}
              </Link>
            </span>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-gray-600">
            มุมมอง:
            <select
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as ViewMode)}
              className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs"
            >
              {(Object.keys(VIEW_MODE_LABEL) as ViewMode[]).map((v) => (
                <option key={v} value={v}>
                  {VIEW_MODE_LABEL[v]}
                </option>
              ))}
            </select>
          </label>
          {selected.size > 0 && (
            <button
              type="button"
              disabled={zipping}
              onClick={() => void handleDownloadSelected()}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {zipping
                ? "กำลังสร้าง ZIP..."
                : selected.size === 1
                  ? "ดาวน์โหลดที่เลือก"
                  : `ดาวน์โหลดที่เลือก (${selected.size}) เป็น ZIP`}
            </button>
          )}
          <button
            type="button"
            onClick={() => setDialog({ type: "newFolder" })}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            สร้างโฟลเดอร์ใหม่
          </button>
          <UploadButton currentPath={currentPath} />
        </div>
      </div>

      {uploading && (
        <p className="mb-3 text-xs text-gray-500">
          กำลังอัปโหลด {progress?.name} {progress ? `(${Math.round(progress.pct)}%)` : "..."}
        </p>
      )}

      {sorted.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">{emptyMessage}</p>
      ) : viewMode === "details" ? (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="whitespace-nowrap px-4 py-2">ชื่อ</th>
                  <th className="whitespace-nowrap px-4 py-2">ขนาด</th>
                  <th className="whitespace-nowrap px-4 py-2">แก้ไขล่าสุด</th>
                  <th className="whitespace-nowrap px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sorted.map((entry) => (
                  <tr key={entry.name}>
                    <td className="whitespace-nowrap px-4 py-2">
                      <div className="flex items-center gap-2">
                        <SelectCheckbox entry={entry} />
                        <EntryThumb entry={entry} className="h-8 w-8 shrink-0 text-lg" />
                        {entry.isDir ? (
                          <Link
                            href={urlFor([...segments, entry.name])}
                            className="font-medium text-indigo-600 hover:underline"
                          >
                            {entry.name}
                          </Link>
                        ) : (
                          <span>{entry.name}</span>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-gray-500">
                      {entry.isDir ? "—" : formatBytes(entry.size)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-gray-500">
                      {new Date(entry.mtimeMs).toLocaleString("th-TH")}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      <EntryMenu entry={entry} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : viewMode === "list" ? (
        <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {sorted.map((entry) => (
            <div key={entry.name} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50">
              <SelectCheckbox entry={entry} />
              <EntryThumb entry={entry} className="h-8 w-8 shrink-0 text-lg" />
              {entry.isDir ? (
                <Link href={urlFor([...segments, entry.name])} className="truncate font-medium text-indigo-600 hover:underline">
                  {entry.name}
                </Link>
              ) : (
                <span className="truncate text-gray-900">{entry.name}</span>
              )}
              <div className="ml-auto shrink-0">
                <EntryMenu entry={entry} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          className={
            viewMode === "xlarge"
              ? "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
              : viewMode === "icons"
                ? "grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8"
                : "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
          }
        >
          {sorted.map((entry) => (
            <div
              key={entry.name}
              className="relative rounded-lg border border-gray-200 bg-white p-3 hover:border-indigo-300 hover:shadow-sm"
            >
              <div className="mb-1 flex items-center justify-between">
                <SelectCheckbox entry={entry} />
                <EntryMenu entry={entry} />
              </div>
              {entry.isDir ? (
                <Link href={urlFor([...segments, entry.name])} className="block">
                  <EntryThumb entry={entry} className="aspect-square w-full" />
                </Link>
              ) : (
                <EntryThumb entry={entry} className="aspect-square w-full" />
              )}
              <div
                className={`mt-2 truncate font-medium text-gray-900 ${viewMode === "icons" ? "text-xs" : "text-sm"}`}
              >
                {entry.name}
              </div>
              {viewMode === "content" && (
                <div className="mt-0.5 flex items-center justify-between text-xs text-gray-400">
                  <span>{entry.isDir ? "โฟลเดอร์" : formatBytes(entry.size)}</span>
                  <span>{new Date(entry.mtimeMs).toLocaleDateString("th-TH")}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {dialog?.type === "newFolder" && <NewFolderDialog currentPath={currentPath} onClose={() => setDialog(null)} />}
      {dialog?.type === "rename" && (
        <RenameDialog path={`${currentPath}/${dialog.entry.name}`} entry={dialog.entry} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === "move" && (
        <MoveDialog path={`${currentPath}/${dialog.entry.name}`} entryName={dialog.entry.name} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === "share" && (
        <ShareDialog
          path={`${currentPath}/${dialog.entry.name}`}
          entryName={dialog.entry.name}
          isFolder={dialog.entry.isDir}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
