import { describe, expect, it } from "vitest";
import { ARROWS, arrowRows } from "./legend";

describe("arrow legend", () => {
  it("lists every kind, present or not, in a fixed order", () => {
    const rows = arrowRows(new Set(["inherits", "calls"]));
    expect(rows.map((r) => r.kind)).toEqual(Object.keys(ARROWS));
    expect(rows.filter((r) => r.present).map((r) => r.kind)).toEqual(["inherits", "calls"]);
    expect(rows.find((r) => r.kind === "composition")!.present).toBe(false);
  });

  it("names the relationships the way OOP does", () => {
    expect(ARROWS.inherits!.label).toBe("is-a: inheritance");
    expect(ARROWS.composition!.label).toBe("has-a: composition (owns)");
    expect(ARROWS.aggregation!.label).toBe("has-a: aggregation (shared)");
    expect(ARROWS.association!.label).toBe("uses-a: association");
  });
});
