import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { syncAllUniversitySheets } from "@/lib/sheets";

async function handle(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const result = await syncAllUniversitySheets();
  return NextResponse.json(result);
}

export const GET = handle;
export const POST = handle;
