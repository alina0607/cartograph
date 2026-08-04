// Readability invariants for a drawn board.
//
// Correct-but-unreadable is the failure mode that matters here, and it is invisible to a unit
// test that only checks coordinates: boxes can all be inside the canvas and still sit on top of
// one another, and every edge can start and end in the right place while its middle run crosses
// three classes. Both were shipped and only found by eye. These assert the two properties a
// reader actually depends on, so any future change to ranking, packing or routing has to keep
// them: nothing overlaps, and no connector passes through a box it is not attached to.

import { describe, expect, it } from "vitest";
import { busChannel, clearChannel, dims, orthogonalGeom, type Box } from "./geometry";
import { initialPositions } from "./layout";
import type { Seed, SeedNode, SeedRelation } from "./model";

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

/** Axis-aligned segments of an orthogonal path, read back from the emitted SVG `d`. */
function segments(path: string): Array<[number, number, number, number]> {
  const pts: Array<[number, number]> = [];
  for (const m of path.matchAll(/[MLQ] ([\d.-]+) ([\d.-]+)/g)) {
    pts.push([Number(m[1]), Number(m[2])]);
  }
  const segs: Array<[number, number, number, number]> = [];
  for (let i = 1; i < pts.length; i++) {
    segs.push([pts[i - 1]![0], pts[i - 1]![1], pts[i]![0], pts[i]![1]]);
  }
  return segs;
}

/** Does a segment's interior pass through the box? Endpoints touching a border are fine. */
function cuts(seg: [number, number, number, number], b: Box): boolean {
  const [x1, y1, x2, y2] = seg;
  const inset = 4; // a connector legitimately meets its own box's border
  const l = b.cx - b.w / 2 + inset;
  const r = b.cx + b.w / 2 - inset;
  const t = b.cy - b.h / 2 + inset;
  const bo = b.cy + b.h / 2 - inset;
  // Sample the interior of the segment rather than solving analytically: the rounded corners
  // make a path piecewise, and every piece is short, so sampling is exact enough and cannot
  // be fooled by a curve that only dips into a box briefly.
  for (let s = 1; s < 10; s++) {
    const x = x1 + ((x2 - x1) * s) / 10;
    const y = y1 + ((y2 - y1) * s) / 10;
    if (x > l && x < r && y > t && y < bo) return true;
  }
  return false;
}

describe("a drawn board stays readable", () => {
  const seed = board();
  const boxes = boxesOf(seed);

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
    // Grouped the way the renderer groups them, and routed on the bus channel, because that is
    // the path the product draws. Checking a pairwise route instead would pass while the shared
    // trunk — placed by a band that has to clear every child at once — cuts through a box.
    const bus = new Map<string, SeedRelation[]>();
    for (const r of seed.relations) {
      const k = `${r.src}|${r.kind}`;
      bus.set(k, [...(bus.get(k) ?? []), r]);
    }
    for (const r of seed.relations) {
      const src = boxes.get(r.src)!;
      const dst = boxes.get(r.dst)!;
      const siblings = bus.get(`${r.src}|${r.kind}`)!;
      const own = new Set([r.src, ...siblings.map((s) => s.dst)]);
      const others = [...boxes].filter(([k]) => !own.has(k)).map(([, b]) => b);
      const channel =
        busChannel(src, siblings.map((s) => boxes.get(s.dst)!), others) ??
        clearChannel(src, dst, [...boxes].filter(([k]) => !own.has(k)).map(([, b]) => b));
      const path = orthogonalGeom(src, dst, [0, 0], { index: 0, count: 1, channel }).path;
      for (const [key, box] of boxes) {
        if (key === r.src || key === r.dst) continue;
        if (segments(path).some((s) => cuts(s, box))) {
          crossings.push(`${r.src} -> ${r.dst} crosses ${key}`);
        }
      }
    }
    expect(crossings).toEqual([]);
  });

  // One source, one kind, five children: five near-parallel runs are unreadable, so they are
  // drawn as one trunk that branches. The property to hold is BOTH halves of that — the shared
  // run really is shared (one turn height, not five within a few pixels, which reads as fraying)
  // and each child still gets its own branch.
  it("merges a same-kind fan into one shared trunk with a branch per child", () => {
    const root = boxes.get("m/Root.py#Root")!;
    const kids = ["FanA", "FanB", "FanC", "FanD", "FanE"].map((n) => boxes.get(`m/${n}.py#${n}`)!);
    const others = [...boxes.values()].filter((b) => b !== root && !kids.includes(b));
    const channel = busChannel(root, kids, others);
    expect(channel).toBeDefined();

    const lane = { index: 0, count: 1, channel };
    const paths = kids.map((k) => orthogonalGeom(root, k, [0, 0], lane).path);
    const trunkY = paths.map((p) => Number(/Q [\d.-]+ ([\d.-]+)/.exec(p)![1]));
    expect(new Set(trunkY).size).toBe(1);
    const branchX = paths.map((p) => Number(/([\d.-]+) [\d.-]+$/.exec(p)![1]));
    expect(new Set(branchX).size).toBe(kids.length);
  });

  it("gives each relationship kind its own trunk, since one line cannot carry two styles", () => {
    const root = boxes.get("m/Root.py#Root")!;
    const kids = ["FanA", "FanB"].map((n) => boxes.get(`m/${n}.py#${n}`)!);
    const others = [...boxes.values()].filter((b) => b !== root && !kids.includes(b));
    const channel = busChannel(root, kids, others);
    const turn = (index: number): number =>
      Number(
        /Q [\d.-]+ ([\d.-]+)/.exec(
          orthogonalGeom(root, kids[0]!, [0, 0], { index, count: 2, channel }).path,
        )![1],
      );
    expect(turn(0)).not.toBe(turn(1));
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
