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
  stereotype: string; // «interface» / «struct» / «metaclass» / "" — shown above the name
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

// UML stereotypes shown above a class name, by node kind.
const STEREOTYPES: Record<string, string> = {
  interface: "«interface»",
  struct: "«struct»",
  metaclass: "«metaclass»",
};

export function content(node: SeedNode): BoxContent {
  const attrs = node.attributes.map(([n, t]) => (t ? `${vis(n)} ${n}: ${t}` : `${vis(n)} ${n}`));
  const methods = node.methods.map((m) => ({ name: m.name, label: `${vis(m.name)} ${m.name}()` }));
  // A class from outside the scan names its package instead: «torch.nn», «collections».
  const outside = node.kind === "stdlib" || node.kind === "library";
  const stereotype = outside ? `«${node.module}»` : (STEREOTYPES[node.kind] ?? "");
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

// An orthogonal connector along a path the router chose. Geometry no longer decides where a
// connector goes — it only draws it — because a path is only correct relative to every other
// path in the drawing, which a function given two boxes cannot see. See route.ts.
export function polylineGeom(points: Point[], handle: Point, radius = 12): EdgeGeom {
  const p0 = points[0]!;
  const p1 = points[points.length - 1]!;
  return {
    path: roundedPath(points, radius),
    handle,
    p0,
    p1,
    dirStart: unit(p0, points[1] ?? p1),
    dirEnd: unit(points[points.length - 2] ?? p0, p1),
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
