import { describe, expect, it } from "vitest";

import { columnGroups, columnsFor, formatCell, notModelled, visibleRows, type CostColumn, type CostRow, type CostTable } from "@/lib/costing/cost-table";

const col = (key: string, group: string, over: Partial<CostColumn> = {}): CostColumn => ({ key, label: key, group, unit: "usd", modelled: true, basic: false, ...over });
const row = (id: string, parentId: string | null, over: Partial<CostRow> = {}): CostRow => ({ id, parentId, kind: "process", name: id, status: "ok", values: {}, ...over });
const display = { symbol: "$", fromUsd: 1 };

describe("columnsFor / columnGroups", () => {
  const table: CostTable = {
    currency: "USD", rows: [],
    columns: [col("a", "Variable Costs", { basic: true }), col("b", "Variable Costs"), col("c", "Period Costs", { modelled: false, note: "Not modelled: no SG&A rate is on file." }), col("d", "Variable Costs", { basic: true })],
  };

  it("the compact table has the basic columns, the dialog every one", () => {
    expect(columnsFor(table, "basic").map((c) => c.key)).toEqual(["a", "d"]);
    expect(columnsFor(table, "all").map((c) => c.key)).toEqual(["a", "b", "c", "d"]);
  });

  it("neighbouring columns of one group share a header cell", () => {
    expect(columnGroups(table.columns)).toEqual([{ group: "Variable Costs", span: 2 }, { group: "Period Costs", span: 1 }, { group: "Variable Costs", span: 1 }]);
  });

  it("lists the columns it cannot fill, with the reason", () => {
    expect(notModelled(table)).toEqual([{ label: "c", note: "Not modelled: no SG&A rate is on file." }]);
  });
});

describe("visibleRows", () => {
  const rows = [row("part", null, { kind: "part" }), row("m", "part"), row("g", "part", { kind: "group" }), row("p1", "g"), row("p2", "g")];

  it("walks the tree in order with its depth", () => {
    expect(visibleRows(rows, new Set()).map((r) => [r.id, r.depth, r.hasChildren])).toEqual([
      ["part", 0, true], ["m", 1, false], ["g", 1, true], ["p1", 2, false], ["p2", 2, false],
    ]);
  });

  it("hides what is under a collapsed row, and keeps the row itself", () => {
    expect(visibleRows(rows, new Set(["g"])).map((r) => r.id)).toEqual(["part", "m", "g"]);
    expect(visibleRows(rows, new Set(["part"])).map((r) => r.id)).toEqual(["part"]);
  });
});

describe("formatCell", () => {
  it("shows money in the display currency with three decimals, and an empty cell as a dash", () => {
    expect(formatCell(0.101168, col("m"), display)).toBe("$0.101");
    expect(formatCell(2, col("m"), { symbol: "₹", fromUsd: 83.5 })).toBe("₹167.000");
    expect(formatCell(null, col("m"), display)).toBe("—");
    expect(formatCell(undefined, col("m"), display)).toBe("—");
    expect(formatCell("", col("m"), display)).toBe("—");
  });

  it("formats each unit", () => {
    expect(formatCell(15.3, col("t", "x", { unit: "seconds" }), display)).toBe("15.3");
    expect(formatCell(0.038, col("k", "x", { unit: "kg" }), display)).toBe("0.038");
    expect(formatCell(46.34, col("u", "x", { unit: "percent" }), display)).toBe("46.34");
    expect(formatCell(1000, col("v", "x", { unit: "count" }), display)).toBe("1,000");
    expect(formatCell("SECC", col("s", "x", { unit: "text" }), display)).toBe("SECC");
    expect(formatCell(1.175, col("p", "x", { unit: "usd_per_kg" }), display)).toBe("$1.175");
  });

  it("never shows a zero for a number that is not one", () => {
    expect(formatCell("abc", col("m"), display)).toBe("—");
  });
});
