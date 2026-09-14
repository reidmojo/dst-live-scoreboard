import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { responses } from "@/db/schema";
import { editableDateKeys, mergeSelectionUpdate } from "@/lib/availability/editing";

const VALID_CHOICES = new Set(["in_person", "remote", "possible", "no"]);
const SURVEY_START = "2026-08-08";
const SURVEY_END = "2026-09-06";

type Selections = Record<string, string>;

function toNameKey(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeName(name: unknown) {
  return String(name ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
}

function toDateKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function datesBetween(startKey: string, endKey: string) {
  const dates: string[] = [];
  const cursor = new Date(`${startKey}T12:00:00Z`);
  const end = new Date(`${endKey}T12:00:00Z`);
  while (cursor <= end) {
    dates.push(toDateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function isSaturday(dateKey: string) {
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay() === 6;
}

function validDates() {
  return new Set(datesBetween(SURVEY_START, SURVEY_END));
}

function sanitizeSelections(value: unknown): Selections {
  const allowedDates = validDates();
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const sanitized: Selections = {};

  for (const [date, choiceValue] of Object.entries(raw)) {
    const choice = String(choiceValue ?? "");
    if (!allowedDates.has(date) || !VALID_CHOICES.has(choice)) continue;
    if (choice === "in_person" && !isSaturday(date)) continue;
    sanitized[date] = choice;
  }

  return sanitized;
}

function safeParseSelections(value: string) {
  try {
    return sanitizeSelections(JSON.parse(value));
  } catch {
    return {};
  }
}

function routeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (message.includes("no such table") || message.includes("responses")) {
    return "Responses are not available yet. The database migration needs to be applied during deployment.";
  }
  return message;
}

export async function GET() {
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(responses)
      .orderBy(desc(responses.updatedAt), desc(responses.id));

    return Response.json({
      responses: rows.map((row) => ({
        name: row.name,
        selections: safeParseSelections(row.selections),
        updatedAt: row.updatedAt,
      })),
    });
  } catch (error) {
    return Response.json({ error: routeError(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { name?: unknown; selections?: unknown; editableDates?: unknown };
    const name = normalizeName(body.name);
    const nameKey = toNameKey(name);
    const submittedSelections = sanitizeSelections(body.selections);
    const allowedDates = validDates();
    const datesBeingEdited = editableDateKeys(body.editableDates, allowedDates, submittedSelections);

    if (!name) {
      return Response.json({ error: "Name is required." }, { status: 400 });
    }

    const db = getDb();
    const [existing] = await db
      .select({ name: responses.name, selections: responses.selections })
      .from(responses)
      .where(eq(responses.nameKey, nameKey))
      .limit(1);
    const storedName = existing?.name || name;
    const selections = mergeSelectionUpdate(
      existing ? safeParseSelections(existing.selections) : {},
      submittedSelections,
      datesBeingEdited,
    );
    const [saved] = await db
      .insert(responses)
      .values({
        name: storedName,
        nameKey,
        selections: JSON.stringify(selections),
      })
      .onConflictDoUpdate({
        target: responses.nameKey,
        set: {
          name: storedName,
          selections: JSON.stringify(selections),
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      })
      .returning();

    return Response.json({
      response: {
        name: saved.name,
        selections: safeParseSelections(saved.selections),
        updatedAt: saved.updatedAt,
      },
    });
  } catch (error) {
    return Response.json({ error: routeError(error) }, { status: 500 });
  }
}
