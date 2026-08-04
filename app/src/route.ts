// The routing stage: given where the boxes ended up, decide the path every connector takes.
//
// Ranking and ordering the nodes is only the first half of a layered drawing. Routing was the
// missing half, and each connector was left to infer a path from its own two endpoints. Two
// things followed, both measured on the Cherno board (189 connectors):
//
//   * 77 connectors span more than one row, and each was drawn as ONE long horizontal sweep at
//     whatever height happened to be free — median 459px for a two-row span, 851px for four.
//   * Connectors from different sources chose their height independently, so they piled into the
//     same gap: 103 pairs ran within 14px of each other for at least 60px, two of them exactly
//     on top of each other for 1001px.
//
// Neither is a geometry bug; both are what happens when a shared resource is allocated locally.
// So this module owns the resources explicitly:
//
//   rows      boxes that overlap vertically — how the drawing is read
//   gutters   the clear bands between consecutive rows; every turn happens inside one
//   channels  distinct heights within a gutter, allocated so overlapping runs never coincide and
//             non-overlapping runs may share one (left-edge assignment, as in channel routing)
//   columns   the vertical gaps inside a row, used by a connector passing THROUGH the row instead
//             of sweeping around it
//
// Everything is derived from the boxes as they are currently drawn, not from the layout's own
// bookkeeping, so a hand-moved box re-routes together with everything else.

import type { Box } from "./geometry";
import type { Point, SeedRelation } from "./model";

const ROW_TOLERANCE = 12; // centres this close are read as one row
const MIN_COLUMN = 20; // a vertical gap narrower than this is not worth threading
const COLUMN_INSET = 10; // keep a column this far off the boxes flanking it
const COLUMN_STEP = 14; // the second and later columns through one gap step sideways
const CHANNEL_SPACING = 16; // rung spacing: closer than this and two runs read as one thick line
const CHANNEL_CLEAR = 24; // horizontal clearance before two runs may share a rung
const BOX_CLEAR = 4; // clearance required when testing a run against a box
const CHANNEL_EDGE = 4; // keep a channel off the boxes bounding its gutter
const MIN_GUTTER = 12; // treat rows this close as still having a usable band

export interface Route {
  points: Point[]; // orthogonal polyline from the source border to the destination border
  handle: Point; // the draggable point, on the run leaving the source
}

interface Row {
  cy: number;
  top: number;
  bottom: number;
}

interface Gutter {
  lo: number;
  hi: number;
}

// One horizontal run, before its height is known. `group` is what may share a height: every
// connector of one kind leaving one box carries the same group for the run that leaves it, which
// is what draws a fan as a single trunk that branches.
interface Hop {
  gutter: Gutter;
  group: string;
}

interface Plan {
  key: string;
  p0: Point;
  p1: Point;
  xs: number[]; // hops.length + 1 corner positions across the drawing
  hops: Hop[];
  bendY: number;
}

// Rows and gutters are per connected component, because that is the unit the layout places: each
// component is ranked on its own and the finished blocks are packed side by side. Read globally, one
// component's rows interleave with another's, so a run would be handed a "gutter" with a stranger's
// classes standing in it — which is exactly how nine runs ended up drawn through a box. Obstacle
// tests still see EVERY box, so a hand-moved box cannot be crossed either.
export function routeEdges(
  boxes: Map<string, Box>,
  relations: readonly SeedRelation[],
  keyOf: (rel: SeedRelation) => string,
  bendOf: (key: string) => [number, number],
): Map<string, Route> {
  const out = new Map<string, Route>();
  const obstacles = [...boxes.values()];
  const plans: Plan[] = [];
  for (const part of components(boxes, relations)) {
    routeComponent(part.boxes, part.relations, obstacles, keyOf, bendOf, out, plans);
  }
  // Heights are handed out for the whole drawing at once. A component decides WHERE its gutters
  // are; it does not own the space inside them, and two components allocating from their own
  // ladders both start at the top rung and draw one line over the other.
  const heights = assignChannels(plans, obstacles);
  for (const p of plans) out.set(p.key, materialize(p, heights));
  return out;
}

// Boxes joined by a relationship, however indirectly.
function components(
  boxes: Map<string, Box>,
  relations: readonly SeedRelation[],
): Array<{ boxes: Map<string, Box>; relations: SeedRelation[] }> {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(k, r);
    return r;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const k of boxes.keys()) parent.set(k, k);
  for (const rel of relations) {
    if (boxes.has(rel.src) && boxes.has(rel.dst)) union(rel.src, rel.dst);
  }
  const groups = new Map<string, { boxes: Map<string, Box>; relations: SeedRelation[] }>();
  const groupOf = (k: string): { boxes: Map<string, Box>; relations: SeedRelation[] } => {
    const r = find(k);
    let g = groups.get(r);
    if (!g) {
      g = { boxes: new Map(), relations: [] };
      groups.set(r, g);
    }
    return g;
  };
  for (const [k, b] of boxes) groupOf(k).boxes.set(k, b);
  for (const rel of relations) {
    if (boxes.has(rel.src) && boxes.has(rel.dst)) groupOf(rel.src).relations.push(rel);
  }
  return [...groups.values()].filter((g) => g.relations.length > 0);
}

function routeComponent(
  boxes: Map<string, Box>,
  relations: readonly SeedRelation[],
  obstacles: Box[],
  keyOf: (rel: SeedRelation) => string,
  bendOf: (key: string) => [number, number],
  out: Map<string, Route>,
  plans: Plan[],
): void {
  const all = [...boxes.values()];
  const rows = buildRows(all);
  const rowIdx = new Map<Box, number>();
  for (const b of all) rowIdx.set(b, nearestRow(rows, b));
  const gutters: Gutter[] = rows.slice(0, -1).map((r, i) => {
    const hi = rows[i + 1]!.top;
    return { lo: r.bottom, hi: Math.max(hi, r.bottom + MIN_GUTTER) };
  });

  // Which end of a one-gutter connector is the interesting one. A class with five children should
  // show one line that branches; five children of one parent should show one line that joins. Both
  // are the same mechanism seen from opposite ends, so the bigger group wins and the drawing shows
  // whichever structure is actually there.
  const fanOut = new Map<string, number>();
  const fanIn = new Map<string, number>();
  for (const rel of relations) {
    const s = boxes.get(rel.src);
    const d = boxes.get(rel.dst);
    if (!s || !d) continue;
    const dir = rowIdx.get(d)! >= rowIdx.get(s)! ? "d" : "u";
    bump(fanOut, `out:${rel.src}|${rel.kind}|${dir}`);
    bump(fanIn, `in:${rel.dst}|${rel.kind}|${dir}`);
  }

  const columnUse = new Map<string, number>();

  for (const rel of relations) {
    const src = boxes.get(rel.src);
    const dst = boxes.get(rel.dst);
    if (!src || !dst) continue;
    const key = keyOf(rel);
    const [bendX, bendY] = bendOf(key);
    if (src === dst) {
      out.set(key, selfLoop(src));
      continue;
    }
    const sr = rowIdx.get(src)!;
    const dr = rowIdx.get(dst)!;

    if (sr === dr) {
      const direct = sideBySide(src, dst, obstacles, bendX);
      if (direct) {
        out.set(key, direct);
        continue;
      }
      // One is stacked on the other inside a single row, so there is no side to leave from.
      // Borrow the nearest gutter and go around, which is a normal multi-row route with the two
      // ends on the same side.
      const g = sr < gutters.length ? sr : sr - 1;
      if (g < 0) {
        out.set(key, { points: [center(src), center(dst)], handle: mid(center(src), center(dst)) });
        continue;
      }
      const below = g === sr;
      plans.push({
        key,
        p0: { x: src.cx, y: below ? src.cy + src.h / 2 : src.cy - src.h / 2 },
        p1: { x: dst.cx, y: below ? dst.cy + dst.h / 2 : dst.cy - dst.h / 2 },
        xs: [src.cx, dst.cx],
        hops: [{ gutter: gutters[g]!, group: `edge:${key}:0` }],
        bendY,
      });
      continue;
    }

    // A row-to-row route: leave the facing side, cross one gutter per row boundary, and pass
    // through each intervening row inside a column rather than sweeping around it.
    const down = dr > sr;
    const between = down
      ? Array.from({ length: Math.max(0, dr - sr - 1) }, (_, i) => sr + 1 + i)
      : Array.from({ length: Math.max(0, sr - dr - 1) }, (_, i) => sr - 1 - i);
    const crossed = down
      ? Array.from({ length: dr - sr }, (_, i) => sr + i)
      : Array.from({ length: sr - dr }, (_, i) => sr - 1 - i);

    const xs = [src.cx];
    between.forEach((r, i) => {
      // Aim at the straight line between the ends, so a column only bends the path as much as
      // the boxes in that row force it to.
      const t = (i + 1) / (between.length + 1);
      const band = { lo: gutters[r - 1]?.lo ?? rows[r]!.top, hi: gutters[r]?.hi ?? rows[r]!.bottom };
      xs.push(freeColumn(obstacles, band, r, src.cx + (dst.cx - src.cx) * t, columnUse));
    });
    xs.push(dst.cx);

    const outKey = `out:${rel.src}|${rel.kind}|${down ? "d" : "u"}`;
    const inKey = `in:${rel.dst}|${rel.kind}|${down ? "d" : "u"}`;
    const single = crossed.length === 1;
    plans.push({
      key,
      p0: { x: src.cx, y: down ? src.cy + src.h / 2 : src.cy - src.h / 2 },
      p1: { x: dst.cx, y: down ? dst.cy - dst.h / 2 : dst.cy + dst.h / 2 },
      xs,
      hops: crossed.map((g, i) => ({
        gutter: gutters[g]!,
        // Shared at the ends, private in between: past the first turn the members of a fan sit in
        // different columns and have nothing left in common.
        group: single
          ? (fanIn.get(inKey) ?? 0) > (fanOut.get(outKey) ?? 0)
            ? inKey
            : outKey
          : i === 0
            ? outKey
            : i === crossed.length - 1
              ? inKey
              : `edge:${key}:${i}`,
      })),
      bendY,
    });
  }

}

// Boxes whose centres line up belong to one row. Grouping by centre rather than by overlapping
// extent is deliberate: one tall box reaches into the next row's band, and extent-grouping then
// welds the two rows into one — after which the row has no gutter of its own and a connector
// leaving it starts by crossing its own neighbours.
function buildRows(all: Box[]): Row[] {
  const rows: Row[] = [];
  for (const b of [...all].sort((x, y) => x.cy - y.cy)) {
    const cur = rows[rows.length - 1];
    if (cur && Math.abs(b.cy - cur.cy) <= ROW_TOLERANCE) {
      cur.top = Math.min(cur.top, b.cy - b.h / 2);
      cur.bottom = Math.max(cur.bottom, b.cy + b.h / 2);
    } else {
      rows.push({ cy: b.cy, top: b.cy - b.h / 2, bottom: b.cy + b.h / 2 });
    }
  }
  return rows;
}

function nearestRow(rows: Row[], b: Box): number {
  let best = 0;
  let bestD = Infinity;
  rows.forEach((r, i) => {
    const d = Math.abs(r.cy - b.cy);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

// A vertical gap for a connector crossing `band`, as close to `desired` as the boxes allow.
// Obstacles are every box the vertical could actually meet, which is not the same as the boxes of
// one row: a tall neighbour reaches into the gutters either side of it. Successive users of one gap
// step sideways so two corridors never share a line.
function freeColumn(
  all: Box[],
  band: Gutter,
  rowIndex: number,
  desired: number,
  use: Map<string, number>,
): number {
  const inWay = all
    .filter((b) => b.cy + b.h / 2 > band.lo && b.cy - b.h / 2 < band.hi)
    .sort((a, b) => a.cx - b.cx);
  const gaps: Array<[number, number]> = [];
  let edge = -Infinity;
  for (const b of inWay) {
    const left = b.cx - b.w / 2;
    if (left - edge >= MIN_COLUMN) gaps.push([edge, left]);
    edge = Math.max(edge, b.cx + b.w / 2);
  }
  gaps.push([edge, Infinity]);
  if (gaps.length === 0) return desired; // a wall of boxes: nothing to thread, keep it straight
  let best = 0;
  let bestDist = Infinity;
  gaps.forEach(([lo, hi], i) => {
    const d = Math.abs(clamp(desired, lo + COLUMN_INSET, hi - COLUMN_INSET) - desired);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  const [lo, hi] = gaps[best]!;
  const slot = `${rowIndex}|${best}`;
  const n = use.get(slot) ?? 0;
  use.set(slot, n + 1);
  const base = clamp(desired, lo + COLUMN_INSET, hi - COLUMN_INSET);
  return clamp(base + n * COLUMN_STEP, lo + COLUMN_INSET, hi - COLUMN_INSET);
}

// Give every horizontal run a height. Runs of one group are merged first — they are meant to be one
// line — then each survivor takes the first rung of its gutter's ladder that is clear of boxes along
// its own span and free of any run it overlaps. Rungs sit a fixed distance apart, so two runs on
// different rungs can never be mistaken for one, and a rung may be reused by runs that do not
// overlap, so a gutter needs only as many rungs as its busiest point.
function assignChannels(plans: Plan[], all: Box[]): Map<string, number> {
  interface Item {
    gutter: Gutter;
    group: string;
    x0: number;
    x1: number;
  }
  const items = new Map<string, Item>();
  for (const p of plans) {
    p.hops.forEach((hop, i) => {
      const x0 = Math.min(p.xs[i]!, p.xs[i + 1]!);
      const x1 = Math.max(p.xs[i]!, p.xs[i + 1]!);
      const prev = items.get(hop.group);
      if (prev) {
        prev.x0 = Math.min(prev.x0, x0);
        prev.x1 = Math.max(prev.x1, x1);
      } else {
        items.set(hop.group, { gutter: hop.gutter, group: hop.group, x0, x1 });
      }
    });
  }

  const clear = (y: number, x0: number, x1: number): boolean =>
    !all.some(
      (b) =>
        y > b.cy - b.h / 2 + BOX_CLEAR &&
        y < b.cy + b.h / 2 - BOX_CLEAR &&
        x1 > b.cx - b.w / 2 - BOX_CLEAR &&
        x0 < b.cx + b.w / 2 + BOX_CLEAR,
    );

  const placed: Array<{ y: number; x0: number; x1: number }> = [];
  const free = (y: number, x0: number, x1: number): boolean =>
    !placed.some(
      (p) =>
        Math.abs(p.y - y) < CHANNEL_SPACING - 1 &&
        Math.min(p.x1, x1) - Math.max(p.x0, x0) > -CHANNEL_CLEAR,
    );

  const heights = new Map<string, number>();
  for (const it of [...items.values()].sort((a, b) => a.x0 - b.x0)) {
    const rungs = ladder(it.gutter);
    let y = rungs.find((r) => clear(r, it.x0, it.x1) && free(r, it.x0, it.x1));
    if (y === undefined) {
      // Every rung clear of the classes is already taken along this span. Sharing one is the lesser
      // evil: a line drawn over another can still be traced, one drawn through a class cannot.
      y = rungs.find((r) => clear(r, it.x0, it.x1)) ?? rungs[Math.floor(rungs.length / 2)]!;
    }
    placed.push({ y, x0: it.x0, x1: it.x1 });
    heights.set(it.group, y);
  }
  return heights;
}

function ladder(g: Gutter): number[] {
  const usable = g.hi - g.lo - CHANNEL_EDGE * 2;
  const n = Math.max(1, Math.floor(usable / CHANNEL_SPACING));
  return Array.from({ length: n }, (_, i) => g.lo + ((g.hi - g.lo) * (i + 1)) / (n + 1));
}

function materialize(plan: Plan, heights: Map<string, number>): Route {
  const ys = plan.hops.map(
    (hop) => heights.get(hop.group) ?? (hop.gutter.lo + hop.gutter.hi) / 2,
  );
  // The drag nudges the run leaving the source — the one the handle sits on — and cannot push it
  // out of its gutter, so a nudged line still misses every box.
  if (ys.length > 0 && plan.bendY !== 0) {
    const g = plan.hops[0]!.gutter;
    ys[0] = clamp(ys[0]! + plan.bendY, g.lo + CHANNEL_EDGE, g.hi - CHANNEL_EDGE);
  }

  const pts: Point[] = [plan.p0];
  for (let i = 0; i < ys.length; i++) {
    pts.push({ x: plan.xs[i]!, y: ys[i]! });
    pts.push({ x: plan.xs[i + 1]!, y: ys[i]! });
  }
  pts.push(plan.p1);
  const points = dedupe(pts);
  const handle = { x: (plan.xs[0]! + plan.xs[1]!) / 2, y: ys[0]! };
  return { points, handle };
}

// Two boxes on one row with clear air between them: leave the facing sides and jog once. Returns
// null when another box of the row sits between them, because then there is no straight way
// across and the caller has to go around through a gutter.
function sideBySide(src: Box, dst: Box, all: Box[], bendX: number): Route | null {
  const s = dst.cx >= src.cx ? 1 : -1;
  const from = src.cx + (s * src.w) / 2;
  const to = dst.cx - (s * dst.w) / 2;
  if ((to - from) * s < MIN_COLUMN) return null; // overlapping or touching: no side to leave from
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const yLo = Math.min(src.cy, dst.cy);
  const yHi = Math.max(src.cy, dst.cy);
  for (const b of all) {
    if (b === src || b === dst) continue;
    const inX = b.cx + b.w / 2 > lo && b.cx - b.w / 2 < hi;
    const inY = b.cy + b.h / 2 > yLo - BOX_CLEAR && b.cy - b.h / 2 < yHi + BOX_CLEAR;
    if (inX && inY) return null;
  }
  const p0 = { x: from, y: src.cy };
  const p1 = { x: to, y: dst.cy };
  const jx = clamp((from + to) / 2 + bendX, lo + 4, hi - 4);
  const points =
    Math.abs(src.cy - dst.cy) < 1
      ? [p0, p1]
      : [p0, { x: jx, y: p0.y }, { x: jx, y: p1.y }, p1];
  return { points, handle: { x: jx, y: (p0.y + p1.y) / 2 } };
}

// A relationship from a class to itself: a stub out of the top and back, since there is no other
// box to travel to.
function selfLoop(b: Box): Route {
  const top = b.cy - b.h / 2;
  const x0 = b.cx - Math.min(24, b.w / 4);
  const x1 = b.cx + Math.min(24, b.w / 4);
  return {
    points: [
      { x: x0, y: top },
      { x: x0, y: top - 26 },
      { x: x1, y: top - 26 },
      { x: x1, y: top },
    ],
    handle: { x: b.cx, y: top - 26 },
  };
}

function dedupe(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    out.push(p);
  }
  return out.length >= 2 ? out : pts.slice(0, 2);
}

function bump(m: Map<string, number>, k: string): void {
  m.set(k, (m.get(k) ?? 0) + 1);
}

function center(b: Box): Point {
  return { x: b.cx, y: b.cy };
}

function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
