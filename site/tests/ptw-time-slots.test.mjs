import assert from "node:assert/strict";
import test from "node:test";

import {
  PTW_DRAFT_DAYS,
  PTW_DRAFT_TIME_SLOT_KEYS,
  PTW_LEGACY_ANSWERED_TIME_SLOT_KEYS,
} from "../lib/ptw-time-slots.ts";

test("defines the agreed inclusive PDT draft-time windows", () => {
  const augustSunday = PTW_DRAFT_DAYS.find((day) => day.dateKey === "2026-08-30");
  const septemberSunday = PTW_DRAFT_DAYS.find((day) => day.dateKey === "2026-09-06");
  const monday = PTW_DRAFT_DAYS.find((day) => day.dateKey === "2026-09-07");

  assert.ok(augustSunday);
  assert.ok(septemberSunday);
  assert.ok(monday);
  assert.equal(augustSunday.windowLabel, "7:00 AM–8:00 PM PDT");
  assert.equal(augustSunday.slots.length, 27);
  assert.equal(augustSunday.slots[0].label, "7:00 AM");
  assert.equal(augustSunday.slots.at(-1).label, "8:00 PM");
  assert.equal(septemberSunday.label, "Sunday, September 6");
  assert.equal(septemberSunday.windowLabel, "7:00 AM–8:00 PM PDT");
  assert.equal(septemberSunday.slots.length, 27);
  assert.equal(septemberSunday.slots[0].label, "7:00 AM");
  assert.equal(septemberSunday.slots.at(-1).label, "8:00 PM");
  assert.equal(monday.windowLabel, "7:00 AM–8:00 PM PDT");
  assert.equal(monday.slots.length, 27);
  assert.equal(monday.slots[0].label, "7:00 AM");
  assert.equal(monday.slots.at(-1).label, "8:00 PM");
  assert.equal(PTW_DRAFT_TIME_SLOT_KEYS.length, 81);
  assert.equal(new Set(PTW_DRAFT_TIME_SLOT_KEYS).size, 81);
  assert.equal(PTW_LEGACY_ANSWERED_TIME_SLOT_KEYS.length, 63);
  assert.ok(PTW_LEGACY_ANSWERED_TIME_SLOT_KEYS.every((slotKey) => !slotKey.match(/T0[789]:/)));
});
