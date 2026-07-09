import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireUniversityAccess, AuthzError } from "@/lib/authz";

/**
 * Group photos are 20MB+ — far past Vercel's ~4.5MB serverless request-body limit, so they
 * can't go through a "use server" action like the small header/message images do. This route
 * only mints a client-upload token; the actual bytes go browser -> Blob directly.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: universityId } = await params;
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        await requireUniversityAccess(universityId);
        return {
          allowedContentTypes: ["image/jpeg", "image/png"],
          maximumSizeInBytes: 100 * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (err) {
    if (err instanceof AuthzError) return new NextResponse(err.message, { status: 403 });
    return new NextResponse(err instanceof Error ? err.message : "Upload failed", { status: 400 });
  }
}
