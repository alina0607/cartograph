// SVG for the free-floating canvas items (groups, images, notes) plus their selection
// chrome (outline, resize handle, delete button). Kept apart from render.ts so the class
// renderer stays focused.

import type { GroupItem, ImageItem, NoteItem, Rect } from "./model";
import type { Store } from "./store";

const CHAR_W = 7.2; // note text metrics
const LINE_H = 18;
const PAD = 10;
const ACCENT = "#6a7bff";

// Groups sit behind the classes; images between; notes on top. main render orders them.
export function renderGroups(store: Store): string {
  return store.groups().map((g) => group(g, isSel(store, "group", g.id))).join("");
}
export function renderImages(store: Store): string {
  return store.images().map((im) => image(im, isSel(store, "image", im.id))).join("");
}
export function renderNotes(store: Store): string {
  return store.notes().map((n) => note(n, isSel(store, "note", n.id))).join("");
}

function group(g: GroupItem, sel: boolean): string {
  const label = g.label
    ? `<text x="${r(g.x + 10)}" y="${r(g.y + 18)}" fill="#b7b2d8" font-size="12.5" ` +
      `font-weight="600">${esc(g.label)}</text>`
    : "";
  return (
    `<g class="group" data-id="${attr(g.id)}">` +
    `<rect x="${r(g.x)}" y="${r(g.y)}" width="${r(g.w)}" height="${r(g.h)}" rx="10" ` +
    `fill="rgba(120,130,200,0.05)" stroke="#8f89ba" stroke-width="1.3" stroke-dasharray="7 5"/>` +
    label +
    `</g>` +
    chrome(g, "group", sel)
  );
}

function image(im: ImageItem, sel: boolean): string {
  return (
    `<g class="image" data-id="${attr(im.id)}">` +
    `<image href="${attr(im.src)}" x="${r(im.x)}" y="${r(im.y)}" width="${r(im.w)}" ` +
    `height="${r(im.h)}" preserveAspectRatio="xMidYMid meet"/>` +
    `<rect x="${r(im.x)}" y="${r(im.y)}" width="${r(im.w)}" height="${r(im.h)}" rx="6" ` +
    `fill="transparent" stroke="rgba(255,255,255,.12)"/>` +
    `</g>` +
    chrome(im, "image", sel)
  );
}

function note(n: NoteItem, sel: boolean): string {
  const lines = wrap(n.text || "click again to edit", n.w - PAD * 2);
  const empty = !n.text;
  const texts = lines
    .map(
      (ln, i) =>
        `<text x="${r(n.x + PAD)}" y="${r(n.y + PAD + 12 + i * LINE_H)}" font-size="13" ` +
        `fill="${empty ? "#8a7d3a" : "#2a2410"}"${empty ? ' font-style="italic"' : ""}>${esc(ln)}</text>`,
    )
    .join("");
  return (
    `<g class="note" data-id="${attr(n.id)}">` +
    `<rect x="${r(n.x)}" y="${r(n.y)}" width="${r(n.w)}" height="${r(n.h)}" rx="4" ` +
    `fill="${n.color}" stroke="rgba(0,0,0,.18)"/>` +
    texts +
    `</g>` +
    chrome(n, "note", sel)
  );
}

// Selection outline + resize handle (bottom-right) + delete button (top-right).
function chrome(it: Rect, kind: string, sel: boolean): string {
  if (!sel) return "";
  const out =
    `<rect x="${r(it.x - 2)}" y="${r(it.y - 2)}" width="${r(it.w + 4)}" height="${r(it.h + 4)}" ` +
    `rx="6" fill="none" stroke="${ACCENT}" stroke-width="1.5" stroke-dasharray="4 3" pointer-events="none"/>`;
  const rz =
    `<rect class="rz" data-kind="${kind}" data-id="${attr(it.id)}" x="${r(it.x + it.w - 7)}" ` +
    `y="${r(it.y + it.h - 7)}" width="14" height="14" rx="3" fill="${ACCENT}" stroke="#fff"/>`;
  const del =
    `<g class="del" data-kind="${kind}" data-id="${attr(it.id)}">` +
    `<circle cx="${r(it.x + it.w)}" cy="${r(it.y)}" r="9" fill="#e0616f"/>` +
    `<text x="${r(it.x + it.w)}" y="${r(it.y + 3.5)}" text-anchor="middle" font-size="12" ` +
    `fill="#fff">×</text></g>`;
  return out + rz + del;
}

const CJK = /[　-鿿＀-￯一-鿿]/;
function charW(ch: string): number {
  return CJK.test(ch) ? 13 : CHAR_W; // full-width CJK is ~2x a latin glyph
}
function measure(s: string): number {
  let w = 0;
  for (const ch of s) w += charW(ch);
  return w;
}

// Width-aware wrap (pixels), so Chinese — which has no spaces — wraps per character while
// latin still breaks at spaces. Honours explicit newlines.
export function wrap(text: string, maxPx: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (para === "") {
      out.push("");
      continue;
    }
    let line = "";
    let w = 0;
    for (const ch of para) {
      const cw = charW(ch);
      if (line && w + cw > maxPx) {
        const sp = line.lastIndexOf(" ");
        if (sp > 0 && !CJK.test(ch)) {
          out.push(line.slice(0, sp));
          line = line.slice(sp + 1) + ch;
        } else {
          out.push(line);
          line = ch;
        }
        w = measure(line);
      } else {
        line += ch;
        w += cw;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function isSel(store: Store, kind: string, id: string): boolean {
  const s = store.selected();
  return s !== null && s.kind === kind && s.id === id;
}

function r(n: number): number {
  return Math.round(n * 100) / 100;
}
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function attr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
