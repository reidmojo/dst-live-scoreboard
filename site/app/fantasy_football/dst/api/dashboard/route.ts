import { getD1 } from "@/db";
import { getDashboard } from "@/lib/dst/dashboard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return Response.json(await getDashboard(request, getD1()), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected dashboard error";
    return Response.json({ error: message }, { status: 500 });
  }
}
