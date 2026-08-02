// Pointer/keyboard handling. One delegated set of listeners on the container survives the
// innerHTML swaps that re-render does. A press that moves past the slop is a drag (a class
// box, a line's bend, a canvas item, a resize handle, or — on empty canvas — a pan); a press
// that does not is a click (toggle a class, open a method popup, or select an item). The
// wheel zooms about the cursor; double-click edits a note/group; Delete removes a selection.

import { dims } from "./geometry";
import type { ItemKind, Rect } from "./model";
import type { Store } from "./store";
import { openEditor } from "./ui/editor";

const SLOP = 4;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;

export type MethodClick = (nodeKey: string, methodName: string) => void;

export function wireInteractions(
  container: HTMLElement,
  getStore: () => Store,
  rerender: () => void,
  onMethodClick: MethodClick,
): void {
  container.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    const store = getStore();
    if (!store) return;
    const target = ev.target as Element;

    // Delete button on a selected item — a click, never a drag.
    const del = target.closest(".del") as SVGElement | null;
    if (del) {
      ev.preventDefault();
      store.removeItem(del.dataset.kind as ItemKind, del.dataset.id!);
      rerender();
      return;
    }

    const rz = target.closest(".rz") as SVGElement | null;
    const handle = rz ? null : (target.closest(".eh") as SVGElement | null);
    const docnote = rz || handle ? null : (target.closest(".docnote") as SVGElement | null);
    const item =
      rz || handle || docnote
        ? null
        : (target.closest(".note,.image,.group") as SVGElement | null);
    const box =
      rz || handle || docnote || item ? null : (target.closest(".nd") as SVGElement | null);

    if (!rz && !handle && !docnote && !item && !box) {
      if (store.selected()) {
        store.select(null); // clicking empty canvas deselects
        rerender();
      }
      startPan(ev, store, rerender);
      return;
    }

    const world = container.querySelector("#world") as SVGGElement | null;
    const ctm = world?.getScreenCTM();
    if (!world || !ctm) return;
    ev.preventDefault();
    const inv = ctm.inverse();
    const at = (e: PointerEvent) => new DOMPoint(e.clientX, e.clientY).matrixTransform(inv);
    const start = at(ev);

    let moving = false;
    let onMove: (e: PointerEvent) => void;
    let onClick: () => void = () => {};

    if (rz) {
      const kind = rz.dataset.kind as ItemKind;
      const id = rz.dataset.id!;
      const it = store.item(kind, id);
      if (!it) return;
      const w0 = it.w;
      const h0 = it.h;
      onMove = (e) => {
        const p = at(e);
        if (!commit(moving, start, p)) return;
        moving = true;
        store.resizeItem(kind, id, w0 + (p.x - start.x), h0 + (p.y - start.y));
        rerender();
      };
    } else if (handle) {
      const key = handle.dataset.edge!;
      const startBend = store.edgeBend(key);
      onMove = (e) => {
        const p = at(e);
        if (!commit(moving, start, p)) return;
        moving = true;
        store.setEdgeBend(key, [startBend[0] + (p.x - start.x), startBend[1] + (p.y - start.y)]);
        rerender();
      };
    } else if (docnote) {
      // A class's auto docstring card. Its default position isn't stored, so read the
      // current corner off the DOM rather than from the store.
      const key = docnote.dataset.key!;
      const rect = docnote.querySelector("rect");
      const x0 = Number(rect?.getAttribute("x") ?? 0);
      const y0 = Number(rect?.getAttribute("y") ?? 0);
      onMove = (e) => {
        const p = at(e);
        if (!commit(moving, start, p)) return;
        moving = true;
        store.setDocNotePos(key, { x: x0 + (p.x - start.x), y: y0 + (p.y - start.y) });
        rerender();
      };
    } else if (item) {
      const kind: ItemKind = item.classList.contains("note")
        ? "note"
        : item.classList.contains("image")
          ? "image"
          : "group";
      const id = item.dataset.id!;
      const it = store.item(kind, id);
      if (!it) return;
      // First click selects; clicking an already-selected note/group edits it. (Native
      // dblclick is unreliable here — selecting re-renders and swaps the element out.)
      const already = isSelected(store, kind, id);
      store.select({ kind, id });
      rerender();
      if (kind === "group") {
        // Dragging a group carries everything it encloses, keeping relative positions.
        const g = { ...it };
        const contained = collectContained(store, g);
        const startBoxes = contained.boxKeys.map((k) => ({ k, p: store.boxPos(k) }));
        const startItems = contained.items.map((ci) => {
          const r = store.item(ci.kind, ci.id)!;
          return { kind: ci.kind, id: ci.id, x: r.x, y: r.y };
        });
        onMove = (e) => {
          const p = at(e);
          if (!commit(moving, start, p)) return;
          moving = true;
          const dx = p.x - start.x;
          const dy = p.y - start.y;
          store.moveItem("group", id, g.x + dx, g.y + dy);
          for (const b of startBoxes) store.setBoxPos(b.k, { x: b.p.x + dx, y: b.p.y + dy });
          for (const ci of startItems) store.moveItem(ci.kind, ci.id, ci.x + dx, ci.y + dy);
          rerender();
        };
      } else {
        const x0 = it.x;
        const y0 = it.y;
        onMove = (e) => {
          const p = at(e);
          if (!commit(moving, start, p)) return;
          moving = true;
          store.moveItem(kind, id, x0 + (p.x - start.x), y0 + (p.y - start.y));
          rerender();
        };
      }
      onClick = () => {
        if (already) editItem(store, kind, id, rerender);
      };
    } else {
      const key = box!.dataset.key!;
      const mrow = target.closest(".mrow") as SVGElement | null;
      if (store.selected()) {
        store.select(null);
        rerender();
      }
      const startPos = store.boxPos(key);
      onMove = (e) => {
        const p = at(e);
        if (!commit(moving, start, p)) return;
        moving = true;
        store.setBoxPos(key, { x: startPos.x + (p.x - start.x), y: startPos.y + (p.y - start.y) });
        rerender();
      };
      onClick = () => {
        const method = mrow?.dataset.method;
        if (method) onMethodClick(key, method);
        else {
          store.toggleCollapse(key);
          rerender();
        }
      };
    }

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      if (!moving) onClick();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });

  container.addEventListener(
    "wheel",
    (ev) => {
      const store = getStore();
      const svg = container.querySelector("#scene") as SVGSVGElement | null;
      if (!store || !svg) return;
      ev.preventDefault();
      const v = store.view();
      const rect = svg.getBoundingClientRect();
      const sx = ev.clientX - rect.left;
      const sy = ev.clientY - rect.top;
      const wx = (sx - v.panX) / v.zoom;
      const wy = (sy - v.panY) / v.zoom;
      const zoom = clamp(v.zoom * (ev.deltaY < 0 ? 1.1 : 1 / 1.1), MIN_ZOOM, MAX_ZOOM);
      store.setView({ panX: sx - wx * zoom, panY: sy - wy * zoom, zoom });
      rerender();
    },
    { passive: false },
  );

  window.addEventListener("keydown", (e) => {
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
    const store = getStore();
    const sel = store?.selected();
    if (store && sel) {
      e.preventDefault();
      store.removeItem(sel.kind, sel.id);
      rerender();
    }
  });
}

function startPan(ev: PointerEvent, store: Store, rerender: () => void): void {
  const v0 = store.view();
  let moving = false;
  const onMove = (e: PointerEvent) => {
    const dx = e.clientX - ev.clientX;
    const dy = e.clientY - ev.clientY;
    if (!moving && Math.hypot(dx, dy) < SLOP) return;
    moving = true;
    document.body.style.cursor = "grabbing";
    store.setView({ panX: v0.panX + dx, panY: v0.panY + dy, zoom: v0.zoom });
    rerender();
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    document.body.style.cursor = "";
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function commit(moving: boolean, start: DOMPoint, p: DOMPoint): boolean {
  if (moving) return true;
  if (Math.hypot(p.x - start.x, p.y - start.y) < SLOP) return false;
  document.body.style.cursor = "grabbing";
  return true;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function isSelected(store: Store, kind: ItemKind, id: string): boolean {
  const s = store.selected();
  return s !== null && s.kind === kind && s.id === id;
}

// Classes and items whose centre falls inside the group rect — what a group drag carries.
function collectContained(
  store: Store,
  g: Rect,
): { boxKeys: string[]; items: { kind: ItemKind; id: string }[] } {
  const boxKeys: string[] = [];
  for (const n of store.seed.nodes) {
    const a = store.boxPos(n.key);
    const d = dims(n, store.isCollapsed(n.key));
    if (inside(g, a.x + d.w / 2, a.y + d.h / 2)) boxKeys.push(n.key);
  }
  const items: { kind: ItemKind; id: string }[] = [];
  for (const it of store.notes())
    if (inside(g, it.x + it.w / 2, it.y + it.h / 2)) items.push({ kind: "note", id: it.id });
  for (const it of store.images())
    if (inside(g, it.x + it.w / 2, it.y + it.h / 2)) items.push({ kind: "image", id: it.id });
  for (const it of store.groups())
    if (it.id !== g.id && inside(g, it.x + it.w / 2, it.y + it.h / 2))
      items.push({ kind: "group", id: it.id });
  return { boxKeys, items };
}

function inside(g: Rect, x: number, y: number): boolean {
  return x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h;
}

function editItem(store: Store, kind: ItemKind, id: string, rerender: () => void): void {
  if (kind === "note") {
    const cur = store.notes().find((n) => n.id === id);
    void openEditor({ title: "Note", value: cur?.text ?? "", multiline: true }).then((v) => {
      if (v !== null) {
        store.setNoteText(id, v);
        rerender();
      }
    });
  } else if (kind === "group") {
    const cur = store.groups().find((g) => g.id === id);
    void openEditor({ title: "Group label", value: cur?.label ?? "", multiline: false }).then(
      (v) => {
        if (v !== null) {
          store.setGroupLabel(id, v);
          rerender();
        }
      },
    );
  }
}
