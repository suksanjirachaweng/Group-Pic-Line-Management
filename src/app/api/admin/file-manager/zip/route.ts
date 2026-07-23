import { NextRequest } from "next/server";
import { AuthzError, requireSession } from "@/lib/authz";
import { isPcPhotoServerConfigured, mintPcPhotoServerToken } from "@/lib/pcPhotoServer";
import { isValidFmPath } from "@/lib/fileManager/pathScope";

// Admin equivalent of src/app/api/files/[token]/zip/route.ts — session-gated instead of
// token-gated (any logged-in admin, same as every other file-manager action), but the same reason
// this can't be a server action: it needs to stream a binary response, not return a plain value.
export async function POST(req: NextRequest) {
  try {
    await requireSession();
  } catch (err) {
    if (err instanceof AuthzError) return new Response("Unauthorized", { status: 401 });
    throw err;
  }

  const body = await req.json().catch(() => null);
  const parentPath = body?.parentPath;
  const fileNames = body?.fileNames;
  if (typeof parentPath !== "string" || !isValidFmPath(parentPath) || !Array.isArray(fileNames) || fileNames.length === 0) {
    return new Response("Bad request", { status: 400 });
  }
  if (fileNames.some((n) => typeof n !== "string" || !n || n.includes("/") || n.includes("\\") || n.includes(".."))) {
    return new Response("Bad request", { status: 400 });
  }
  if (!isPcPhotoServerConfigured()) return new Response("PC server not configured", { status: 502 });

  const paths = fileNames.map((n: string) => `${parentPath}/${n}`);
  const { baseUrl, token } = mintPcPhotoServerToken();
  const pcResp = await fetch(`${baseUrl}/fm/zip`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
  });
  if (!pcResp.ok || !pcResp.body) {
    return new Response("Failed to build ZIP", { status: 502 });
  }

  return new Response(pcResp.body, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="download.zip"',
    },
  });
}
