"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Choice = "yes" | "no";
type Selections = Record<string, Choice>;
type LeagueResponse = {
  name: string;
  selections: Selections;
  updatedAt?: string;
};

const SURVEY_START = "2026-08-08";
const SURVEY_END = "2026-09-07";
const API_PATH = "/fantasy_football/ptw_availability/api/responses";

const STATES: { key: Choice; short: string; label: string }[] = [
  { key: "yes", short: "Yes", label: "Available" },
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

function daysInMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function nextState(currentKey: Choice | undefined): Choice {
  if (!currentKey) return "yes";
  return currentKey === "yes" ? "no" : "yes";
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

function responseNames(label: string, names: string[]) {
  if (!names.length) return null;
  return (
    <div>
      <strong>{label}:</strong> {names.sort((a, b) => a.localeCompare(b)).join(", ")}
    </div>
  );
}

export default function PtwAvailabilityApp() {
  const [name, setName] = useState("");
  const [selections, setSelections] = useState<Selections>({});
  const [responses, setResponses] = useState<LeagueResponse[]>([]);
  const [status, setStatus] = useState("Loading PTW responses…");
  const [saving, setSaving] = useState(false);
  const [responsesLoaded, setResponsesLoaded] = useState(false);
  const selectionOwnerKey = useRef("");
  const selectionsAreDirty = useRef(false);

  const targetDates = useMemo(() => datesBetween(SURVEY_START, SURVEY_END), []);

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
      const response = await fetch(API_PATH, { cache: "no-store" });
      const body = await response.json() as { responses?: LeagueResponse[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Could not load responses.");
      setResponses(body.responses || []);
      setResponsesLoaded(true);
      setStatus((body.responses || []).length ? "PTW responses loaded." : "No PTW responses yet.");
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
      [dateKey]: nextState(current[dateKey]),
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
      const response = await fetch(API_PATH, {
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
      setStatus("Saved. PTW results are updated for everyone.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save response.");
    } finally {
      setSaving(false);
    }
  }

  function clearMine() {
    setSelections({});
    selectionsAreDirty.current = true;
    setStatus("Cleared your local picks. Hit Save to update the shared PTW results.");
  }

  const answeredCount = targetDates.filter((date) => selections[date]).length;
  const summaries = targetDates.map((dateKey) => {
    const summary = {
      dateKey,
      yes: [] as string[],
      no: [] as string[],
    };

    for (const response of responses) {
      const choice = response.selections[dateKey];
      if (choice && summary[choice]) summary[choice].push(response.name);
    }

    return summary;
  }).sort((a, b) => (
    b.yes.length - a.yes.length ||
    a.no.length - b.no.length ||
    a.dateKey.localeCompare(b.dateKey)
  ));

  const bestYes = summaries[0]?.yes.length || 0;
  const person = normalizeName(name);
  const existingResponse = responses.find((response) => samePerson(response.name, person));
  const nameHint = !responsesLoaded
    ? "Loading saved PTW responses…"
    : existingResponse
      ? `Editing ${existingResponse.name}’s saved response. Change any date and save again.`
      : person
        ? "No saved response with that name yet."
        : "Your saved response updates this league’s shared results.";

  return (
    <main className="shell">
      <header className="hero-grid">
        <section className="hero-card" aria-labelledby="page-title">
          <p className="eyebrow">PTW draft availability</p>
          <h1 id="page-title">Yes or no. That’s the whole bit.</h1>
          <p>
            Enter your name, tap each date from August 8 through September 7, then save.
            Every calendar day is selectable, and each date is simply yes or no.
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
            <div className="legend-item"><span className="swatch yes" /> Yes — available</div>
            <div className="legend-item"><span className="swatch no" /> No — not available</div>
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
                  <span className="result-date">No PTW responses yet</span>
                </div>
                <p className="hint">Save your picks to start this league’s rollup.</p>
              </article>
            ) : summaries.map((summary) => {
              const isBest = summary.yes.length === bestYes;
              const total = Math.max(responses.length, 1);
              return (
                <article
                  className={`result-card ${isBest ? "best" : ""}`}
                  key={summary.dateKey}
                  style={{
                    "--yes-count": `${Math.max(summary.yes.length, 0.001)}fr`,
                    "--no-count": `${Math.max(summary.no.length, 0.001)}fr`,
                  } as React.CSSProperties}
                >
                  <div className="result-top">
                    <span className="result-date">{formatDate(summary.dateKey, "short")}</span>
                    <span className="result-score">{summary.yes.length}/{total} yes</span>
                  </div>
                  <div className="meter binary" aria-hidden="true"><span /><span /></div>
                  <div className="count-grid">
                    <span>Yes: {summary.yes.length}</span>
                    <span>No: {summary.no.length}</span>
                  </div>
                  <div className="names">
                    {responseNames("Yes", summary.yes)}
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

          const choice = selections[key];
          const state = choice ? STATE_BY_KEY[choice] : undefined;
          const date = new Date(`${key}T12:00:00`);
          cells.push(
            <button
              type="button"
              className={`day ${choice || ""}`.trim()}
              disabled={locked}
              aria-label={`${formatDate(key)}: ${state?.label || "not answered"}`}
              key={key}
              onClick={() => onToggle(key)}
            >
              <span>
                <span className="date-number">{day}</span>
                <span className="day-name">{new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date)}</span>
              </span>
              <span className="choice">{state ? state.short : locked ? lockedLabel : "Tap yes/no"}</span>
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
