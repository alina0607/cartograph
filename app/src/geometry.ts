// Pure geometry: box sizing/formatting and the edge curve. No DOM, so it is unit-tested.

import type { Point, SeedNode } from "./model";

const CHAR_W = 6.9; // width of one monospace char at our font size
const LINE_H = 16;
const TITLE_H = 24;
const PAD = 8;
const MIN_W = 96;

export interface MethodLine {
  name: string; // the raw method name, used to open its detail popup
  label: string; // formatted "+ name()"
}

export interface BoxContent {
  stereotype: string; // «interface» / «struct» / "" — shown above the name
  title: string;
  attrs: string[]; // formatted "+ name: type"
  methods: MethodLine[];
  italic: boolean; // abstract/interface names render italic (UML convention)
}

export interface BoxDims extends BoxContent {
  w: number;
  h: number;
  collapsed: boolean;
  hint: string; // shown when collapsed: "A fields · M methods"
}

// UML visibility from Python-ish naming: dunder = public, _x protected, __x private.
function vis(name: string): string {
  if (name.startsWith("__") && name.endsWith("__")) return "+";
  if (name.startsWith("__")) return "-";
  if (name.startsWith("_")) return "#";
  return "+";
}

export function content(node: SeedNode): BoxContent {
  const attrs = node.attributes.map(([n, t]) => (t ? `${vis(n)} ${n}: ${t}` : `${vis(n)} ${n}`));
  const methods = node.methods.map((m) => ({ name: m.name, label: `${vis(m.name)} ${m.name}()` }));
  const stereotype =
    node.kind === "interface" ? "«interface»" : node.kind === "struct" ? "«struct»" : "";
  return {
    stereotype,
    title: node.name,
    attrs,
    methods,
    italic: node.kind === "abstract" || node.kind === "interface",
  };
}

export function dims(node: SeedNode, collapsed = false): BoxDims {
  const c = content(node);
  const hint = `${c.attrs.length} field${plural(c.attrs.length)} · ${c.methods.length} method${plural(
    c.methods.length,
  )}`;
  if (node.kind === "function") {
    // A function is a compact single pill: name only, no compartments.
    const label = `${node.name}()`;
    const w = Math.max(MIN_W, Math.round(label.length * CHAR_W) + PAD * 2);
    return { ...c, title: label, w, h: TITLE_H + PAD, collapsed: false, hint };
  }
  const stereoH = c.stereotype ? LINE_H : 0;
  if (collapsed) {
    const longest = [c.stereotype, c.title, hint].reduce((m, s) => Math.max(m, s.length), 0);
    const w = Math.max(MIN_W, Math.round(longest * CHAR_W) + PAD * 2);
    return { ...c, w, h: stereoH + TITLE_H + PAD + LINE_H + PAD, collapsed, hint };
  }
  const lines = [c.stereotype, c.title, ...c.attrs, ...c.methods.map((m) => m.label)].filter(Boolean);
  const longest = lines.reduce((m, s) => Math.max(m, s.length), 0);
  const w = Math.max(MIN_W, Math.round(longest * CHAR_W) + PAD * 2);
  const h =
    stereoH + TITLE_H + PAD + c.attrs.length * LINE_H + PAD + c.methods.length * LINE_H + PAD;
  return { ...c, w, h, collapsed, hint };
}

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

export const metrics = { CHAR_W, LINE_H, TITLE_H, PAD };

export interface Box {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// Where the segment from the box centre toward `toward` exits the box rectangle.
export function borderPoint(box: Box, toward: Point): Point {
  const dx = toward.x - box.cx;
  const dy = toward.y - box.cy;
  if (dx === 0 && dy === 0) return { x: box.cx, y: box.cy + box.h / 2 };
  const hw = box.w / 2;
  const hh = box.h / 2;
  const sx = dx === 0 ? Infinity : hw / Math.abs(dx);
  const sy = dy === 0 ? Infinity : hh / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: box.cx + dx * s, y: box.cy + dy * s };
}

export interface EdgeGeom {
  path: string; // SVG path data
  handle: Point; // the on-curve midpoint the user drags
  p0: Point;
  p1: Point;
  dirStart: Point; // unit vector leaving the source box (for the owner-end marker)
  dirEnd: Point; // unit vector arriving at the destination box (for the arrow/triangle)
}

function unit(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

// A quadratic curve from src box to dst box that passes through M = mid + bend at t=0.5.
// Endpoints are aimed at M (not the raw control point) so the curve leaves each box
// pointing where it visually goes; the control point is derived to make B(0.5) === M.
export function edgeGeom(src: Box, dst: Box, bend: [number, number]): EdgeGeom {
  const mid = midpoint({ x: src.cx, y: src.cy }, { x: dst.cx, y: dst.cy });
  const M: Point = { x: mid.x + bend[0], y: mid.y + bend[1] };
  const p0 = borderPoint(src, M);
  const p1 = borderPoint(dst, M);
  const ctrl: Point = { x: 2 * M.x - (p0.x + p1.x) / 2, y: 2 * M.y - (p0.y + p1.y) / 2 };
  const path = `M ${r(p0.x)} ${r(p0.y)} Q ${r(ctrl.x)} ${r(ctrl.y)} ${r(p1.x)} ${r(p1.y)}`;
  return { path, handle: M, p0, p1, dirStart: unit(p0, ctrl), dirEnd: unit(ctrl, p1) };
}

// Which of a group of edges sharing a corridor this one is, so their turns do not coincide.
export interface Lane {
  index: number; // 0-based position within the group
  count: number; // how many edges share the corridor
  // The clear channel the turn must stay inside, as [near, far] along the routing axis. The two
  // endpoint boxes alone do not define it: a THIRD box, taller than the destination, reaches up
  // into the space between them, and a run placed by pairwise reasoning goes straight through it.
  // The caller sees every box, so it computes the channel and this only has to obey it.
  channel?: [number, number];
}

// Spread the turns evenly across the clear channel. Fractions of the channel (rather than a fixed
// pixel step) keep every turn inside it, so no amount of fan-out can push a run onto a box.
//
// The thing being spread is a BUS, not an edge: every edge of one kind leaving one box shares a
// lane on purpose, which draws them as a single trunk that branches at the turn. Spreading them
// individually is what produced a dozen near-parallel lines a reader cannot follow.
function laneAt(a: number, b: number, lane: Lane | undefined): number {
  const [lo, hi] = lane?.channel ?? [a, b];
  const f = lane ? (lane.index + 1) / (lane.count + 1) : 0.5;
  return lo + (hi - lo) * f;
}

// Which way a right-angle route should run. Separation decides it, not distance: two boxes on
// different ranks are separated vertically, so the route leaves the bottom and enters the top —
// the convention that makes a layered diagram readable, and the only one whose middle run lands
// in the gutter between ranks.
//
// Picking the axis with the larger delta looked equivalent and is not. A parent and its
// right-most child are often further apart sideways than downward, so that rule sent the route
// out of the parent's SIDE and back into the child's side along the child's own centre line —
// straight through every sibling in between. No choice of lane can avoid it, because that last
// run's height is fixed by the destination, not by the routing.
export function axis(src: Box, dst: Box): "h" | "v" {
  const vGap = Math.max(dst.cy - dst.h / 2 - (src.cy + src.h / 2), src.cy - src.h / 2 - (dst.cy + dst.h / 2));
  const hGap = Math.max(dst.cx - dst.w / 2 - (src.cx + src.w / 2), src.cx - src.w / 2 - (dst.cx + dst.w / 2));
  if (vGap > 0) return "v"; // on different ranks — always go vertical
  if (hGap > 0) return "h"; // side by side on one rank
  return Math.abs(dst.cx - src.cx) >= Math.abs(dst.cy - src.cy) ? "h" : "v"; // overlapping
}

// What is left of the space between two boxes once every OTHER box the run passes over has been
// excluded, as [near, far] along the routing axis. Reasoning from the two endpoints alone is what
// let a fan's outer edges cross a taller sibling: the space looked clear because the sibling was
// never consulted. Returns undefined when nothing usable is left — the ranks are packed too
// tightly for a clean run, and the caller should fall back to the midpoint rather than pretend.
//
// Exported (and pure) so the readability test can assert the invariant with the same code the
// renderer uses; behind a closure in the renderer it was untestable, which is how the crossing
// shipped in the first place.
export function clearChannel(
  src: Box,
  dst: Box,
  others: Iterable<Box>,
): [number, number] | undefined {
  const horizontal = axis(src, dst) === "h";
  const dir = Math.sign((horizontal ? dst.cx - src.cx : dst.cy - src.cy) || 1);
  const near = horizontal ? src.cx + (dir * src.w) / 2 : src.cy + (dir * src.h) / 2;
  const far = horizontal ? dst.cx - (dir * dst.w) / 2 : dst.cy - (dir * dst.h) / 2;
  // Across the routing axis: the strip the run travels through, which decides who is in the way.
  const a0 = horizontal ? src.cy : src.cx;
  const a1 = horizontal ? dst.cy : dst.cx;
  const spanLo = Math.min(a0, a1);
  const spanHi = Math.max(a0, a1);
  let lo = Math.min(near, far);
  let hi = Math.max(near, far);
  for (const b of others) {
    const acrossHalf = (horizontal ? b.h : b.w) / 2;
    const across = horizontal ? b.cy : b.cx;
    if (across + acrossHalf < spanLo || across - acrossHalf > spanHi) continue;
    const alongHalf = (horizontal ? b.w : b.h) / 2;
    const along = horizontal ? b.cx : b.cy;
    const bLo = along - alongHalf;
    const bHi = along + alongHalf;
    if (bHi <= lo || bLo >= hi) continue;
    // Keep the roomier side of the obstruction.
    if (bLo - lo >= hi - bHi) hi = Math.min(hi, bLo);
    else lo = Math.max(lo, bHi);
  }
  if (hi - lo < 8) return undefined;
  return near < far ? [lo, hi] : [hi, lo];
}

// The band one bus may turn in: what is left of the space between the source and EVERY destination
// it feeds, so the shared trunk clears all of them at once. One member's band is not enough — the
// widest child sets a band the shallowest child's box already occupies.
//
// The bus's own destinations are not obstacles: the trunk is not allowed past their near edge
// anyway, which each member's `far` bound already states, and treating them as obstacles would
// refuse to merge exactly the dense fans that need it most.
export function busChannel(
  src: Box,
  dsts: Box[],
  others: Iterable<Box>,
): [number, number] | undefined {
  const obstacles = [...others];
  let lo = -Infinity;
  let hi = Infinity;
  let ascending = true;
  for (const dst of dsts) {
    const ch = clearChannel(src, dst, obstacles);
    if (!ch) return undefined; // no clean trunk exists; the caller falls back to separate runs
    ascending = ch[0] <= ch[1];
    lo = Math.max(lo, Math.min(ch[0], ch[1]));
    hi = Math.min(hi, Math.max(ch[0], ch[1]));
  }
  if (hi - lo < 8) return undefined;
  return ascending ? [lo, hi] : [hi, lo];
}

// Right-angle ("orthogonal") routing with rounded corners, like an architecture diagram.
// The line leaves and enters the boxes on their facing sides and turns once; the draggable
// handle sits on the middle segment, so the elbow can still be nudged along its axis.
export function orthogonalGeom(
  src: Box,
  dst: Box,
  bend: [number, number],
  lane?: Lane,
): EdgeGeom {
  const dx = dst.cx - src.cx;
  const dy = dst.cy - src.cy;
  const R = 12;
  let p0: Point;
  let p1: Point;
  let corners: Point[];
  let handle: Point;
  if (axis(src, dst) === "h") {
    const s = dx >= 0 ? 1 : -1;
    p0 = { x: src.cx + (s * src.w) / 2, y: src.cy };
    p1 = { x: dst.cx - (s * dst.w) / 2, y: dst.cy };
    const mx = laneAt(p0.x, p1.x, lane) + bend[0];
    corners = [{ x: mx, y: p0.y }, { x: mx, y: p1.y }];
    handle = { x: mx, y: (p0.y + p1.y) / 2 };
  } else {
    const s = dy >= 0 ? 1 : -1;
    p0 = { x: src.cx, y: src.cy + (s * src.h) / 2 };
    p1 = { x: dst.cx, y: dst.cy - (s * dst.h) / 2 };
    const my = laneAt(p0.y, p1.y, lane) + bend[1];
    corners = [{ x: p0.x, y: my }, { x: p1.x, y: my }];
    handle = { x: (p0.x + p1.x) / 2, y: my };
  }
  const c0 = corners[0]!;
  const cN = corners[corners.length - 1]!;
  return {
    path: roundedPath([p0, ...corners, p1], R),
    handle,
    p0,
    p1,
    dirStart: unit(p0, c0),
    dirEnd: unit(cN, p1),
  };
}

// A polyline through `pts` with each interior corner rounded by radius `r`.
function roundedPath(pts: Point[], radius: number): string {
  const first = pts[0]!;
  let d = `M ${r(first.x)} ${r(first.y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const cur = pts[i]!;
    const a = toward(cur, pts[i - 1]!, radius);
    const b = toward(cur, pts[i + 1]!, radius);
    d += ` L ${r(a.x)} ${r(a.y)} Q ${r(cur.x)} ${r(cur.y)} ${r(b.x)} ${r(b.y)}`;
  }
  const last = pts[pts.length - 1]!;
  d += ` L ${r(last.x)} ${r(last.y)}`;
  return d;
}

// A point `dist` away from `from` toward `to` (clamped to the segment's half length).
function toward(from: Point, to: Point, dist: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const d = Math.min(dist, len / 2);
  return { x: from.x + (dx / len) * d, y: from.y + (dy / len) * d };
}

function r(n: number): number {
  return Math.round(n * 100) / 100;
}
