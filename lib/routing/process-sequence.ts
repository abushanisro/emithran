// Ordering for the Cost tab's "Direct Process Costs" list, which shows two
// different kinds of row in one sequence: operations already saved to
// process_cost_records, and engine-computed lines for this part that are not
// saved yet (or could not be priced).
//
// Both kinds have to interleave by REAL manufacturing sequence rather than by
// save status — a saved Deburr must not render above an unsaved Laser Cut just
// because it happens to be persisted.
//
// This replaces a hardcoded machine-class -> rank literal in page.tsx that
// listed 8 classes and gave everything else rank 99, i.e. sorted it last.
// Eleven real registered engine classes were missing from it — laser_punch,
// plasma_cut, plasma_punch, oxyfuel_cut, shear, router_2axis, standard_press,
// tandem_press, progressive_die_press and roll_bending_2/3/4 — so a part cut
// on any of them rendered its CUTTING operation dead last, after inspection.
// Confirmed live: process_cost_records held op_nbr 10 Laser Punch, 20 Bend
// Brake, 30 Deslag, 40 CMM Inspection (correct), while the UI displayed Bend
// Brake, Deslag, CMM Inspection, Laser Punch — and relabelled them 10/20/30/40
// by render position, so the screen contradicted the database.
//
// Nothing here encodes manufacturing knowledge. Both orderings it consumes are
// already real:
//   - a saved row carries the op_nbr writeProcessLinesAsRecords assigned it,
//     in the order the cost engine emitted the route;
//   - an unsaved line's position comes from the engine's own processLines
//     array for this part.
// A class this module has never heard of therefore orders correctly by
// construction, which is exactly what the rank table could not do.

export interface SequencedStoredRow {
  opNbr?: number | null;
  machineClass?: string | null;
  operation?: string | null;
}

export interface SequencedEngineLine {
  process: string;
  machineClass?: string | null;
}

export type ProcessSequenceRow<S, L> =
  | { kind: 'stored'; item: S; opNbr: number | null }
  | { kind: 'missing'; item: L; opNbr: null };

/**
 * Position of a row within the engine's own line order.
 *
 * Matched on machineClass first: it is the stable identifier both sides agree
 * on. A saved row stores the CATALOG operation name ("Bend Brake", "Deslag",
 * "CMM Inspection") while the engine emits its own process label ("Press
 * Brake", "Deburring", "Inspection") for the very same class, so name equality
 * is not a reliable join — the same duality already documented on the Workflow
 * Builder restore path. Name is only a fallback for rows with no class.
 *
 * Returns -1 when the row does not correspond to any engine line at all (a
 * manually added operation, say) — such a row keeps its saved position and is
 * never reordered against a sequence it is not part of.
 */
function engineIndexOf(
  engineLines: readonly SequencedEngineLine[],
  machineClass: string | null | undefined,
  name: string | null | undefined,
): number {
  if (machineClass) {
    const byClass = engineLines.findIndex((l) => l.machineClass === machineClass);
    if (byClass >= 0) return byClass;
  }
  if (name) {
    const lowered = name.trim().toLowerCase();
    const byName = engineLines.findIndex((l) => l.process.trim().toLowerCase() === lowered);
    if (byName >= 0) return byName;
  }
  return -1;
}

// Saved rows are spaced far apart on the sort axis so an unsaved line can be
// slotted between two of them without ever displacing either.
const STORED_STRIDE = 1000;

/**
 * Merges saved rows and unsaved engine lines into one real-sequence list.
 *
 * Saved rows hold their persisted op_nbr order. Each unsaved line is anchored
 * immediately after the last saved row that precedes it in the engine's own
 * order, so it lands where the engine says the operation actually happens.
 */
export function sequenceProcessRows<S extends SequencedStoredRow, L extends SequencedEngineLine>(
  stored: readonly S[],
  missing: readonly L[],
  engineLines: readonly SequencedEngineLine[],
): ProcessSequenceRow<S, L>[] {
  // Persisted order. A row with no op_nbr keeps its incoming relative position
  // rather than being coerced to 0, which would jump it to the front.
  const storedSorted = stored
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const ao = a.item.opNbr ?? null;
      const bo = b.item.opNbr ?? null;
      if (ao === null && bo === null) return a.i - b.i;
      if (ao === null) return 1;
      if (bo === null) return -1;
      return ao - bo || a.i - b.i;
    })
    .map((e) => e.item);

  const storedEngineIndex = storedSorted.map((s) =>
    engineIndexOf(engineLines, s.machineClass, s.operation),
  );

  const keyed: { key: number; tie: number; row: ProcessSequenceRow<S, L> }[] = [];

  storedSorted.forEach((item, position) => {
    keyed.push({
      key: (position + 1) * STORED_STRIDE,
      tie: keyed.length,
      row: { kind: 'stored', item, opNbr: item.opNbr ?? null },
    });
  });

  missing.forEach((item) => {
    const ei = engineIndexOf(engineLines, item.machineClass, item.process);

    if (ei < 0) {
      // Not part of the engine sequence at all — append rather than guess.
      keyed.push({
        key: (storedSorted.length + 1) * STORED_STRIDE,
        tie: keyed.length,
        row: { kind: 'missing', item, opNbr: null },
      });
      return;
    }

    // Last saved row that the engine puts BEFORE this line.
    let anchor = -1;
    for (let p = 0; p < storedSorted.length; p++) {
      const sei = storedEngineIndex[p];
      if (sei !== undefined && sei >= 0 && sei < ei) anchor = p;
    }

    keyed.push({
      // anchor -1 => key below the first saved row (STORED_STRIDE), so it
      // renders ahead of everything saved, still ordered among its peers.
      key: (anchor + 1) * STORED_STRIDE + (ei + 1),
      tie: keyed.length,
      row: { kind: 'missing', item, opNbr: null },
    });
  });

  return keyed.sort((a, b) => a.key - b.key || a.tie - b.tie).map((e) => e.row);
}
