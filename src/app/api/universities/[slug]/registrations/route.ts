import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const lineUserId = new URL(request.url).searchParams.get("lineUserId");
  if (!lineUserId) {
    return NextResponse.json({ error: "Missing lineUserId" }, { status: 400 });
  }

  const university = await prisma.university.findUnique({ where: { slug } });
  if (!university || !university.isActive) {
    return NextResponse.json({ error: "University not found" }, { status: 404 });
  }

  const registrants = await prisma.registrant.findMany({
    where: { universityId: university.id, lineUserId },
    orderBy: { registeredAt: "asc" },
  });

  return NextResponse.json({
    registrations: registrants.map((r) => ({
      id: r.id,
      registeredAt: r.registeredAt,
      data: r.data,
    })),
  });
}
