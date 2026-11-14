// Unit tests for the routing stage. layout.test.ts asserts the whole drawing stays readable; these
// pin the three decisions that produce that result, each on a board small enough to reason about.

import { describe, expect, it } from "vitest";
import type { Box } from "./geometry";
import { routeEdges, type Route } from "./route";
import type { SeedRelation } from "./model";

const box = (cx: number, cy: number, w = 100, h = 40): Box => ({ cx, cy, w, h });
const rel = (src: string, dst: string, kind = "calls"): SeedRelation => ({
  src,
  dst,
  kind,
  lazy: false,
});
const key = (r: SeedRelation): string => `${r.src}>${r.dst}`;

function run(boxes: Record<string, Box>, rels: SeedRelation[]): Map<string, Route> {
  return routeEdges(new Map(Object.entries(boxes)), rels, key, () => [0, 0]);
}

/** The y of each horizontal run in a route. */
function runYs(route: Route): number[] {
  const out: number[] = [];
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1]!;
    const b = route.points[i]!;
    if (Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) > 1) out.push(a.y);
  }
  return out;
}

describe("routeEdges", () => {
  it("lets two runs that never overlap share one height, so a gutter stays shallow", () => {
    const rels = [rel("A", "B"), rel("C", "D")];
    const routes = run(
      { A: box(0, 0), B: box(100, 200), C: box(1000, 0), D: box(1100, 200) },
      rels,
    );
    expect(runYs(routes.get("A>B")!)[0]).toBe(runYs(routes.get("C>D")!)[0]);
  });

  it("separates two runs that do overlap by enough to tell them apart", () => {
    const rels = [rel("A", "B"), rel("C", "D")];
    const routes = run({ A: box(0, 0), B: box(500, 200), C: box(100, 0), D: box(600, 200) }, rels);
    const gap = Math.abs(runYs(routes.get("A>B")!)[0]! - runYs(routes.get("C>D")!)[0]!);
    expect(gap).toBeGreaterThanOrEqual(15);
  });

  it("takes a connector spanning two rows through a column, not around the row", () => {
    // A wide class fills the middle row where the straight line would go.
    const wide = box(200, 200, 400, 40);
    const routes = run({ A: box(50, 0), W: wide, Z: box(50, 400) }, [rel("A", "Z"), rel("A", "W")]);
    const pts = routes.get("A>Z")!.points;
    // It must cross the middle row somewhere clear of the wide class...
    const crossesRow = pts.some(
      (p, i) => i > 0 && Math.abs(pts[i - 1]!.x - p.x) < 0.5 && (p.x < 0 || p.x > 400),
    );
    expect(crossesRow).toBe(true);
    // ...and never travel horizontally inside that row, which is what a sweep looks like.
    expect(runYs(routes.get("A>Z")!).filter((y) => y > 180 && y < 220)).toEqual([]);
  });

  it("joins several connectors arriving at one class into a single run", () => {
    const rels = [rel("A", "Z"), rel("B", "Z"), rel("C", "Z")];
    const routes = run(
      { A: box(0, 0), B: box(150, 0), C: box(400, 0), Z: box(240, 200) },
      rels,
    );
    const ys = rels.map((r) => runYs(routes.get(key(r))!)[0]);
    expect(new Set(ys).size).toBe(1);
  });

  it("keeps connectors where they were when an unrelated class in the row moves", () => {
    // E is the deepest class of the top row, so it alone decides where that row ends. Nudging it
    // used to move every run in the gutter below, including A>B and C>D, which never pass it.
    // F>D ties E into the same drawing as A..D: rows are worked out per connected group.
    const rels = [rel("A", "B"), rel("C", "D"), rel("E", "F"), rel("F", "D")];
    const boxes = (eDown: number) => ({
      A: box(0, 0),
      C: box(200, 0),
      E: box(900, eDown, 100, 80),
      B: box(100, 300),
      D: box(300, 300),
      F: box(900, 300),
    });
    const before = run(boxes(0), rels);
    // E may drift up to half the shorter class (A and C, 40px tall) and stay in the row.
    for (const dy of [8, 18]) {
      const after = run(boxes(dy), rels);
      expect(after.get("A>B")!.points).toEqual(before.get("A>B")!.points);
      expect(after.get("C>D")!.points).toEqual(before.get("C>D")!.points);
    }
  });

  it("keeps a class nudged off-centre in its row, so the drawing does not grow a row", () => {
    // 30px is past the old 12px tolerance but well inside the 80px class: still the same row, so
    // A>B crosses one gutter, not two.
    const rels = [rel("A", "B"), rel("E", "F"), rel("F", "B")];
    const routes = run(
      { A: box(0, 0, 100, 80), E: box(600, 30, 100, 80), B: box(100, 300), F: box(600, 300) },
      rels,
    );
    expect(runYs(routes.get("A>B")!)).toHaveLength(1);
  });
});
