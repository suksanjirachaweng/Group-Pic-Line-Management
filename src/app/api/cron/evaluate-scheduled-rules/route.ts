import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { evaluateScheduledRules } from "@/lib/rules/scheduledTick";
import { recordCronHeartbeat } from "@/lib/cronHeartbeat";

const JOB_KEY = "evaluate-scheduled-rules";

async function handle(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const result = await evaluateScheduledRules();
    await recordCronHeartbeat(JOB_KEY, "OK");
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordCronHeartbeat(JOB_KEY, "ERROR", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
