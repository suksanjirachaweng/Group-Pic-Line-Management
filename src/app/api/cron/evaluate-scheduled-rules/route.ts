import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { evaluateScheduledRules } from "@/lib/rules/scheduledTick";

async function handle(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const result = await evaluateScheduledRules();
  return NextResponse.json(result);
}

export const GET = handle;
export const POST = handle;
