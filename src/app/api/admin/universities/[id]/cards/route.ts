import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUniversityAccess, AuthzError } from "@/lib/authz";
import { generateCardsPdf } from "@/lib/cardGenerator/generateCardsPdf";
import { getChannelQrInfo } from "@/lib/lineQr";

// One generation request stays comfortably inside a serverless function timeout even at this cap
// — pdfkit renders a simple page (one number + a cached QR image) in well under a millisecond.
const MAX_CARDS = 3000;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: universityId } = await params;

  try {
    await requireUniversityAccess(universityId);
  } catch (err) {
    if (err instanceof AuthzError) return new NextResponse(err.message, { status: 403 });
    throw err;
  }

  const university = await prisma.university.findUnique({ where: { id: universityId } });
  if (!university) return new NextResponse("University not found", { status: 404 });

  const sp = request.nextUrl.searchParams;
  const startCode = Number(sp.get("start"));
  const endCode = Number(sp.get("end"));
  if (!Number.isInteger(startCode) || !Number.isInteger(endCode) || startCode < 0 || endCode < startCode) {
    return new NextResponse("Invalid number range", { status: 400 });
  }
  if (endCode - startCode + 1 > MAX_CARDS) {
    return new NextResponse(`Range too large — max ${MAX_CARDS} cards per generation`, { status: 400 });
  }

  const includeQr = sp.get("qr") === "1";
  let qrUrl: string | null = null;
  if (includeQr) {
    const channelId = sp.get("channelId");
    const pool = await prisma.universityChannelPool.findMany({
      where: { universityId, isActive: true, channel: { isActive: true } },
      include: { channel: true },
    });
    const entry = channelId ? pool.find((p) => p.channelId === channelId) : pool[0];
    if (!entry) {
      return new NextResponse(
        channelId ? "Selected LINE channel not found for this university" : "This university has no LINE channel",
        { status: 400 },
      );
    }
    const qrInfo = await getChannelQrInfo(entry.channel);
    if (!qrInfo) {
      return new NextResponse("Couldn't fetch this LINE channel's add-friend info — check its access token", {
        status: 502,
      });
    }
    qrUrl = qrInfo.addFriendUrl;
  }

  let buffer: Buffer;
  try {
    buffer = await generateCardsPdf({
      startCode,
      endCode,
      includeQr,
      includeFillIn: sp.get("fillIn") === "1",
      includeBrand: sp.get("brand") === "1",
      eventName: sp.get("eventName") ?? "",
      year: sp.get("year") ?? "",
      qrUrl,
    });
  } catch (err) {
    console.error("generateCardsPdf failed", err);
    return new NextResponse("Failed to generate PDF", { status: 500 });
  }

  const filename = `${university.slug}-cards-${startCode}-${endCode}.pdf`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
