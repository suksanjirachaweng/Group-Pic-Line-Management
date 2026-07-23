"use client";

import { useState } from "react";
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
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ name: string; pct: number } | null>(null);

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
          <div className="flex overflow-hidden rounded-md border border-gray-300 text-sm">
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`px-2.5 py-1.5 ${viewMode === "list" ? "bg-indigo-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
              title="มุมมองรายการ"
            >
              รายการ
            </button>
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={`border-l border-gray-300 px-2.5 py-1.5 ${viewMode === "grid" ? "bg-indigo-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
              title="มุมมองไอคอน/พรีวิว"
            >
              ไอคอน
            </button>
          </div>
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

      {viewMode === "list" ? (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="whitespace-nowrap px-4 py-2">ชื่อ</th>
                  <th className="whitespace-nowrap px-4 py-2">ขนาด</th>
                  <th className="whitespace-nowrap px-4 py-2">แก้ไขล่าสุด</th>
                  <th className="whitespace-nowrap px-4 py-2">การจัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sorted.map((entry) => {
                  const downloadUrl = !entry.isDir ? downloadUrlFor(entry.name) : null;
                  return (
                    <tr key={entry.name}>
                      <td className="whitespace-nowrap px-4 py-2">
                        {entry.isDir ? (
                          <Link
                            href={urlFor([...segments, entry.name])}
                            className="font-medium text-indigo-600 hover:underline"
                          >
                            📁 {entry.name}
                          </Link>
                        ) : (
                          <span>📄 {entry.name}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-gray-500">
                        {entry.isDir ? "—" : formatBytes(entry.size)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-gray-500">
                        {new Date(entry.mtimeMs).toLocaleString("th-TH")}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          {!entry.isDir && downloadUrl && (
                            <a
                              href={downloadUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50"
                            >
                              ดาวน์โหลด
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => setDialog({ type: "share", entry })}
                            className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50"
                          >
                            แชร์
                          </button>
                          <button
                            type="button"
                            onClick={() => setDialog({ type: "rename", entry })}
                            className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50"
                          >
                            เปลี่ยนชื่อ
                          </button>
                          <button
                            type="button"
                            onClick={() => setDialog({ type: "move", entry })}
                            className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50"
                          >
                            ย้าย
                          </button>
                          <button
                            type="button"
                            disabled={deleting === entry.name}
                            onClick={() => void handleDelete(entry)}
                            className="rounded border border-red-300 px-2 py-1 text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            {deleting === entry.name ? "กำลังลบ..." : "ลบ"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                      โฟลเดอร์นี้ยังไม่มีไฟล์หรือโฟลเดอร์ย่อย
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {sorted.map((entry) => {
            const downloadUrl = !entry.isDir ? downloadUrlFor(entry.name) : null;
            const showImage = !entry.isDir && downloadUrl && isImageName(entry.name);
            return (
              <div
                key={entry.name}
                className="group relative rounded-lg border border-gray-200 bg-white p-2 hover:border-indigo-300 hover:shadow-sm"
              >
                {entry.isDir ? (
                  <Link href={urlFor([...segments, entry.name])} className="block">
                    <div className="flex aspect-square w-full items-center justify-center rounded-md bg-gray-50 text-4xl">
                      📁
                    </div>
                    <div className="mt-1.5 truncate text-center text-xs font-medium text-gray-900">{entry.name}</div>
                  </Link>
                ) : (
                  <>
                    {showImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={downloadUrl}
                        alt={entry.name}
                        className="aspect-square w-full rounded-md bg-gray-50 object-cover"
                      />
                    ) : (
                      <div className="flex aspect-square w-full items-center justify-center rounded-md bg-gray-50 text-4xl">
                        📄
                      </div>
                    )}
                    <div className="mt-1.5 truncate text-center text-xs font-medium text-gray-900">{entry.name}</div>
                    <div className="text-center text-[11px] text-gray-400">{formatBytes(entry.size)}</div>
                  </>
                )}
                <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1 opacity-0 group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => setDialog({ type: "share", entry })}
                    className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] hover:bg-gray-50"
                  >
                    แชร์
                  </button>
                  <button
                    type="button"
                    onClick={() => setDialog({ type: "rename", entry })}
                    className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] hover:bg-gray-50"
                  >
                    เปลี่ยนชื่อ
                  </button>
                  <button
                    type="button"
                    onClick={() => setDialog({ type: "move", entry })}
                    className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] hover:bg-gray-50"
                  >
                    ย้าย
                  </button>
                  <button
                    type="button"
                    disabled={deleting === entry.name}
                    onClick={() => void handleDelete(entry)}
                    className="rounded border border-red-300 px-1.5 py-0.5 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    {deleting === entry.name ? "กำลังลบ..." : "ลบ"}
                  </button>
                </div>
              </div>
            );
          })}
          {sorted.length === 0 && (
            <p className="col-span-full py-6 text-center text-gray-400">โฟลเดอร์นี้ยังไม่มีไฟล์หรือโฟลเดอร์ย่อย</p>
          )}
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
