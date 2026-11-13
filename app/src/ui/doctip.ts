// Hover tip: rest the pointer on a method row (or a class's title) and its full docstring appears
// in a translucent card to the LEFT of the class box (right when the left has no room). It never
// takes clicks — a click still opens the method popup — and it hides on any press, scroll or move.

import { renderDocstring } from "../docfmt";

const DELAY_MS = 250;
const GAP = 12;
const MARGIN = 8;

export interface TipContent {
  title: string; // already-escaped HTML for the header line
  doc: string;
}

/** `lookup(nodeKey, methodName | null)` gives the tip for a method row or a class title. */
export function wireDocTips(
  container: HTMLElement,
  lookup: (key: string, method: string | null) => TipContent | null,
): void {
  const tip = document.createElement("div");
  tip.id = "doctip";
  tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);

  let anchor: Element | null = null;
  let timer: number | undefined;

  const hide = () => {
    window.clearTimeout(timer);
    anchor = null;
    tip.classList.remove("on");
  };

  const show = (target: Element) => {
    const el = target as SVGElement;
    const key = el.dataset.key;
    if (!key) return;
    const content = lookup(key, el.dataset.method ?? null);
    if (!content) return;
    tip.innerHTML =
      `<div class="dt-head">${content.title}</div>` +
      (content.doc.trim()
        ? `<div class="ds">${renderDocstring(content.doc)}</div>`
        : `<div class="dt-none">No docstring in the source.</div>`);
    tip.classList.add("on");
    place(tip, target.closest(".nd") ?? target, target);
  };

  container.addEventListener("pointerover", (ev) => {
    if (ev.buttons) return; // dragging: no tips
    const target = (ev.target as Element).closest(".mrow, .ttl");
    if (target === anchor) return;
    hide();
    if (!target) return;
    anchor = target;
    timer = window.setTimeout(() => show(target), DELAY_MS);
  });
  container.addEventListener("pointerleave", hide);
  container.addEventListener("pointerdown", hide, { capture: true });
  container.addEventListener("wheel", hide, { passive: true });
  window.addEventListener("keydown", hide);
}

// Left of the class box, vertically centred on the row, kept inside the window.
function place(tip: HTMLElement, box: Element, row: Element): void {
  const b = box.getBoundingClientRect();
  const r = row.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  let left = b.left - GAP - w;
  if (left < MARGIN) left = b.right + GAP; // no room on the left: the right side
  left = Math.max(MARGIN, Math.min(left, window.innerWidth - w - MARGIN));
  const top = Math.max(
    MARGIN,
    Math.min(r.top + r.height / 2 - h / 2, window.innerHeight - h - MARGIN),
  );
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}
