import assert from "node:assert/strict";
import test from "node:test";

import {
  editableDateKeys,
  mergeSelectionUpdate,
} from "../lib/availability/editing.ts";

test("replaces edited dates while preserving saved dates outside the editable window", () => {
  const existing = {
    "2026-08-08": "remote",
    "2026-08-17": "no",
    "2026-08-18": "possible",
  };
  const submitted = {
    "2026-08-17": "in_person",
  };
  const editableDates = new Set(["2026-08-17", "2026-08-18"]);

  assert.deepEqual(mergeSelectionUpdate(existing, submitted, editableDates), {
    "2026-08-08": "remote",
    "2026-08-17": "in_person",
  });
});

test("keeps omitted saved dates safe for clients that do not send an editable-date list", () => {
  const allowedDates = new Set(["2026-08-08", "2026-08-17", "2026-08-18"]);
  const submitted = { "2026-08-18": "remote" };
  const editableDates = editableDateKeys(undefined, allowedDates, submitted);

  assert.deepEqual([...editableDates], ["2026-08-18"]);
  assert.deepEqual(
    mergeSelectionUpdate(
      { "2026-08-08": "no", "2026-08-18": "possible" },
      submitted,
      editableDates,
    ),
    { "2026-08-08": "no", "2026-08-18": "remote" },
  );
});

test("allows an explicit editable window to clear dates intentionally", () => {
  const allowedDates = new Set(["2026-08-08", "2026-08-09"]);
  const editableDates = editableDateKeys(
    ["2026-08-08", "2026-08-09", "outside-survey"],
    allowedDates,
    {},
  );

  assert.deepEqual(
    mergeSelectionUpdate(
      { "2026-08-08": "yes", "2026-08-09": "no" },
      {},
      editableDates,
    ),
    {},
  );
});
