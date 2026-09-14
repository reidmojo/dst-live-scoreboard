export type SelectionMap = Record<string, string>;

export function editableDateKeys(
  value: unknown,
  allowedDates: ReadonlySet<string>,
  submittedSelections: SelectionMap,
) {
  const requestedDates = Array.isArray(value)
    ? value.map((date) => String(date ?? ""))
    : Object.keys(submittedSelections);

  return new Set(requestedDates.filter((date) => allowedDates.has(date)));
}

export function mergeSelectionUpdate(
  existingSelections: SelectionMap,
  submittedSelections: SelectionMap,
  datesBeingEdited: ReadonlySet<string>,
) {
  const merged = { ...existingSelections };

  for (const date of datesBeingEdited) {
    delete merged[date];
  }

  for (const [date, choice] of Object.entries(submittedSelections)) {
    if (datesBeingEdited.has(date)) merged[date] = choice;
  }

  return merged;
}
