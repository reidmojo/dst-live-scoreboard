"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Choice = "in_person" | "remote" | "possible" | "no";
type Selections = Record<string, Choice>;
type LeagueResponse = {
  name: string;
  selections: Selections;
  updatedAt?: string;
};

const SURVEY_START = "2026-08-08";
const SURVEY_END = "2026-09-06";

const STATES: { key: Choice; short: string; label: string }[] = [
  { key: "in_person", short: "In person", label: "Available — in person" },
  { key: "remote", short: "Remote", label: "Available — remote" },
  { key: "possible", short: "Possible", label: "Not ideal but possible" },
  { key: "no", short: "No", label: "Not available" },
];

const STATE_BY_KEY = Object.fromEntries(STATES.map((state) => [state.key, state])) as Record<Choice, { key: Choice; short: string; label: string }>;

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function datesBetween(startKey: string, endKey: string) {
  const dates: string[] = [];
  const cursor = new Date(`${startKey}T12:00:00`);
  const end = new Date(`${endKey}T12:00:00`);
  while (cursor <= end) {
    dates.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function todayKey() {
  return toDateKey(new Date());
}

function isSaturday(dateKey: string) {
  return new Date(`${dateKey}T12:00:00`).getDay() === 6;
}

function daysInMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function statesForDate(dateKey: string) {
  return isSaturday(dateKey) ? STATES : STATES.filter((state) => state.key !== "in_person");
}

function nextStateForDate(currentKey: Choice | undefined, dateKey: string): Choice {
  const availableStates = statesForDate(dateKey);
  if (!currentKey || !availableStates.some((state) => state.key === currentKey)) {
    return availableStates[0].key;
  }
  const index = availableStates.findIndex((state) => state.key === currentKey);
  return availableStates[(index + 1) % availableStates.length].key;
}

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function formatDate(dateString: string, style: "long" | "short" = "long") {
  const date = new Date(`${dateString}T12:00:00`);
  return new Intl.DateTimeFormat("en-US", {
    weekday: style === "short" ? "short" : "long",
    month: style === "short" ? "short" : "long",
    day: "numeric",
  }).format(date);
}

function samePerson(a: string, b: string) {
  return normalizeName(a).toLowerCase() === normalizeName(b).toLowerCase();
}

function choiceLabel(choice: Choice | undefined, dateKey: string) {
  if (!choice) return "not answered";
  if (choice !== "possible") return STATE_BY_KEY[choice].label;
  return isSaturday(dateKey) ? "Not ideal but possible — remote/in person" : "Not ideal but possible — remote";
}

function responseNames(label: string, names: string[]) {
  if (!names.length) return null;
  return (
    <div>
      <strong>{label}:</strong> {names.sort((a, b) => a.localeCompare(b)).join(", ")}
    </div>
  );
}

export default function DraftAvailabilityApp() {
  const [name, setName] = useState("");
  const [selections, setSelections] = useState<Selections>({});
  const [responses, setResponses] = useState<LeagueResponse[]>([]);
  const [status, setStatus] = useState("Loading league responses…");
  const [saving, setSaving] = useState(false);
  const [responsesLoaded, setResponsesLoaded] = useState(false);
  const selectionOwnerKey = useRef("");
  const selectionsAreDirty = useRef(false);

  const targetDates = useMemo(() => datesBetween(SURVEY_START, SURVEY_END).filter((date) => date >= todayKey()), []);

  useEffect(() => {
    void refreshResponses();
  }, []);

  useEffect(() => {
    const person = normalizeName(name);
    const personKey = person.toLowerCase();

    if (!person || !responsesLoaded) {
      setSelections({});
      selectionOwnerKey.current = personKey;
      selectionsAreDirty.current = false;
      return;
    }

    if (personKey === selectionOwnerKey.current && selectionsAreDirty.current) return;

    const existing = responses.find((response) => samePerson(response.name, person));
    setSelections(existing?.selections || {});
    selectionOwnerKey.current = personKey;
    selectionsAreDirty.current = false;
  }, [name, responses, responsesLoaded]);

  async function refreshResponses() {
    try {
      const response = await fetch("/fantasy_football/availability/api/responses", { cache: "no-store" });
      const body = await response.json() as { responses?: LeagueResponse[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Could not load responses.");
      setResponses(body.responses || []);
      setResponsesLoaded(true);
      setStatus((body.responses || []).length ? "League responses loaded." : "No league responses yet.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load responses.");
    }
  }

  function toggleDate(dateKey: string) {
    const person = normalizeName(name);
    if (!person) {
      setStatus("Add your name first.");
      return;
    }

    setSelections((current) => ({
      ...current,
      [dateKey]: nextStateForDate(current[dateKey], dateKey),
    }));
    selectionsAreDirty.current = true;
  }

  async function saveResponse() {
    const person = normalizeName(name);
    if (!person) {
      setStatus("Add your name first.");
      return;
    }

    setSaving(true);
    setStatus("Saving your response…");
    try {
      const response = await fetch("/fantasy_football/availability/api/responses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: person, selections, editableDates: targetDates }),
      });
      const body = await response.json() as { response?: LeagueResponse; error?: string };
      if (!response.ok || !body.response) throw new Error(body.error || "Could not save response.");

      setResponses((current) => {
        const withoutCurrent = current.filter((item) => !samePerson(item.name, body.response!.name));
        return [body.response!, ...withoutCurrent];
      });
      selectionsAreDirty.current = false;
      setStatus("Saved. Results are updated for everyone.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save response.");
    } finally {
      setSaving(false);
    }
  }

  function clearMine() {
    setSelections({});
    selectionsAreDirty.current = true;
    setStatus("Cleared your local picks. Hit Save to update the shared results.");
  }

  const answeredCount = targetDates.filter((date) => selections[date]).length;
  const summaries = targetDates.map((dateKey) => {
    const summary = {
      dateKey,
      in_person: [] as string[],
      remote: [] as string[],
      possible: [] as string[],
      no: [] as string[],
    };

    for (const response of responses) {
      const choice = response.selections[dateKey];
      if (choice && summary[choice]) summary[choice].push(response.name);
    }

    return summary;
  }).sort((a, b) => {
    const firmA = a.in_person.length + a.remote.length;
    const firmB = b.in_person.length + b.remote.length;
    return (
      firmB - firmA ||
      b.in_person.length - a.in_person.length ||
      b.possible.length - a.possible.length ||
      a.no.length - b.no.length ||
      a.dateKey.localeCompare(b.dateKey)
    );
  });

  const bestFirm = summaries[0] ? summaries[0].in_person.length + summaries[0].remote.length : 0;
  const bestInPerson = summaries[0]?.in_person.length || 0;
  const person = normalizeName(name);
  const existingResponse = responses.find((response) => samePerson(response.name, person));
  const nameHint = !responsesLoaded
    ? "Loading saved league responses…"
    : existingResponse
      ? `Editing ${existingResponse.name}’s saved response. Change any date and save again.`
      : person
        ? "No saved response with that name yet."
        : "Your saved response updates the shared league results.";

  return (
    <main className="shell">
      <header className="hero-grid">
        <section className="hero-card" aria-labelledby="page-title">
          <p className="eyebrow">Draft day availability</p>
          <h1 id="page-title">Pick the days that work.</h1>
          <p>
            Enter your name, tap each date from August 8 through September 6, then save.
            In-person availability is Saturday-only; every other day is remote/possible/no.
          </p>
        </section>

        <aside className="control-card" aria-label="Participant controls">
          <label htmlFor="managerName">Your name</label>
          <input
            id="managerName"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g., Reid"
            autoComplete="name"
          />
          <p className="hint">{nameHint}</p>

          <div className="toolbar">
            <button className="button" type="button" onClick={saveResponse} disabled={saving || !person || !responsesLoaded}>
              {saving ? "Saving…" : existingResponse ? "Save changes" : "Save response"}
            </button>
            <button className="button secondary" type="button" onClick={clearMine} disabled={!person || !responsesLoaded}>
              Clear mine
            </button>
          </div>

          <div className="legend" aria-label="Availability options">
            <div className="legend-item"><span className="swatch in_person" /> Available — in person (Saturdays only)</div>
            <div className="legend-item"><span className="swatch remote" /> Available — remote</div>
            <div className="legend-item"><span className="swatch possible" /> Not ideal but possible</div>
            <div className="legend-item"><span className="swatch no" /> Not available</div>
          </div>
        </aside>
      </header>

      <section className="status-bar" role="status" aria-live="polite">
        <span>{status}</span>
        <button type="button" className="text-button" onClick={refreshResponses}>Refresh results</button>
      </section>

      <div className="content-grid">
        <section className="calendar-card" aria-labelledby="calendar-title">
          <div className="section-title">
            <h2 id="calendar-title">Calendar</h2>
            <span className="status-pill">{answeredCount} of {targetDates.length} dates answered</span>
          </div>
          <Calendar
            dates={targetDates}
            selections={selections}
            onToggle={toggleDate}
            locked={!person || !responsesLoaded}
            lockedLabel={person ? "Loading…" : "Add name"}
          />
        </section>

        <section className="results-card" aria-labelledby="results-title">
          <div className="section-title">
            <h2 id="results-title">Days that work</h2>
            <span className="status-pill">{responses.length} {responses.length === 1 ? "person" : "people"}</span>
          </div>

          <div className="results-list">
            {!responses.length ? (
              <article className="result-card">
                <div className="result-top">
                  <span className="result-date">No responses yet</span>
                </div>
                <p className="hint">Save your picks to start the league rollup.</p>
              </article>
            ) : summaries.map((summary) => {
              const firm = summary.in_person.length + summary.remote.length;
              const isBest = firm === bestFirm && summary.in_person.length === bestInPerson;
              const total = Math.max(responses.length, 1);
              return (
                <article
                  className={`result-card ${isBest ? "best" : ""}`}
                  key={summary.dateKey}
                  style={{
                    "--in-person-count": `${Math.max(summary.in_person.length, 0.001)}fr`,
                    "--remote-count": `${Math.max(summary.remote.length, 0.001)}fr`,
                    "--possible-count": `${Math.max(summary.possible.length, 0.001)}fr`,
                    "--no-count": `${Math.max(summary.no.length, 0.001)}fr`,
                  } as React.CSSProperties}
                >
                  <div className="result-top">
                    <span className="result-date">{formatDate(summary.dateKey, "short")}</span>
                    <span className="result-score">{firm}/{total} firm · {summary.in_person.length} in person</span>
                  </div>
                  <div className="meter" aria-hidden="true"><span /><span /><span /><span /></div>
                  <div className="count-grid">
                    <span>In person: {summary.in_person.length}</span>
                    <span>Remote: {summary.remote.length}</span>
                    <span>Possible: {summary.possible.length}</span>
                    <span>No: {summary.no.length}</span>
                  </div>
                  <div className="names">
                    {responseNames("In person", summary.in_person)}
                    {responseNames("Remote", summary.remote)}
                    {responseNames("Possible", summary.possible)}
                    {responseNames("No", summary.no)}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}

function Calendar({
  dates,
  selections,
  onToggle,
  locked,
  lockedLabel,
}: {
  dates: string[];
  selections: Selections;
  onToggle: (dateKey: string) => void;
  locked: boolean;
  lockedLabel: string;
}) {
  const months = [
    { year: 2026, month: 7, label: "August 2026" },
    { year: 2026, month: 8, label: "September 2026" },
  ];

  return (
    <div className="calendar-months">
      {months.map(({ year, month, label }) => {
        const firstDay = new Date(year, month, 1).getDay();
        const cells = [];
        for (let i = 0; i < firstDay; i += 1) {
          cells.push(<div className="empty-day" key={`empty-start-${label}-${i}`} />);
        }

        for (let day = 1; day <= daysInMonth(year, month); day += 1) {
          const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          if (!dates.includes(key)) {
            cells.push(<div className="empty-day" key={key} />);
            continue;
          }

          const rawChoice = selections[key];
          const choice = statesForDate(key).some((state) => state.key === rawChoice) ? rawChoice : undefined;
          const date = new Date(`${key}T12:00:00`);
          cells.push(
            <button
              type="button"
              className={`day ${choice || ""}`.trim()}
              disabled={locked}
              aria-label={`${formatDate(key)}: ${choiceLabel(choice, key)}`}
              key={key}
              onClick={() => onToggle(key)}
            >
              <span>
                <span className="date-number">{day}</span>
                <span className="day-name">{new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date)}</span>
              </span>
              <span className="choice">{choice ? STATE_BY_KEY[choice].short : locked ? lockedLabel : "Tap to set"}</span>
            </button>
          );
        }

        return (
          <section className="month" key={label}>
            <h3>{label}</h3>
            <div className="weekdays" aria-hidden="true">
              <div className="weekday">Sun</div>
              <div className="weekday">Mon</div>
              <div className="weekday">Tue</div>
              <div className="weekday">Wed</div>
              <div className="weekday">Thu</div>
              <div className="weekday">Fri</div>
              <div className="weekday">Sat</div>
            </div>
            <div className="days">{cells}</div>
          </section>
        );
      })}
    </div>
  );
}
