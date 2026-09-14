"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PTW_DRAFT_DAYS } from "@/lib/ptw-time-slots";

type UnavailableSlots = Record<string, true>;
type AnsweredSlots = Record<string, true>;
type LeagueResponse = {
  name: string;
  unavailableSlots: string[];
  answeredSlots: string[];
  updatedAt?: string;
};
type SlotSummary = {
  day: (typeof PTW_DRAFT_DAYS)[number];
  slot: (typeof PTW_DRAFT_DAYS)[number]["slots"][number];
  availableNames: string[];
  unavailableNames: string[];
  noResponseNames: string[];
};
type AvailabilityWindow = {
  day: SlotSummary["day"];
  startSlot: SlotSummary["slot"];
  endSlot: SlotSummary["slot"];
  slotCount: number;
  availableNames: string[];
  unavailableNames: string[];
  noResponseNames: string[];
};

const API_PATH = "/fantasy_football/ptw_time_availability/api/responses";
const ALL_SLOTS = PTW_DRAFT_DAYS.flatMap((day) => day.slots.map((slot) => ({ day, slot })));

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function samePerson(a: string, b: string) {
  return normalizeName(a).toLowerCase() === normalizeName(b).toLowerCase();
}

function toSlotMap(slotKeys: string[]) {
  return Object.fromEntries(slotKeys.map((slotKey) => [slotKey, true])) as UnavailableSlots;
}

function sortedNames(names: string[]) {
  return [...names].sort((a, b) => a.localeCompare(b));
}

function responseNames(label: string, names: string[]) {
  if (!names.length) return null;
  return (
    <div>
      <strong>{label}:</strong> {sortedNames(names).join(", ")}
    </div>
  );
}

function availabilitySignature(summary: SlotSummary) {
  return [summary.availableNames, summary.unavailableNames, summary.noResponseNames]
    .map((names) => sortedNames(names).join("\u0000"))
    .join("\u0001");
}

function availabilityLevel(summary: SlotSummary, totalResponses: number) {
  const answeredCount = summary.availableNames.length + summary.unavailableNames.length;
  if (!totalResponses || !answeredCount) return "unknown";
  const share = summary.availableNames.length / totalResponses;
  if (share === 1) return "full";
  if (share >= 0.75) return "high";
  if (share >= 0.5) return "medium";
  if (share > 0) return "low";
  return "none";
}

function slotTooltip(summary: SlotSummary) {
  const names = (values: string[]) => values.length ? sortedNames(values).join(", ") : "None";
  return [
    `${summary.day.label} at ${summary.slot.label} PDT`,
    `Available: ${names(summary.availableNames)}`,
    `Unavailable: ${names(summary.unavailableNames)}`,
    `No response: ${names(summary.noResponseNames)}`,
  ].join("\n");
}

function windowTimeLabel(window: AvailabilityWindow) {
  if (window.startSlot.key === window.endSlot.key) return `${window.startSlot.label} PDT`;
  return `${window.startSlot.label}–${window.endSlot.label} PDT`;
}

export default function PtwTimeAvailabilityApp() {
  const [name, setName] = useState("");
  const [unavailable, setUnavailable] = useState<UnavailableSlots>({});
  const [answered, setAnswered] = useState<AnsweredSlots>({});
  const [responses, setResponses] = useState<LeagueResponse[]>([]);
  const [status, setStatus] = useState("Loading PTW time responses…");
  const [saving, setSaving] = useState(false);
  const [responsesLoaded, setResponsesLoaded] = useState(false);
  const [inspectedSlotKey, setInspectedSlotKey] = useState<string | null>(null);
  const selectionOwnerKey = useRef("");
  const selectionsAreDirty = useRef(false);

  useEffect(() => {
    void refreshResponses();
  }, []);

  useEffect(() => {
    const person = normalizeName(name);
    const personKey = person.toLowerCase();

    if (!person || !responsesLoaded) {
      setUnavailable({});
      setAnswered({});
      selectionOwnerKey.current = personKey;
      selectionsAreDirty.current = false;
      return;
    }

    if (personKey === selectionOwnerKey.current && selectionsAreDirty.current) return;

    const existing = responses.find((response) => samePerson(response.name, person));
    setUnavailable(toSlotMap(existing?.unavailableSlots || []));
    setAnswered(toSlotMap(existing?.answeredSlots || PTW_DRAFT_DAYS.flatMap((day) => day.slots.map((slot) => slot.key))));
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
      setStatus((body.responses || []).length ? "PTW time responses loaded." : "No PTW time responses yet.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load responses.");
    }
  }

  function toggleSlot(slotKey: string) {
    const person = normalizeName(name);
    if (!person) {
      setStatus("Add your name first.");
      return;
    }

    setUnavailable((current) => {
      if (!answered[slotKey]) return current;
      const next = { ...current };
      if (next[slotKey]) delete next[slotKey];
      else next[slotKey] = true;
      return next;
    });
    setAnswered((current) => ({ ...current, [slotKey]: true }));
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
        body: JSON.stringify({
          name: person,
          unavailableSlots: Object.keys(unavailable),
          answeredSlots: Object.keys(answered),
        }),
      });
      const body = await response.json() as { response?: LeagueResponse; error?: string };
      if (!response.ok || !body.response) throw new Error(body.error || "Could not save response.");

      setResponses((current) => {
        const withoutCurrent = current.filter((item) => !samePerson(item.name, body.response!.name));
        return [body.response!, ...withoutCurrent];
      });
      selectionsAreDirty.current = false;
      setStatus("Saved. PTW time results are updated for everyone.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save response.");
    } finally {
      setSaving(false);
    }
  }

  function makeAllAvailable() {
    setUnavailable({});
    setAnswered(toSlotMap(ALL_SLOTS.map(({ slot }) => slot.key)));
    selectionsAreDirty.current = true;
    setStatus("All of your slots are available. Hit Save to update the shared results.");
  }

  const availability = useMemo(() => {
    const summaries = ALL_SLOTS.map(({ day, slot }): SlotSummary => {
      const availableNames: string[] = [];
      const unavailableNames: string[] = [];
      const noResponseNames: string[] = [];

      for (const response of responses) {
        if (!response.answeredSlots.includes(slot.key)) noResponseNames.push(response.name);
        else if (response.unavailableSlots.includes(slot.key)) unavailableNames.push(response.name);
        else availableNames.push(response.name);
      }

      return {
        day,
        slot,
        availableNames,
        unavailableNames,
        noResponseNames,
      };
    });
    const summaryByKey = new Map(summaries.map((summary) => [summary.slot.key, summary]));
    const windows: AvailabilityWindow[] = [];

    for (const day of PTW_DRAFT_DAYS) {
      let current: AvailabilityWindow | null = null;
      let currentSignature = "";
      for (const slot of day.slots) {
        const summary = summaryByKey.get(slot.key)!;
        const signature = availabilitySignature(summary);
        if (current && signature === currentSignature) {
          current.endSlot = slot;
          current.slotCount += 1;
          continue;
        }
        current = {
          day,
          startSlot: slot,
          endSlot: slot,
          slotCount: 1,
          availableNames: summary.availableNames,
          unavailableNames: summary.unavailableNames,
          noResponseNames: summary.noResponseNames,
        };
        currentSignature = signature;
        windows.push(current);
      }
    }

    const bestWindows = windows
      .sort((a, b) => (
        b.availableNames.length - a.availableNames.length ||
        a.noResponseNames.length - b.noResponseNames.length ||
        b.slotCount - a.slotCount ||
        a.day.dateKey.localeCompare(b.day.dateKey) ||
        a.startSlot.minutes - b.startSlot.minutes
      ))
      .slice(0, 6);

    return { summaries, summaryByKey, bestWindows };
  }, [responses]);

  const inspectedSummary = (
    inspectedSlotKey ? availability.summaryByKey.get(inspectedSlotKey) : undefined
  ) || availability.summaryByKey.get(availability.bestWindows[0]?.startSlot.key || "") || availability.summaries[0];
  const person = normalizeName(name);
  const existingResponse = responses.find((response) => samePerson(response.name, person));
  const unavailableCount = Object.keys(unavailable).length;
  const unansweredCount = ALL_SLOTS.length - Object.keys(answered).length;
  const nameHint = !responsesLoaded
    ? "Loading saved PTW time responses…"
    : existingResponse
        ? `Editing ${existingResponse.name}’s saved response. New morning slots start gray until they answer them.`
        : person
          ? "No saved time response with that name yet. Everything starts available."
          : "Enter your name to unlock the time slots.";

  return (
    <main className="shell">
      <header className="hero-grid">
        <section className="hero-card" aria-labelledby="page-title">
          <p className="eyebrow">PTW draft time availability · all times PDT</p>
          <h1 id="page-title">Green unless it doesn’t work.</h1>
          <p>
            <strong>Every time below is Pacific Daylight Time (PDT).</strong> New participants
            start available. For returning participants, the added 7:00–9:30 AM slots start gray:
            tap once for available, then again if unavailable.
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
            <button className="button secondary" type="button" onClick={makeAllAvailable} disabled={!person || !responsesLoaded}>
              Make all available
            </button>
          </div>

          <div className="legend" aria-label="Time availability options">
            <div className="legend-item"><span className="swatch yes" /> Green — available by default</div>
            <div className="legend-item"><span className="swatch no" /> Red — unavailable</div>
            <div className="legend-item"><span className="swatch unanswered" /> Gray — no response</div>
          </div>
        </aside>
      </header>

      <section className="status-bar" role="status" aria-live="polite">
        <span>{status}</span>
        <button type="button" className="text-button" onClick={refreshResponses}>Refresh results</button>
      </section>

      <div className="content-grid time-content-grid">
        <section className="calendar-card" aria-labelledby="time-grid-title">
          <div className="section-title">
            <h2 id="time-grid-title">Possible start times</h2>
            <span className="status-pill">All times PDT · {unavailableCount} unavailable · {unansweredCount} unanswered</span>
          </div>
          <div className="time-columns">
            {PTW_DRAFT_DAYS.map((day) => (
              <section className="time-day" key={day.dateKey}>
                <div className="time-day-heading">
                  <h3>{day.label}</h3>
                  <span>{day.windowLabel}</span>
                </div>
                <div className="time-slot-list">
                  {day.slots.map((slot) => {
                    const isAnswered = Boolean(answered[slot.key]);
                    const isUnavailable = Boolean(unavailable[slot.key]);
                    const slotState = !isAnswered ? "unanswered" : isUnavailable ? "unavailable" : "available";
                    return (
                      <button
                        type="button"
                        className={`time-slot ${slotState}`}
                        disabled={!person || !responsesLoaded}
                        aria-pressed={!isAnswered ? "mixed" : isUnavailable}
                        aria-label={`${day.label} at ${slot.label} PDT: ${slotState === "unanswered" ? "no response" : slotState}`}
                        key={slot.key}
                        onClick={() => toggleSlot(slot.key)}
                      >
                        <span>{slot.label} PDT</span>
                        <strong>{!isAnswered ? person && responsesLoaded ? "No response" : person ? "Loading" : "Add name" : isUnavailable ? "No" : "Available"}</strong>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </section>

        <section className="results-card time-results-card" aria-labelledby="results-title">
          <div className="section-title">
            <div>
              <h2 id="results-title">Best availability periods</h2>
              <p className="hint">Hover, focus, or tap any heatmap block to see exactly who can and cannot make it.</p>
            </div>
            <span className="status-pill">{responses.length} saved {responses.length === 1 ? "response" : "responses"}</span>
          </div>

          {!responses.length ? (
            <article className="result-card">
              <div className="result-top"><span className="result-date">No time responses yet</span></div>
              <p className="hint">Save your response to start the league heatmap.</p>
            </article>
          ) : (
            <div className="best-window-grid">
              {availability.bestWindows.map((window) => (
                <article className="best-window" key={`${window.day.dateKey}-${window.startSlot.key}`}>
                  <span>{window.day.shortLabel}</span>
                  <strong>{windowTimeLabel(window)}</strong>
                  <small>{window.availableNames.length}/{responses.length} available throughout</small>
                  <div className="names">
                    {responseNames("Available", window.availableNames)}
                    {responseNames("Unavailable", window.unavailableNames)}
                    {responseNames("No response", window.noResponseNames)}
                  </div>
                </article>
              ))}
            </div>
          )}

          <div className="heatmap-legend" aria-label="Heatmap color legend">
            <span><i className="heatmap-sample full" /> Everyone available</span>
            <span><i className="heatmap-sample medium" /> Mixed availability</span>
            <span><i className="heatmap-sample none" /> No one available</span>
            <span><i className="heatmap-sample unknown" /> No responses yet</span>
          </div>

          <div className="availability-heatmaps">
            {PTW_DRAFT_DAYS.map((day) => {
              const daySummaries = day.slots.map((slot) => availability.summaryByKey.get(slot.key)!);
              const middleSlot = day.slots[Math.floor((day.slots.length - 1) / 2)];
              return (
                <section className="heatmap-day" key={day.dateKey}>
                  <div className="heatmap-day-title">
                    <h3>{day.label}</h3>
                    <span>{day.windowLabel}</span>
                  </div>
                  <div className="heatmap-scroll">
                    <div
                      className="heatmap-track"
                      style={{ "--slot-count": day.slots.length } as React.CSSProperties}
                    >
                      {daySummaries.map((summary) => (
                        <button
                          type="button"
                          className={`heatmap-cell ${availabilityLevel(summary, responses.length)} ${inspectedSummary?.slot.key === summary.slot.key ? "active" : ""}`}
                          key={summary.slot.key}
                          title={slotTooltip(summary)}
                          aria-label={slotTooltip(summary).replaceAll("\n", ". ")}
                          onClick={() => setInspectedSlotKey(summary.slot.key)}
                          onFocus={() => setInspectedSlotKey(summary.slot.key)}
                          onMouseEnter={() => setInspectedSlotKey(summary.slot.key)}
                        ><span className="sr-only">{summary.slot.label} PDT</span></button>
                      ))}
                    </div>
                    <div className="heatmap-axis" aria-hidden="true">
                      <span>{day.slots[0].label}</span>
                      <span>{middleSlot.label}</span>
                      <span>{day.slots.at(-1)?.label}</span>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>

          {inspectedSummary ? (
            <article className="heatmap-detail" aria-live="polite">
              <div className="result-top">
                <span className="result-date">{inspectedSummary.day.label} · {inspectedSummary.slot.label} PDT</span>
                <span className="result-score">{inspectedSummary.availableNames.length}/{responses.length} available · {inspectedSummary.noResponseNames.length} no response</span>
              </div>
              <div className="names">
                {responseNames("Available", inspectedSummary.availableNames)}
                {responseNames("Unavailable", inspectedSummary.unavailableNames)}
                {responseNames("No response", inspectedSummary.noResponseNames)}
              </div>
            </article>
          ) : null}
        </section>
      </div>
    </main>
  );
}
