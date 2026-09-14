export type PtwDraftTimeSlot = {
  key: string;
  label: string;
  minutes: number;
};

export type PtwDraftDay = {
  dateKey: string;
  label: string;
  shortLabel: string;
  windowLabel: string;
  slots: PtwDraftTimeSlot[];
};

function formatTime(minutes: number) {
  const hours24 = Math.floor(minutes / 60);
  const minutesPart = minutes % 60;
  const hours12 = hours24 % 12 || 12;
  const period = hours24 < 12 ? "AM" : "PM";
  return `${hours12}:${String(minutesPart).padStart(2, "0")} ${period}`;
}

function makeSlots(dateKey: string, startMinutes: number, endMinutes: number) {
  const slots: PtwDraftTimeSlot[] = [];
  for (let minutes = startMinutes; minutes <= endMinutes; minutes += 30) {
    const hours = String(Math.floor(minutes / 60)).padStart(2, "0");
    const minutePart = String(minutes % 60).padStart(2, "0");
    slots.push({
      key: `${dateKey}T${hours}:${minutePart}`,
      label: formatTime(minutes),
      minutes,
    });
  }
  return slots;
}

export const PTW_DRAFT_DAYS: PtwDraftDay[] = [
  {
    dateKey: "2026-08-30",
    label: "Sunday, August 30",
    shortLabel: "Sun, Aug 30",
    windowLabel: "7:00 AM–8:00 PM PDT",
    slots: makeSlots("2026-08-30", 7 * 60, 20 * 60),
  },
  {
    dateKey: "2026-09-06",
    label: "Sunday, September 6",
    shortLabel: "Sun, Sep 6",
    windowLabel: "7:00 AM–8:00 PM PDT",
    slots: makeSlots("2026-09-06", 7 * 60, 20 * 60),
  },
  {
    dateKey: "2026-09-07",
    label: "Monday, September 7",
    shortLabel: "Mon, Sep 7",
    windowLabel: "7:00 AM–8:00 PM PDT",
    slots: makeSlots("2026-09-07", 7 * 60, 20 * 60),
  },
];

export const PTW_DRAFT_TIME_SLOT_KEYS = PTW_DRAFT_DAYS.flatMap((day) => day.slots.map((slot) => slot.key));

// Responses saved before the 7:00 AM expansion implicitly answered the original
// 10:00 AM–8:00 PM windows. The API uses this list only when reading legacy rows.
export const PTW_LEGACY_ANSWERED_TIME_SLOT_KEYS = PTW_DRAFT_DAYS.flatMap((day) => (
  day.slots.filter((slot) => slot.minutes >= 10 * 60).map((slot) => slot.key)
));
