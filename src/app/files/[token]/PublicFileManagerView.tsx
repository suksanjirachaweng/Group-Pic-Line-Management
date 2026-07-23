"use client";

import { useEffect, useRef, useState } from "react";
import { getDownloadUrl, getPublicUploadTarget, listSharedFolder } from "@/lib/actions/publicFileManager";
import type { FmEntry } from "@/lib/actions/fileManager";
import { formatBytes } from "@/lib/fileManager/formatBytes";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]);
function isImageName(entryName: string): boolean {
  const ext = entryName.split(".").pop()?.toLowerCase();
  return !!ext && IMAGE_EXTENSIONS.has(ext);
}

/** Module-level (not defined inside PublicFolderBrowser's render body) — same reasoning as the
 * admin file manager's equivalent component: it's referenced from two places at once (the
 * toolbar and the details-table header), so it must not be re-created every render. */
function SelectAllCheckbox({
  allSelected,
  someSelected,
  onToggle,
}: {
  allSelected: boolean;
  someSelected: boolean;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={allSelected}
      onChange={onToggle}
      aria-label="เลือกทั้งหมด"
      className="h-4 w-4 shrink-0 rounded border-gray-300"
    />
  );
}

// Same 5 modes + labels as the admin file-manager view (FileManagerView.tsx) and the faculty face
// bank browser — kept visually consistent across every page in the app that browses a list of
// visual items, rather than inventing a per-page taxonomy.
type ViewMode = "xlarge" | "icons" | "list" | "details" | "content";
const VIEW_MODE_LABEL: Record<ViewMode, string> = {
  xlarge: "ไอคอนใหญ่พิเศษ",
  icons: "ไอคอน",
  list: "รายการ",
  details: "รายละเอียด",
  content: "เนื้อหา",
};

const MAX_RETRIES = 5;

async function uploadOne(token: string, file: File, onProgress: (pct: number) => void, attempt = 0): Promise<void> {
  const target = await getPublicUploadTarget(token, file.name);
  if (!target) throw new Error("ลิงก์นี้ไม่รองรับการอัปโหลด");
  const { uploadUrl, token: uploadToken, finalPath } = target;

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${uploadUrl}?path=${encodeURIComponent(finalPath)}&exact=1&failIfExists=1`);
    xhr.setRequestHeader("Authorization", `Bearer ${uploadToken}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress((e.loaded / e.total) * 100);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      if (xhr.status === 409) return reject(new Error("COLLISION"));
      reject(new Error(`อัปโหลดไม่สำเร็จ (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("การเชื่อมต่อล้มเหลว"));
    xhr.send(file);
  }).catch(async (err: Error) => {
    if (err.message === "COLLISION" && attempt < MAX_RETRIES) return uploadOne(token, file, onProgress, attempt + 1);
    throw err;
  });
}

export function PublicFileManagerView({
  token,
  sharePath,
  isFolder,
  name,
}: {
  token: string;
  sharePath: string;
  isFolder: boolean;
  name: string;
}) {
  if (!isFolder) {
    return <PublicFileDownload token={token} sharePath={sharePath} name={name} />;
  }
  return <PublicFolderBrowser token={token} sharePath={sharePath} rootName={name} />;
}

function PublicFileDownload({ token, sharePath, name }: { token: string; sharePath: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    void getDownloadUrl(token, sharePath).then(setUrl);
  }, [token, sharePath]);

  return (
    <div className="mx-auto w-full min-w-0 max-w-md p-6 text-center">
      <p className="mb-1 text-2xl">📄</p>
      <h1 className="mb-4 text-lg font-semibold text-gray-900">{name}</h1>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-block rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          ดาวน์โหลด
        </a>
      ) : (
        <p className="text-sm text-gray-400">กำลังโหลด...</p>
      )}
    </div>
  );
}

function PublicFolderBrowser({ token, sharePath, rootName }: { token: string; sharePath: string; rootName: string }) {
  const [subPath, setSubPath] = useState(sharePath);
  const [entries, setEntries] = useState<FmEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ name: string; pct: number } | null>(null);
  const [downloadUrls, setDownloadUrls] = useState<Record<string, string>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("details");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [zipping, setZipping] = useState(false);
  const refresh = () => setRefreshKey((k) => k + 1);

  function toggleSelected(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const allFileNames = (entries ?? []).filter((e) => !e.isDir).map((e) => e.name);
  const allSelected = allFileNames.length > 0 && allFileNames.every((n) => selected.has(n));
  const someSelected = allFileNames.some((n) => selected.has(n));

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(allFileNames));
  }


  async function handleDownloadSelected() {
    const names = [...selected];
    if (names.length === 0) return;
    if (names.length === 1) {
      const url = downloadUrls[names[0]];
      if (url) window.open(url, "_blank", "noreferrer");
      return;
    }
    setZipping(true);
    try {
      const resp = await fetch(`/api/files/${token}/zip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subPath, fileNames: names }),
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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setEntries(null);
      setSelected(new Set());
      try {
        const result = await listSharedFolder(token, subPath);
        if (cancelled) return;
        if (!result) {
          setError("ไม่พบโฟลเดอร์นี้");
          setEntries([]);
          return;
        }
        setEntries(result.entries);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "โหลดรายการไม่สำเร็จ");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, subPath, refreshKey]);

  useEffect(() => {
    if (!entries) return;
    let cancelled = false;
    (async () => {
      const urls: Record<string, string> = {};
      for (const e of entries.filter((e) => !e.isDir)) {
        const url = await getDownloadUrl(token, `${subPath}/${e.name}`);
        if (url) urls[e.name] = url;
      }
      if (!cancelled) setDownloadUrls(urls);
    })();
    return () => {
      cancelled = true;
    };
  }, [entries, subPath, token]);

  const isAtRoot = subPath === sharePath;
  const relSegments = subPath === sharePath ? [] : subPath.slice(sharePath.length + 1).split("/");

  async function handleFiles(files: FileList) {
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        setProgress({ name: file.name, pct: 0 });
        await uploadOne(token, file, (pct) => setProgress({ name: file.name, pct }));
      }
      refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "อัปโหลดไม่สำเร็จ");
    } finally {
      setUploading(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl p-6">
      <h1 className="mb-1 text-lg font-semibold text-gray-900">📁 {rootName}</h1>
      <p className="mb-4 text-xs text-gray-500">
        ดู/ดาวน์โหลดไฟล์ในโฟลเดอร์นี้ได้ {isAtRoot && "และอัปโหลดไฟล์ใหม่เพิ่มเข้ามาได้"}
      </p>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <nav className="flex flex-wrap items-center gap-1 text-sm text-indigo-600">
          <button type="button" onClick={() => setSubPath(sharePath)} className="hover:underline">
            {rootName}
          </button>
          {relSegments.map((seg, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="text-gray-300">/</span>
              <button
                type="button"
                onClick={() => setSubPath(`${sharePath}/${relSegments.slice(0, i + 1).join("/")}`)}
                className="hover:underline"
              >
                {seg}
              </button>
            </span>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          {allFileNames.length > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-gray-600">
              <SelectAllCheckbox allSelected={allSelected} someSelected={someSelected} onToggle={toggleSelectAll} />
              เลือกทั้งหมด
            </label>
          )}
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
          {isAtRoot && (
            <>
              <input
                ref={inputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) void handleFiles(e.target.files);
                }}
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => inputRef.current?.click()}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {uploading
                  ? progress
                    ? `กำลังอัปโหลด ${progress.name} (${Math.round(progress.pct)}%)`
                    : "กำลังอัปโหลด..."
                  : "อัปโหลดไฟล์"}
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-red-600">{error}</p>
      )}
      {!error && entries === null && (
        <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-400">กำลังโหลด...</p>
      )}
      {!error && entries && entries.length === 0 && (
        <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-400">โฟลเดอร์นี้ยังไม่มีไฟล์</p>
      )}
      {!error && entries && entries.length > 0 && (() => {
        const sorted = [...entries].sort((a, b) =>
          a.isDir === b.isDir ? a.name.localeCompare(b.name, "th") : a.isDir ? -1 : 1,
        );

        function Thumb({ entry, className }: { entry: FmEntry; className: string }) {
          if (entry.isDir) {
            return <div className={`flex items-center justify-center rounded-md bg-gray-50 text-4xl ${className}`}>📁</div>;
          }
          const url = downloadUrls[entry.name];
          if (url && isImageName(entry.name)) {
            // eslint-disable-next-line @next/next/no-img-element
            return <img src={url} alt={entry.name} className={`rounded-md bg-gray-50 object-cover ${className}`} />;
          }
          return <div className={`flex items-center justify-center rounded-md bg-gray-50 text-4xl ${className}`}>📄</div>;
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

        function DownloadButton({ entry, compact = false }: { entry: FmEntry; compact?: boolean }) {
          if (entry.isDir || !downloadUrls[entry.name]) return null;
          return (
            <a
              href={downloadUrls[entry.name]}
              target="_blank"
              rel="noreferrer"
              className={
                compact
                  ? "rounded border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50"
                  : "rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
              }
            >
              ดาวน์โหลด
            </a>
          );
        }

        if (viewMode === "details") {
          return (
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                    <tr>
                      <th className="whitespace-nowrap px-4 py-2">
                        <div className="flex items-center gap-2">
                          {allFileNames.length > 0 && (
                            <SelectAllCheckbox allSelected={allSelected} someSelected={someSelected} onToggle={toggleSelectAll} />
                          )}
                          ชื่อ
                        </div>
                      </th>
                      <th className="whitespace-nowrap px-4 py-2">ขนาด</th>
                      <th className="whitespace-nowrap px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sorted.map((e) => (
                      <tr key={e.name}>
                        <td className="whitespace-nowrap px-4 py-2">
                          <div className="flex items-center gap-2">
                            <SelectCheckbox entry={e} />
                            <Thumb entry={e} className="h-8 w-8 shrink-0 text-lg" />
                            {e.isDir ? (
                              <button
                                type="button"
                                onClick={() => setSubPath(`${subPath}/${e.name}`)}
                                className="font-medium text-indigo-600 hover:underline"
                              >
                                {e.name}
                              </button>
                            ) : (
                              <span>{e.name}</span>
                            )}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-gray-500">
                          {e.isDir ? "—" : formatBytes(e.size)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2">
                          <DownloadButton entry={e} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        }

        if (viewMode === "list") {
          return (
            <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
              {sorted.map((e) => (
                <div key={e.name} className="flex items-center gap-2 px-4 py-2 text-sm">
                  <SelectCheckbox entry={e} />
                  <Thumb entry={e} className="h-8 w-8 shrink-0 text-lg" />
                  {e.isDir ? (
                    <button
                      type="button"
                      onClick={() => setSubPath(`${subPath}/${e.name}`)}
                      className="truncate font-medium text-indigo-600 hover:underline"
                    >
                      {e.name}
                    </button>
                  ) : (
                    <span className="truncate text-gray-900">{e.name}</span>
                  )}
                  <div className="ml-auto shrink-0">
                    <DownloadButton entry={e} compact />
                  </div>
                </div>
              ))}
            </div>
          );
        }

        return (
          <div
            className={
              viewMode === "xlarge"
                ? "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
                : viewMode === "icons"
                  ? "grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8"
                  : "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
            }
          >
            {sorted.map((e) => (
              <div key={e.name} className="relative rounded-lg border border-gray-200 bg-white p-3">
                {!e.isDir && (
                  <div className="absolute left-4 top-4 z-10 rounded bg-white/90 p-0.5">
                    <SelectCheckbox entry={e} />
                  </div>
                )}
                {e.isDir ? (
                  <button type="button" onClick={() => setSubPath(`${subPath}/${e.name}`)} className="block w-full">
                    <Thumb entry={e} className="aspect-square w-full" />
                  </button>
                ) : (
                  <Thumb entry={e} className="aspect-square w-full" />
                )}
                <div className={`mt-2 truncate font-medium text-gray-900 ${viewMode === "icons" ? "text-xs" : "text-sm"}`}>
                  {e.name}
                </div>
                {viewMode === "content" && !e.isDir && (
                  <div className="mt-0.5 text-xs text-gray-400">{formatBytes(e.size)}</div>
                )}
                {!e.isDir && (
                  <div className="mt-1.5 flex justify-center">
                    <DownloadButton entry={e} compact />
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}
