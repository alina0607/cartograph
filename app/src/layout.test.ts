// Readability invariants for a drawn board.
//
// Correct-but-unreadable is the failure mode that matters here, and it is invisible to a unit
// test that only checks coordinates: boxes can all be inside the canvas and still sit on top of
// one another; every connector can start and end in the right place while its middle run crosses
// three classes; and a dozen connectors can each be individually correct while running so close
// together that no reader can follow one. All three shipped and were only found by eye. These
// assert what a reader actually depends on, against shapes that break layouts, so any future
// change to ranking, packing or routing has to keep them.

import { describe, expect, it } from "vitest";
import { edgeKey } from "./edge";
import { dims, type Box } from "./geometry";
import { initialPositions } from "./layout";
import { routeEdges } from "./route";
import type { Point, Seed, SeedNode, SeedRelation } from "./model";

function node(name: string, attrs = 3): SeedNode {
  return {
    key: `m/${name}.py#${name}`,
    name,
    module: `m/${name}.py`,
    kind: "class",
    lang: "python",
    doc: "",
    attributes: Array.from({ length: attrs }, (_, i) => [`field_${i}`, "str"] as [string, string]),
    methods: [],
  };
}

function rel(src: string, dst: string, kind: string): SeedRelation {
  return { src: `m/${src}.py#${src}`, dst: `m/${dst}.py#${dst}`, kind, lazy: false };
}

// Shapes that break layouts: a wide fan, a deep chain, a diamond, and an island.
function board(): Seed {
  const names = [
    "Root", "FanA", "FanB", "FanC", "FanD", "FanE",
    "ChainA", "ChainB", "ChainC", "ChainD",
    "DiamondTop", "DiamondL", "DiamondR", "DiamondBottom",
    "Lonely",
  ];
  return {
    version: 1,
    nodes: names.map((n, i) => node(n, 2 + (i % 5))), // varied heights on purpose
    relations: [
      ...["FanA", "FanB", "FanC", "FanD", "FanE"].map((k) => rel("Root", k, "composition")),
      rel("ChainA", "ChainB", "inherits"),
      rel("ChainB", "ChainC", "inherits"),
      rel("ChainC", "ChainD", "inherits"),
      rel("DiamondTop", "DiamondL", "association"),
      rel("DiamondTop", "DiamondR", "association"),
      rel("DiamondL", "DiamondBottom", "aggregation"),
      rel("DiamondR", "DiamondBottom", "aggregation"),
      // Spans more than one row, so it has to pass THROUGH a row rather than sweep around it.
      rel("Root", "DiamondBottom", "dependency"),
    ],
  };
}

function boxesOf(seed: Seed): Map<string, Box> {
  const pos = initialPositions(seed);
  const out = new Map<string, Box>();
  for (const n of seed.nodes) {
    const d = dims(n);
    const a = pos[n.key]!;
    out.set(n.key, { cx: a.x + d.w / 2, cy: a.y + d.h / 2, w: d.w, h: d.h });
  }
  return out;
}

const overlaps = (a: Box, b: Box): boolean =>
  Math.abs(a.cx - b.cx) * 2 < a.w + b.w && Math.abs(a.cy - b.cy) * 2 < a.h + b.h;

/** Does a segment's interior pass through the box? Endpoints touching a border are fine. */
function cuts(a: Point, b: Point, box: Box): boolean {
  const inset = 4; // a connector legitimately meets its own box's border
  const l = box.cx - box.w / 2 + inset;
  const r = box.cx + box.w / 2 - inset;
  const t = box.cy - box.h / 2 + inset;
  const bo = box.cy + box.h / 2 - inset;
  // Sampled rather than solved: the drawn corners are rounded, so every piece is short and
  // sampling cannot be fooled by a path that only dips into a box briefly.
  for (let s = 1; s < 10; s++) {
    const x = a.x + ((b.x - a.x) * s) / 10;
    const y = a.y + ((b.y - a.y) * s) / 10;
    if (x > l && x < r && y > t && y < bo) return true;
  }
  return false;
}

/** Horizontal runs of a route — what a reader follows across the drawing. */
function horizontals(points: Point[]): Array<{ y: number; x0: number; x1: number }> {
  const out: Array<{ y: number; x0: number; x1: number }> = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) > 1) {
      out.push({ y: a.y, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x) });
    }
  }
  return out;
}

describe("a drawn board stays readable", () => {
  const seed = board();
  const boxes = boxesOf(seed);
  const routes = routeEdges(boxes, seed.relations, edgeKey, () => [0, 0]);

  it("places every class without overlapping another", () => {
    const keys = [...boxes.keys()];
    const hits: string[] = [];
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        if (overlaps(boxes.get(keys[i]!)!, boxes.get(keys[j]!)!)) {
          hits.push(`${keys[i]} / ${keys[j]}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("routes every relationship without crossing an unrelated class", () => {
    const crossings: string[] = [];
    for (const r of seed.relations) {
      const pts = routes.get(edgeKey(r))!.points;
      for (const [key, box] of boxes) {
        if (key === r.src || key === r.dst) continue;
        for (let i = 1; i < pts.length; i++) {
          if (cuts(pts[i - 1]!, pts[i]!, box)) {
            crossings.push(`${r.src} -> ${r.dst} crosses ${key}`);
            break;
          }
        }
      }
    }
    expect(crossings).toEqual([]);
  });

  // One source, one kind, five children: five near-parallel runs are unreadable, so the run
  // leaving the source is shared and the path branches only where it must. Both halves matter —
  // the shared run really is shared (one height, not five within a few pixels, which reads as
  // fraying) and each child still gets its own branch.
  it("merges a same-kind fan into one shared run with a branch per child", () => {
    const kids = ["FanA", "FanB", "FanC", "FanD", "FanE"];
    const routeFor = (k: string): Point[] =>
      routes.get(edgeKey(rel("Root", k, "composition")))!.points;
    const firstRun = kids.map((k) => horizontals(routeFor(k))[0]!);
    expect(new Set(firstRun.map((h) => h.y.toFixed(2))).size).toBe(1);
    const arrival = kids.map((k) => {
      const pts = routeFor(k);
      return pts[pts.length - 1]!.x.toFixed(2);
    });
    expect(new Set(arrival).size).toBe(kids.length);
  });

  // The failure this catches is not a wrong line but two right ones a reader cannot separate:
  // while routing was decided per pair of boxes, connectors from different sources picked their
  // height independently and piled into the same gap — on the real board, 103 such pairs, two of
  // them exactly on top of each other for 1001px.
  it("never runs two unrelated connectors side by side in the same gap", () => {
    const runs = seed.relations.flatMap((r) =>
      horizontals(routes.get(edgeKey(r))!.points).map((h) => ({
        ...h,
        of: edgeKey(r),
        src: r.src,
        dst: r.dst,
      })),
    );
    const tooClose: string[] = [];
    for (let i = 0; i < runs.length; i++) {
      for (let j = i + 1; j < runs.length; j++) {
        const a = runs[i]!;
        const b = runs[j]!;
        // Sharing one end means sharing a run on purpose: a fan-out branches from one line, a
        // fan-in joins into one. Only connectors with nothing in common must stay apart.
        if (a.src === b.src || a.dst === b.dst) continue;
        if (Math.abs(a.y - b.y) > 10) continue;
        if (Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) < 60) continue;
        tooClose.push(`${a.of} | ${b.of} at y=${a.y.toFixed(0)}`);
      }
    }
    expect(tooClose).toEqual([]);
  });

  it("never lets a class label spill past its own box", () => {
    const wide = node("AClassWithADeliberatelyVeryLongName", 4);
    wide.attributes = [["a_field_name_that_is_also_extremely_long", "dict[str, list[int]]"]];
    const d = dims(wide);
    // dims must have grown to fit the longest line; a fixed width would clip it.
    const longest = Math.max(
      wide.name.length,
      ...wide.attributes.map(([a, t]) => `+ ${a}: ${t}`.length),
    );
    expect(d.w).toBeGreaterThan(longest * 5);
  });
});

describe("a board is laid out for a landscape screen", () => {
  // Many unrelated pieces: twelve small hierarchies and eight loose classes. Packed into a
  // fixed narrow column they would stack far below the window; packed for a screen they
  // spread sideways first.
  function scattered(): Seed {
    const nodes: SeedNode[] = [];
    const relations: SeedRelation[] = [];
    for (let i = 0; i < 12; i++) {
      nodes.push(node(`Base${i}`), node(`Sub${i}`));
      relations.push(rel(`Sub${i}`, `Base${i}`, "inherits"));
    }
    for (let i = 0; i < 8; i++) nodes.push(node(`Loose${i}`));
    return { version: 1, nodes, relations };
  }

  it("comes out wider than tall, near the target shape", () => {
    const boxes = [...boxesOf(scattered()).values()];
    const left = Math.min(...boxes.map((b) => b.cx - b.w / 2));
    const right = Math.max(...boxes.map((b) => b.cx + b.w / 2));
    const top = Math.min(...boxes.map((b) => b.cy - b.h / 2));
    const bottom = Math.max(...boxes.map((b) => b.cy + b.h / 2));
    const ratio = (right - left) / (bottom - top);
    expect(ratio).toBeGreaterThan(1.2);
    expect(ratio).toBeLessThan(3);
  });

  it("still places every class without overlapping another", () => {
    const boxes = [...boxesOf(scattered()).values()];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(overlaps(boxes[i]!, boxes[j]!)).toBe(false);
      }
    }
  });
});

it("puts a class with no relationship beside a tall hierarchy, not underneath it", () => {
  const names = ["L0", "L1", "L2", "L3", "L4", "Alone"];
  const seed: Seed = {
    version: 1,
    nodes: names.map((n) => node(n)),
    relations: [0, 1, 2, 3].map((i) => rel(`L${i + 1}`, `L${i}`, "inherits")),
  };
  const boxes = boxesOf(seed);
  const alone = boxes.get("m/Alone.py#Alone")!;
  const bottom = Math.max(...names.slice(0, 5).map((n) => {
    const b = boxes.get(`m/${n}.py#${n}`)!;
    return b.cy + b.h / 2;
  }));
  expect(alone.cy - alone.h / 2).toBeLessThan(bottom);
  const all = [...boxes.values()];
  const width = Math.max(...all.map((x) => x.cx + x.w / 2)) - Math.min(...all.map((x) => x.cx - x.w / 2));
  const height = Math.max(...all.map((x) => x.cy + x.h / 2)) - Math.min(...all.map((x) => x.cy - x.h / 2));
  expect(width).toBeLessThan(height); // nothing else to put beside it: no empty width added
});

it("hidden function groups never move a class", () => {
  // Enough classes to wrap onto several rows, and many functions: if the functions took part
  // in choosing the width or the order, the classes would land somewhere else.
  const solo = Array.from({ length: 8 }, (_, i) => `Solo${i}`);
  const classes: Seed = {
    version: 1,
    nodes: ["A", "B", "C", ...solo].map((n) => node(n)),
    relations: [rel("B", "A", "inherits"), rel("C", "A", "inherits")],
  };
  const fn = (name: string): SeedNode => ({ ...node(name, 0), kind: "function" });
  const fns = Array.from({ length: 60 }, (_, i) => `f${i}`);
  const withFunctions: Seed = {
    version: 1,
    nodes: [...classes.nodes, ...fns.map(fn)],
    relations: [
      ...classes.relations,
      ...fns.filter((_, i) => i % 3 !== 0).map((f, i) => rel(fns[Math.floor(i / 2) * 3]!, f, "calls")),
    ],
  };
  const before = boxesOf(classes);
  const after = boxesOf(withFunctions);
  for (const [key, box] of before) expect(after.get(key)).toEqual(box);
});

it("gives a deep hierarchy a landscape row, its neighbours beside it", () => {
  // A ten-level chain is far taller than wide; the classes with no relationship should fill
  // the row beside it rather than start a new row underneath.
  const chain = Array.from({ length: 10 }, (_, i) => `D${i}`);
  const solo = Array.from({ length: 6 }, (_, i) => `S${i}`);
  const seed: Seed = {
    version: 1,
    nodes: [...chain, ...solo].map((n) => node(n, 6)),
    relations: chain.slice(1).map((n, i) => rel(n, `D${i}`, "inherits")),
  };
  const boxes = boxesOf(seed);
  const chainBottom = Math.max(...chain.map((n) => {
    const b = boxes.get(`m/${n}.py#${n}`)!;
    return b.cy + b.h / 2;
  }));
  for (const n of solo) {
    const b = boxes.get(`m/${n}.py#${n}`)!;
    expect(b.cy - b.h / 2).toBeLessThan(chainBottom);
  }
});
