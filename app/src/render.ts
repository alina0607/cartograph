// Build the whole scene as one SVG string. Full re-render on every change keeps the
// renderer stateless; interaction listeners live on the container, so replacing
// innerHTML never detaches them.

import { dims, edgeGeom, FONT, metrics, MONO_FONT, polylineGeom, type Box } from "./geometry";
import { routeEdges } from "./route";
import { edgeKey, edgeStyle } from "./edge";
import { renderGroups, renderImages, renderNotes } from "./renderItems";
import type { Point, SeedNode } from "./model";
import type { Store } from "./store";

const { LINE_H, TITLE_H, PAD } = metrics;

interface BoxKind {
  fill: string;
  stroke: string;
  ink: string; // title text
  ink2: string; // member / stereotype text
  dash?: string; // outline dash pattern; classes from outside the scan are dashed
}
// Each UML kind gets its own colour so classes, abstracts, interfaces and structs are
// distinguishable at a glance (and tell apart from the rose doc-notes and yellow notes).
const BOX_KINDS: Record<string, BoxKind> = {
  class: { fill: "#ab9fd6", stroke: "#877ac0", ink: "#ffffff", ink2: "#efeafb" },
  abstract: { fill: "#cbc987", stroke: "#aeab63", ink: "#33320c", ink2: "#4b4820" },
  interface: { fill: "#a0cdc5", stroke: "#77b2a8", ink: "#14352f", ink2: "#274d45" },
  struct: { fill: "#aabfe0", stroke: "#7f9fca", ink: "#16304f", ink2: "#2b476b" },
  // Metaclasses make classes, so they get their own warm colour, matching the instanceof edge.
  metaclass: { fill: "#f2b48f", stroke: "#d98c5f", ink: "#3b1d0a", ink2: "#5a2f14" },
  // Classes outside the scan (drawn where a scanned class inherits from or owns one): pale and
  // dashed so they read as context: grey for the standard library, green for installed packages,
  // orange for ML libraries (ML_PACKAGES in the extractor).
  stdlib: { fill: "#e3e7ec", stroke: "#8b95a1", ink: "#1f2a36", ink2: "#4a5562", dash: "5 3" },
  library: { fill: "#c3ead2", stroke: "#4f9c6e", ink: "#123a24", ink2: "#2c5a40", dash: "5 3" },
  ml: { fill: "#ffe3c7", stroke: "#d9822b", ink: "#4a2a0a", ink2: "#7a4a1c", dash: "5 3" },
  // Functions are neutral grey so they read as a different layer from the coloured types.
  function: { fill: "#aeb3bd", stroke: "#8b909c", ink: "#232630", ink2: "#3a3d47" },
};

// Language is a second visual channel (box colour already encodes the UML kind): a coloured
// left stripe on every box plus a short tag, so Python / TypeScript / Go tell apart at a
// glance and mixed-language scans are readable.
// The legend's table of box colours, in display order. The colours are BOX_KINDS'.
export const KIND_LEGEND: [kind: string, label: string][] = [
  ["class", "class"],
  ["abstract", "abstract class (name in italics)"],
  ["interface", "interface / Protocol"],
  ["struct", "struct"],
  ["metaclass", "metaclass"],
  ["function", "function"],
  ["stdlib", "standard library class"],
  ["library", "third-party library class"],
  ["ml", "ML library class (torch, sklearn, …)"],
];

/** A legend swatch: a small box filled and outlined like that kind's boxes. */
export function kindSwatch(kind: string): string {
  const k = BOX_KINDS[kind] ?? BOX_KINDS.class!;
  const line = k.dash ? "dashed" : "solid";
  return `<i class="lg-box" style="background:${k.fill};border:1.5px ${line} ${k.stroke}"></i>`;
}

export const LANG_STYLE: Record<string, { tag: string; color: string; label: string }> = {
  python: { tag: "py", color: "#2b6cb0", label: "Python" },
  typescript: { tag: "ts", color: "#d97706", label: "TypeScript" },
  go: { tag: "go", color: "#0e9aa7", label: "Go" },
};

export function renderScene(store: Store): string {
  const showFns = store.showFunctions();
  const visible = store.seed.nodes.filter((n) => showFns || n.kind !== "function");
  const boxes = new Map<string, Box>();
  const collapsedOf = new Map<string, boolean>();
  for (const node of visible) {
    const collapsed = store.isCollapsed(node.key);
    collapsedOf.set(node.key, collapsed);
    const d = dims(node, collapsed);
    const a = store.boxPos(node.key); // top-left anchor -> centre for edge geometry
    boxes.set(node.key, { cx: a.x + d.w / 2, cy: a.y + d.h / 2, w: d.w, h: d.h });
  }

  // Where every connector goes is one decision over the whole drawing, not one per pair of
  // boxes: a path is only readable relative to the other paths sharing the same gap. route.ts
  // owns it.
  const routes = routeEdges(boxes, store.seed.relations, edgeKey, (k) => store.edgeBend(k));

  const edgeParts: string[] = [];
  const handleParts: string[] = [];
  for (const rel of store.seed.relations) {
    const src = boxes.get(rel.src);
    const dst = boxes.get(rel.dst);
    if (!src || !dst) continue;
    const key = edgeKey(rel);
    const bend = store.edgeBend(key);
    const route = routes.get(key);
    const geom =
      store.edgeModeFor(key) === "orthogonal" && route
        ? polylineGeom(route.points, route.handle)
        : edgeGeom(src, dst, bend);
    const st = edgeStyle(rel);
    const dash = st.dash ? ` stroke-dasharray="${st.dash}"` : "";
    // One group per edge, tagged with its key and kind, so the legend can highlight it.
    const parts = [
      `<path d="${geom.path}" fill="none" stroke="${st.color}" stroke-width="1.8"${dash}/>`,
    ];
    if (st.markerEnd) parts.push(decoration(st.markerEnd, geom.p1, geom.dirEnd, st.color));
    if (st.markerStart) parts.push(decoration(st.markerStart, geom.p0, geom.dirStart, st.color));
    edgeParts.push(
      `<g class="edge" data-edge="${attr(key)}" data-kind="${attr(rel.kind)}">${parts.join("")}</g>`,
    );
    handleParts.push(
      `<circle class="eh" data-edge="${attr(key)}" cx="${round(geom.handle.x)}" cy="${round(
        geom.handle.y,
      )}" r="5"/>`,
    );
  }

  const boxParts = visible.map((n) => renderBox(n, boxes.get(n.key)!, collapsedOf.get(n.key)!));

  // The SVG fills the container; a single #world group carries pan/zoom, so every child
  // stays in world coordinates and getScreenCTM() on #world maps screen<->world for drags.
  const b = bounds([...boxes.values()], handleParts.length ? extractHandleXY(handleParts) : []);
  const view = store.ensureView({ panX: -b.minX, panY: -b.minY, zoom: 1 });

  return (
    `<svg id="scene" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" ` +
    `font-family="${MONO_FONT}" font-size="${FONT.body}">` +
    defs() +
    `<g id="world" transform="translate(${round(view.panX)} ${round(view.panY)}) ` +
    `scale(${round(view.zoom)})">` +
    renderGroups(store) + // behind the classes
    renderImages(store) +
    edgeParts.join("") +
    boxParts.join("") +
    handleParts.join("") +
    renderNotes(store) + // sticky notes sit on top
    `</g></svg>`
  );
}

function renderBox(node: SeedNode, box: Box, collapsed: boolean): string {
  const d = dims(node, collapsed);
  const x0 = box.cx - d.w / 2;
  const y0 = box.cy - d.h / 2;
  const kind = BOX_KINDS[node.kind] ?? BOX_KINDS.class!;
  const lang = LANG_STYLE[node.lang];
  if (node.kind === "function") {
    return (
      `<g class="nd" data-key="${attr(node.key)}">` +
      `<rect x="${round(x0)}" y="${round(y0)}" width="${d.w}" height="${round(d.h)}" rx="9" ` +
      `fill="${kind.fill}" stroke="${kind.stroke}" stroke-width="1.1" filter="url(#cardshadow)"/>` +
      langStripe(x0, y0, d.h, lang) +
      titleTarget(
        node.key,
        x0,
        y0,
        d.w,
        d.h,
        centerText(box.cx, y0 + 23, d.title, kind.ink, false, FONT.fn),
      ) +
      `</g>`
    );
  }
  const parts: string[] = [
    `<rect x="${round(x0)}" y="${round(y0)}" width="${d.w}" height="${round(d.h)}" rx="12" ` +
      `fill="${kind.fill}" stroke="${kind.stroke}" stroke-width="1.2" ` +
      (kind.dash ? `stroke-dasharray="${kind.dash}" ` : "") +
      `filter="url(#cardshadow)"/>`,
    langStripe(x0, y0, d.h, lang),
    langBadge(x0 + d.w, y0, lang),
  ];
  let cy = y0;
  if (d.stereotype) {
    parts.push(centerText(box.cx, cy + 14, d.stereotype, kind.ink2, false, FONT.stereotype));
    cy += LINE_H;
  }
  // Chevron signals (and, via a header click, toggles) collapse.
  parts.push(leftText(x0 + 7, cy + 19, collapsed ? "▸" : "▾", kind.ink2));
  const title = centerText(box.cx, cy + 19, d.title, kind.ink, d.italic, FONT.title, true);
  parts.push(titleTarget(node.key, x0 + 20, y0, d.w - 20, cy + TITLE_H - y0, title)); // not the chevron
  cy += TITLE_H;

  if (collapsed) {
    parts.push(sep(x0, cy, d.w, kind.stroke));
    cy += PAD;
    parts.push(centerText(box.cx, cy + 14, d.hint, kind.ink2, false, FONT.hint));
    return `<g class="nd" data-key="${attr(node.key)}">${parts.join("")}</g>`;
  }

  parts.push(sep(x0, cy, d.w, kind.stroke));
  cy += PAD;
  for (const a of d.attrs) {
    parts.push(leftText(x0 + PAD, cy + 14, a, kind.ink2));
    cy += LINE_H;
  }
  parts.push(sep(x0, cy, d.w, kind.stroke));
  cy += PAD;
  for (const m of d.methods) {
    // Whole row is a click target that opens the method's doc/source popup.
    parts.push(
      `<g class="mrow" data-key="${attr(node.key)}" data-method="${attr(m.name)}">` +
        `<rect x="${round(x0 + 2)}" y="${round(cy)}" width="${round(d.w - 4)}" height="${LINE_H}" ` +
        `rx="3" fill="transparent"/>` +
        leftText(x0 + PAD, cy + 14, m.label, kind.ink2) +
        `</g>`,
    );
    cy += LINE_H;
  }
  return `<g class="nd" data-key="${attr(node.key)}">${parts.join("")}</g>`;
}

type Lang = (typeof LANG_STYLE)[string] | undefined;

// A coloured left stripe marking the source language (rounded to sit inside the card corner).
function langStripe(x0: number, y0: number, h: number, lang: Lang): string {
  if (!lang) return "";
  return `<rect x="${round(x0)}" y="${round(y0 + 2)}" width="4.5" height="${round(h - 4)}" rx="2.2" fill="${lang.color}"/>`;
}

// A small py/ts/go pill in the top-right of a type box.
function langBadge(xRight: number, yTop: number, lang: Lang): string {
  if (!lang) return "";
  const bw = 20;
  const bh = 13;
  const x = xRight - bw - 7;
  const y = yTop + 6;
  return (
    `<rect x="${round(x)}" y="${round(y)}" width="${bw}" height="${bh}" rx="6" fill="${lang.color}" fill-opacity="0.92"/>` +
    `<text x="${round(x + bw / 2)}" y="${round(y + 9.6)}" text-anchor="middle" font-size="9" fill="#ffffff" style="font-weight:600">${lang.tag}</text>`
  );
}

function sep(x: number, y: number, w: number, color: string): string {
  return `<line x1="${round(x)}" y1="${round(y)}" x2="${round(x + w)}" y2="${round(
    y,
  )}" stroke="${color}" stroke-opacity="0.4" stroke-width="1"/>`;
}

// A class's title plus an invisible area around it: resting the pointer there shows the class
// docstring. One group, so the pointer finds it whether it is over the text or the space around.
function titleTarget(
  key: string,
  x: number,
  y: number,
  w: number,
  h: number,
  inner: string,
): string {
  return (
    `<g class="ttl" data-key="${attr(key)}">` +
    `<rect x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" fill="transparent"/>` +
    inner +
    `</g>`
  );
}

function centerText(
  x: number,
  y: number,
  text: string,
  color: string,
  italic: boolean,
  size = 12,
  bold = false,
): string {
  const style = `${italic ? "font-style:italic;" : ""}${bold ? "font-weight:600;" : ""}`;
  return `<text x="${round(x)}" y="${round(y)}" text-anchor="middle" font-size="${size}" fill="${color}" style="${style}">${esc(
    text,
  )}</text>`;
}

function leftText(x: number, y: number, text: string, color: string): string {
  return `<text x="${round(x)}" y="${round(y)}" fill="${color}">${esc(text)}</text>`;
}

function defs(): string {
  // Clean white cards with a whisper of pink, lifted by a soft neutral shadow.
  const cardGrad =
    `<linearGradient id="card" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#fdf2f7"/></linearGradient>`;
  const shadow =
    `<filter id="cardshadow" x="-25%" y="-25%" width="150%" height="150%">` +
    `<feDropShadow dx="0" dy="3" stdDeviation="6" flood-color="#8b6fae" flood-opacity="0.16"/></filter>`;
  return `<defs>${cardGrad}${shadow}</defs>`;
}

// Endpoint markers are drawn explicitly (not via <marker>) so they are always visible
// and correctly oriented, in both curved and orthogonal routing. `dir` points along the
// line at that endpoint. Ids match edgeStyle: m-tri, m-arrow-*, m-diamond-fill/open.
function decoration(id: string, pt: Point, dir: Point, color: string): string {
  const px = -dir.y;
  const py = dir.x; // perpendicular
  if (id === "m-tri") {
    const L = 14;
    const W = 7.5;
    const b = { x: pt.x - dir.x * L, y: pt.y - dir.y * L };
    return poly(
      [pt, { x: b.x + px * W, y: b.y + py * W }, { x: b.x - px * W, y: b.y - py * W }],
      "#fff",
      color,
      1.5,
    );
  }
  if (id.startsWith("m-arrow")) {
    const L = 12;
    const W = 6.5;
    const b = { x: pt.x - dir.x * L, y: pt.y - dir.y * L };
    const a1 = { x: b.x + px * W, y: b.y + py * W };
    const a2 = { x: b.x - px * W, y: b.y - py * W };
    return (
      `<path d="M ${round(a1.x)} ${round(a1.y)} L ${round(pt.x)} ${round(pt.y)} ` +
      `L ${round(a2.x)} ${round(a2.y)}" fill="none" stroke="${color}" stroke-width="1.9"/>`
    );
  }
  if (id === "m-diamond-fill" || id === "m-diamond-open") {
    const Ld = 17;
    const Wd = 7.5;
    const back = { x: pt.x + dir.x * Ld, y: pt.y + dir.y * Ld };
    const mid = { x: pt.x + dir.x * (Ld / 2), y: pt.y + dir.y * (Ld / 2) };
    const fill = id === "m-diamond-fill" ? color : "#fff";
    return poly(
      [
        pt,
        { x: mid.x + px * Wd, y: mid.y + py * Wd },
        back,
        { x: mid.x - px * Wd, y: mid.y - py * Wd },
      ],
      fill,
      color,
      1.4,
    );
  }
  return "";
}

function poly(pts: Point[], fill: string, stroke: string, sw: number): string {
  const p = pts.map((q) => `${round(q.x)},${round(q.y)}`).join(" ");
  return `<polygon points="${p}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
function bounds(boxes: Box[], extra: { x: number; y: number }[]): Bounds {
  const M = 120;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.cx - b.w / 2);
    minY = Math.min(minY, b.cy - b.h / 2);
    maxX = Math.max(maxX, b.cx + b.w / 2);
    maxY = Math.max(maxY, b.cy + b.h / 2);
  }
  for (const p of extra) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 800, maxY: 600 };
  return { minX: minX - M, minY: minY - M, maxX: maxX + M, maxY: maxY + M };
}

function extractHandleXY(handles: string[]): { x: number; y: number }[] {
  return handles.map((h) => {
    const cx = Number(/cx="([\d.-]+)"/.exec(h)?.[1] ?? 0);
    const cy = Number(/cy="([\d.-]+)"/.exec(h)?.[1] ?? 0);
    return { x: cx, y: cy };
  });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function attr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
