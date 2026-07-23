import { notFound } from "next/navigation";
import { listFolder, getDiskSpace, isFileManagerReachable } from "@/lib/actions/fileManager";
import { FM_ROOT } from "@/lib/fileManager/pathScope";
import { FileManagerView } from "./FileManagerView";

export default async function FileManagerPage({ params }: { params: Promise<{ path?: string[] }> }) {
  const { path: pathSegments } = await params;
  if (pathSegments?.some((s) => !s || s === "." || s === "..")) notFound();

  const currentPath = pathSegments && pathSegments.length > 0 ? `${FM_ROOT}/${pathSegments.join("/")}` : FM_ROOT;

  const reachable = await isFileManagerReachable();
  if (!reachable) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="mb-4 text-xl font-semibold text-gray-900">จัดการไฟล์</h1>
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์จัดเก็บไฟล์ได้ — เครื่อง PC อาจปิดอยู่หรือไม่ได้เชื่อมต่ออินเทอร์เน็ต ลองใหม่อีกครั้งภายหลัง
        </p>
      </div>
    );
  }

  // `isFileManagerReachable()` only pings the PC server's pre-existing `/health` route, so it stays
  // true even before the manual PC-side deploy (see pc-photo-server/README.md's "Updating for
  // Phase 5" section) — the new `/fm/*` routes simply don't exist yet on that old server. Without
  // this try/catch, that gap shows up as an ugly unhandled crash page instead of a clear message.
  let entries, diskSpace;
  try {
    [entries, diskSpace] = await Promise.all([listFolder(currentPath), getDiskSpace()]);
  } catch {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="mb-4 text-xl font-semibold text-gray-900">จัดการไฟล์</h1>
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          เซิร์ฟเวอร์ PC ยังไม่รองรับฟีเจอร์นี้ — อาจยังไม่ได้อัปเดตซอฟต์แวร์บนเครื่อง PC (ดู README ของ pc-photo-server) กรุณาติดต่อผู้ดูแลระบบ
        </p>
      </div>
    );
  }

  return <FileManagerView currentPath={currentPath} initialEntries={entries} diskSpace={diskSpace} />;
}
