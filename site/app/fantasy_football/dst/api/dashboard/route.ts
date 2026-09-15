import { getD1 } from "@/db";
import { getDashboard } from "@/lib/dst/dashboard";
import { createRequestTrace } from "@/lib/dst/request-runtime";
import { after } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  const trace = createRequestTrace(requestId);
  const headers = { "Cache-Control": "no-store", "X-Score-Request-Id": requestId };
  try {
    const dashboard = await getDashboard(request, getD1(), {
      waitUntil: (task: Promise<unknown>) => after(task),
      preferFresh: new URL(request.url).searchParams.get("refresh") === "1",
      trace,
    });
    return Response.json(dashboard, { headers });
  } catch (error) {
    const invalid = error instanceof Error && /^(Invalid season or week|Requested (season|week) is unavailable)$/.test(error.message);
    trace.report("request_failed", { errorType: error instanceof Error ? error.name : "Error" });
    return Response.json({ error: invalid ? error.message : "The score update is taking too long or is temporarily unavailable. Please try again shortly." },
      { status: invalid ? 400 : 503, headers: { ...headers, "Retry-After": "3" } });
  }
}
