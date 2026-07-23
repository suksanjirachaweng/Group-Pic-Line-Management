"use client";

import { useEffect, useRef, useState } from "react";
import { getDownloadUrl, getPublicUploadTarget, listSharedFolder } from "@/lib/actions/publicFileManager";
import type { FmEntry } from "@/lib/actions/fileManager";
import { formatBytes } from "@/lib/fileManager/formatBytes";

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
    <div className="mx-auto max-w-md p-6 text-center">
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
  const refresh = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setEntries(null);
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
    <div className="mx-auto max-w-3xl p-6">
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

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        {error && <p className="p-4 text-sm text-red-600">{error}</p>}
        {!error && entries === null && <p className="p-4 text-sm text-gray-400">กำลังโหลด...</p>}
        {!error && entries && entries.length === 0 && (
          <p className="p-4 text-sm text-gray-400">โฟลเดอร์นี้ยังไม่มีไฟล์</p>
        )}
        {!error && entries && entries.length > 0 && (
          <ul className="divide-y divide-gray-100">
            {[...entries]
              .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, "th") : a.isDir ? -1 : 1))
              .map((e) => (
                <li key={e.name} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  {e.isDir ? (
                    <button
                      type="button"
                      onClick={() => setSubPath(`${subPath}/${e.name}`)}
                      className="font-medium text-indigo-600 hover:underline"
                    >
                      📁 {e.name}
                    </button>
                  ) : (
                    <span>📄 {e.name}</span>
                  )}
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    {!e.isDir && <span>{formatBytes(e.size)}</span>}
                    {!e.isDir && downloadUrls[e.name] && (
                      <a
                        href={downloadUrls[e.name]}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded border border-gray-300 px-2 py-1 text-gray-700 hover:bg-gray-50"
                      >
                        ดาวน์โหลด
                      </a>
                    )}
                  </div>
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}
