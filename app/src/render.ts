// Build the whole scene as one SVG string. Full re-render on every change keeps the
// renderer stateless; interaction listeners live on the container, so replacing
// innerHTML never detaches them.

import { borderPoint, dims, edgeGeom, metrics, type Box } from "./geometry";
import { edgeKey, edgeStyle } from "./edge";
import { renderGroups, renderImages, renderNotes, wrap } from "./renderItems";
import type { SeedNode } from "./model";
import type { Store } from "./store";

const { LINE_H, TITLE_H, PAD } = metrics;

interface BoxKind {
  fill: string;
  stroke: string;
}
const BOX_KINDS: Record<string, BoxKind> = {
  class: { fill: "#201a3d", stroke: "#5566c9" },
  abstract: { fill: "#241a44", stroke: "#a86bff" },
  interface: { fill: "#172a26", stroke: "#5ec8a0" },
  struct: { fill: "#2a2338", stroke: "#f4c26f" },
};

export function renderScene(store: Store): string {
  const boxes = new Map<string, Box>();
  const collapsedOf = new Map<string, boolean>();
  for (const node of store.seed.nodes) {
    const collapsed = store.isCollapsed(node.key);
    collapsedOf.set(node.key, collapsed);
    const d = dims(node, collapsed);
    const a = store.boxPos(node.key); // top-left anchor -> centre for edge geometry
    boxes.set(node.key, { cx: a.x + d.w / 2, cy: a.y + d.h / 2, w: d.w, h: d.h });
  }

  const edgeParts: string[] = [];
  const handleParts: string[] = [];
  for (const rel of store.seed.relations) {
    const src = boxes.get(rel.src);
    const dst = boxes.get(rel.dst);
    if (!src || !dst) continue;
    const key = edgeKey(rel);
    const geom = edgeGeom(src, dst, store.edgeBend(key));
    const st = edgeStyle(rel);
    const dash = st.dash ? ` stroke-dasharray="${st.dash}"` : "";
    const ms = st.markerStart ? ` marker-start="url(#${st.markerStart})"` : "";
    const me = st.markerEnd ? ` marker-end="url(#${st.markerEnd})"` : "";
    edgeParts.push(
      `<path d="${geom.path}" fill="none" stroke="${st.color}" stroke-width="1.6"${dash}${ms}${me}/>`,
    );
    handleParts.push(
      `<circle class="eh" data-edge="${attr(key)}" cx="${round(geom.handle.x)}" cy="${round(
        geom.handle.y,
      )}" r="5"/>`,
    );
  }

  const boxParts = store.seed.nodes.map((n) =>
    renderBox(n, boxes.get(n.key)!, collapsedOf.get(n.key)!),
  );

  // Auto class-docstring notes: a distinct card dashed-linked to its class.
  const docParts: string[] = [];
  if (store.showDocs()) {
    for (const node of store.seed.nodes) {
      if (node.doc) docParts.push(docNote(node, boxes.get(node.key)!, store));
    }
  }

  // The SVG fills the container; a single #world group carries pan/zoom, so every child
  // stays in world coordinates and getScreenCTM() on #world maps screen<->world for drags.
  const b = bounds([...boxes.values()], handleParts.length ? extractHandleXY(handleParts) : []);
  const view = store.ensureView({ panX: -b.minX, panY: -b.minY, zoom: 1 });

  return (
    `<svg id="scene" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" ` +
    `font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12">` +
    defs() +
    `<g id="world" transform="translate(${round(view.panX)} ${round(view.panY)}) ` +
    `scale(${round(view.zoom)})">` +
    renderGroups(store) + // behind the classes
    renderImages(store) +
    edgeParts.join("") +
    boxParts.join("") +
    docParts.join("") + // class docstring cards, linked to their class
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
  const parts: string[] = [
    `<rect x="${round(x0)}" y="${round(y0)}" width="${d.w}" height="${round(d.h)}" rx="7" ` +
      `fill="${kind.fill}" stroke="${kind.stroke}" stroke-width="1.4"/>`,
  ];
  let cy = y0;
  if (d.stereotype) {
    parts.push(centerText(box.cx, cy + 12, d.stereotype, "#b7b2d8", false, 10.5));
    cy += LINE_H;
  }
  // Chevron signals (and, via a header click, toggles) collapse.
  parts.push(leftText(x0 + 7, cy + 16, collapsed ? "▸" : "▾", "#9d96c7"));
  parts.push(centerText(box.cx, cy + 16, d.title, "#f2f1fa", d.italic, 12.5, true));
  cy += TITLE_H;

  if (collapsed) {
    parts.push(sep(x0, cy, d.w, kind.stroke));
    cy += PAD;
    parts.push(centerText(box.cx, cy + 11, d.hint, "#8f89ba", false, 11));
    return `<g class="nd" data-key="${attr(node.key)}">${parts.join("")}</g>`;
  }

  parts.push(sep(x0, cy, d.w, kind.stroke));
  cy += PAD;
  for (const a of d.attrs) {
    parts.push(leftText(x0 + PAD, cy + 11, a, "#cfcbe8"));
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
        leftText(x0 + PAD, cy + 11, m.label, "#cfcbe8") +
        `</g>`,
    );
    cy += LINE_H;
  }
  return `<g class="nd" data-key="${attr(node.key)}">${parts.join("")}</g>`;
}

function docNote(node: SeedNode, box: Box, store: Store): string {
  const W = 220;
  const P = 10;
  const LH = 17;
  const lines = wrap(node.doc, W - P * 2);
  const h = Math.max(38, P * 2 + lines.length * LH);
  // Default above the class (fewer collisions than to the side in a row layout).
  const pos = store.docNotePos(node.key) ?? { x: box.cx - W / 2, y: box.cy - box.h / 2 - h - 26 };
  const { x, y } = pos;
  const noteBox = { cx: x + W / 2, cy: y + h / 2, w: W, h };
  const p0 = borderPoint(box, { x: noteBox.cx, y: noteBox.cy }); // border of the class
  const p1 = borderPoint(noteBox, { x: box.cx, y: box.cy }); // border of the card
  const conn =
    `<line x1="${round(p0.x)}" y1="${round(p0.y)}" x2="${round(p1.x)}" y2="${round(p1.y)}" ` +
    `stroke="#5b7fb0" stroke-width="1.2" stroke-dasharray="5 4"/>`;
  const texts = lines
    .map((ln, i) => leftText(x + P + 4, y + P + 12 + i * LH, ln, "#cfe0f5"))
    .join("");
  return (
    conn +
    `<g class="docnote" data-key="${attr(node.key)}">` +
    `<rect x="${round(x)}" y="${round(y)}" width="${W}" height="${round(h)}" rx="6" ` +
    `fill="#182234" stroke="#3f5c86"/>` +
    `<rect x="${round(x)}" y="${round(y)}" width="4" height="${round(h)}" fill="#5b7fb0"/>` +
    texts +
    `</g>`
  );
}

function sep(x: number, y: number, w: number, color: string): string {
  return `<line x1="${round(x)}" y1="${round(y)}" x2="${round(x + w)}" y2="${round(
    y,
  )}" stroke="${color}" stroke-opacity="0.4" stroke-width="1"/>`;
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

// Colours are baked into each marker (not context-stroke, which some engines drop,
// leaving the hollow triangle/diamond/arrow invisible — the "lines with no ends" bug).
function defs(): string {
  const bg = "#0d0a1f";
  const P = "#a86bff"; // inherits / implements
  const G = "#5ec8a0"; // association
  const S = "#8894c4"; // dependency
  const D = "#f4c26f"; // composition / aggregation
  const tri = `<path d="M0,0 L10,5 L0,10 Z" fill="${bg}" stroke="${P}" stroke-width="1.4"/>`;
  const arrowG = `<path d="M0,0 L10,5 L0,10" fill="none" stroke="${G}" stroke-width="1.6"/>`;
  const arrowS = `<path d="M0,0 L10,5 L0,10" fill="none" stroke="${S}" stroke-width="1.6"/>`;
  const diaFill = `<path d="M0,5 L5,0 L10,5 L5,10 Z" fill="${D}" stroke="${D}" stroke-width="1.2"/>`;
  const diaOpen = `<path d="M0,5 L5,0 L10,5 L5,10 Z" fill="${bg}" stroke="${D}" stroke-width="1.3"/>`;
  return (
    `<defs>` +
    marker("m-tri", 15, 10, 5, tri) +
    marker("m-arrow-green", 14, 9, 5, arrowG) +
    marker("m-arrow-slate", 14, 9, 5, arrowS) +
    marker("m-diamond-fill", 18, 0, 5, diaFill, true) +
    marker("m-diamond-open", 18, 0, 5, diaOpen, true) +
    `</defs>`
  );
}

function marker(
  id: string,
  size: number,
  refX: number,
  refY: number,
  body: string,
  startReverse = false,
): string {
  const orient = startReverse ? "auto-start-reverse" : "auto";
  return (
    `<marker id="${id}" markerUnits="userSpaceOnUse" markerWidth="${size}" markerHeight="${size}" ` +
    `viewBox="0 0 10 10" refX="${refX}" refY="${refY}" orient="${orient}">${body}</marker>`
  );
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
