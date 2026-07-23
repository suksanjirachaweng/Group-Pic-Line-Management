import { NextRequest } from "next/server";
import { resolveZipPaths } from "@/lib/actions/publicFileManager";
import { isPcPhotoServerConfigured, mintPcPhotoServerToken } from "@/lib/pcPhotoServer";

// Multi-select "download as ZIP" for the public folder-share page. Not a server action (those
// can't stream a binary response) — a real route handler that: (1) validates the request against
// the share token same as every other public file-manager function, then (2) makes a
// server-to-server call to the PC server's new /fm/zip route with a fresh full-access token
// (mintPcPhotoServerToken() with no opts — never exposed to the browser), and (3) pipes that
// response straight back to the client. The browser only ever sees the share token it already had.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await req.json().catch(() => null);
  const subPath = body?.subPath;
  const fileNames = body?.fileNames;
  if (typeof subPath !== "string" || !Array.isArray(fileNames)) {
    return new Response("Bad request", { status: 400 });
  }

  const paths = await resolveZipPaths(token, subPath, fileNames);
  if (!paths) return new Response("Invalid or expired link", { status: 400 });
  if (!isPcPhotoServerConfigured()) return new Response("PC server not configured", { status: 502 });

  const { baseUrl, token: pcToken } = mintPcPhotoServerToken();
  const pcResp = await fetch(`${baseUrl}/fm/zip`, {
    method: "POST",
    headers: { Authorization: `Bearer ${pcToken}`, "Content-Type": "application/json" },
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
