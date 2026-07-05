import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { pickChannelForUniversity } from "@/lib/quota";
import { buildLiffRegisterUrl } from "@/lib/liffUrl";

const COOKIE_MAX_AGE_SECONDS = 10 * 60; // 10 minutes: long enough to survive a refresh mid-flow

function cookieName(slug: string) {
  return `reg_channel_${slug}`;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const university = await prisma.university.findUnique({ where: { slug } });
  if (!university || !university.isActive) {
    return new NextResponse("Registration link not found or no longer active.", { status: 404 });
  }

  const pinnedChannelId = request.cookies.get(cookieName(slug))?.value;

  let channel = null;
  if (pinnedChannelId) {
    channel = await prisma.channel.findFirst({
      where: {
        id: pinnedChannelId,
        isActive: true,
        universityPool: { some: { universityId: university.id, isActive: true } },
      },
    });
  }

  if (!channel) {
    channel = await pickChannelForUniversity(university.id);
  }

  if (!channel) {
    return new NextResponse(
      "This university has no active LINE channel configured yet. Please contact the organizer.",
      { status: 503 },
    );
  }

  const liffUrl = buildLiffRegisterUrl(channel.liffId, slug);

  const response = NextResponse.redirect(liffUrl, { status: 302 });
  response.cookies.set(cookieName(slug), channel.id, {
    maxAge: COOKIE_MAX_AGE_SECONDS,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });

  return response;
}
