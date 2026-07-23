import { getShareLinkInfo } from "@/lib/actions/publicFileManager";
import { PublicFileManagerView } from "./PublicFileManagerView";

// No cookies/headers/searchParams here — without this, Next.js would treat this token-only page
// as eligible for the Full Route Cache, freezing the FIRST visit's render for every later visit to
// the same token until something happens to revalidate it. Same real bug already hit once on
// /photo-review/[token] (see that page's own comment) — copying the fix here preemptively.
export const dynamic = "force-dynamic";

export default async function PublicFileSharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const info = await getShareLinkInfo(token);
  if (!info) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          ลิงก์นี้ไม่ถูกต้องหรือถูกปิดใช้งานแล้ว กรุณาติดต่อผู้ดูแลเพื่อขอลิงก์ใหม่
        </p>
      </div>
    );
  }

  return <PublicFileManagerView token={token} sharePath={info.path} isFolder={info.isFolder} name={info.name} />;
}
