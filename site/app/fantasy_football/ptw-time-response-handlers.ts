import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { ptwTimeResponses } from "@/db/schema";
import {
  PTW_DRAFT_TIME_SLOT_KEYS,
  PTW_LEGACY_ANSWERED_TIME_SLOT_KEYS,
} from "@/lib/ptw-time-slots";

const VALID_SLOT_KEYS = new Set(PTW_DRAFT_TIME_SLOT_KEYS);

function toNameKey(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeName(name: unknown) {
  return String(name ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
}

function sanitizeUnavailableSlots(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((slot) => String(slot ?? "")).filter((slot) => VALID_SLOT_KEYS.has(slot)))];
}

function safeParseUnavailableSlots(value: string) {
  try {
    return sanitizeUnavailableSlots(JSON.parse(value));
  } catch {
    return [];
  }
}

function safeParseAnsweredSlots(value: string | null) {
  if (value === null) return PTW_LEGACY_ANSWERED_TIME_SLOT_KEYS;
  try {
    return sanitizeUnavailableSlots(JSON.parse(value));
  } catch {
    return [];
  }
}

function routeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (message.includes("no such table") || message.includes("ptw_time_responses")) {
    return "PTW time responses are not available yet. The database migration needs to be applied during deployment.";
  }
  return message;
}

export async function GET() {
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(ptwTimeResponses)
      .orderBy(desc(ptwTimeResponses.updatedAt), desc(ptwTimeResponses.id));

    return Response.json({
      responses: rows.map((row) => ({
        name: row.name,
        unavailableSlots: safeParseUnavailableSlots(row.unavailableSlots),
        answeredSlots: safeParseAnsweredSlots(row.answeredSlots),
        updatedAt: row.updatedAt,
      })),
    });
  } catch (error) {
    return Response.json({ error: routeError(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { name?: unknown; unavailableSlots?: unknown; answeredSlots?: unknown };
    const name = normalizeName(body.name);
    const nameKey = toNameKey(name);
    const unavailableSlots = sanitizeUnavailableSlots(body.unavailableSlots);
    // A cached copy of the previous client may omit answeredSlots during rollout.
    // In that case, preserve the original answered window and leave new mornings unanswered.
    const answeredSlots = Object.prototype.hasOwnProperty.call(body, "answeredSlots")
      ? sanitizeUnavailableSlots(body.answeredSlots)
      : PTW_LEGACY_ANSWERED_TIME_SLOT_KEYS;
    const answeredSlotSet = new Set(answeredSlots);
    const answeredUnavailableSlots = unavailableSlots.filter((slot) => answeredSlotSet.has(slot));

    if (!name) {
      return Response.json({ error: "Name is required." }, { status: 400 });
    }

    const db = getDb();
    const [existing] = await db
      .select({ name: ptwTimeResponses.name })
      .from(ptwTimeResponses)
      .where(eq(ptwTimeResponses.nameKey, nameKey))
      .limit(1);
    const storedName = existing?.name || name;
    const [saved] = await db
      .insert(ptwTimeResponses)
      .values({
        name: storedName,
        nameKey,
        unavailableSlots: JSON.stringify(answeredUnavailableSlots),
        answeredSlots: JSON.stringify(answeredSlots),
      })
      .onConflictDoUpdate({
        target: ptwTimeResponses.nameKey,
        set: {
          name: storedName,
          unavailableSlots: JSON.stringify(answeredUnavailableSlots),
          answeredSlots: JSON.stringify(answeredSlots),
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      })
      .returning();

    return Response.json({
      response: {
        name: saved.name,
        unavailableSlots: safeParseUnavailableSlots(saved.unavailableSlots),
        answeredSlots: safeParseAnsweredSlots(saved.answeredSlots),
        updatedAt: saved.updatedAt,
      },
    });
  } catch (error) {
    return Response.json({ error: routeError(error) }, { status: 500 });
  }
}
