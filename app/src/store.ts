// Document state = seed (facts) + overlay (the user's layout), plus persistence.
// The renderer reads it; interactions mutate it. Storage lives ONLY here, so moving
// from localStorage to a server (or IndexedDB, once images arrive) is a change to
// this file and nowhere else.

import {
  emptyOverlay,
  type CodeboardDoc,
  type GroupItem,
  type ImageItem,
  type ItemKind,
  type NoteItem,
  type Overlay,
  type Point,
  type Rect,
  type Seed,
  type ViewState,
} from "./model";
import { initialPositions } from "./layout";

const STORAGE_PREFIX = "cartograph.doc.v1:";
const NOTE_COLOR = "#f4d774";

export interface Selection {
  kind: ItemKind;
  id: string;
}

export class Store {
  readonly seed: Seed;
  readonly scope: string;
  private readonly key: string; // storage key; scoped per folder so layouts never collide
  private overlay: Overlay;
  private base: Record<string, Point>; // layout fallback for un-moved boxes
  private saveTimer: number | null = null;
  private sel: Selection | null = null; // transient (not persisted)

  constructor(seed: Seed, scope = "default") {
    this.seed = seed;
    this.scope = scope;
    this.key = STORAGE_PREFIX + scope;
    this.base = initialPositions(seed);
    this.overlay = loadOverlay(this.key);
  }

  // The box's top-left anchor. Anchoring at the corner (not the centre) keeps the
  // header fixed when a class collapses/expands and its height changes.
  boxPos(key: string): Point {
    return this.overlay.boxes[key] ?? this.base[key] ?? { x: 0, y: 0 };
  }

  setBoxPos(key: string, p: Point): void {
    this.overlay.boxes[key] = { x: Math.round(p.x), y: Math.round(p.y) };
    this.scheduleSave();
  }

  edgeBend(key: string): [number, number] {
    return this.overlay.edges[key]?.bend ?? [0, 0];
  }

  setEdgeBend(key: string, bend: [number, number]): void {
    this.overlay.edges[key] = { bend: [Math.round(bend[0]), Math.round(bend[1])] };
    this.scheduleSave();
  }

  // The viewport, initialised on first use so the content starts framed near the top-left.
  ensureView(fit: ViewState): ViewState {
    if (!this.overlay.view) {
      this.overlay.view = fit;
      this.scheduleSave();
    }
    return this.overlay.view;
  }

  setView(v: ViewState): void {
    this.overlay.view = v;
    this.scheduleSave();
  }

  view(): ViewState {
    return this.overlay.view ?? { panX: 0, panY: 0, zoom: 1 };
  }

  // Auto class-docstring notes: a global on/off, plus a per-class position override.
  showDocs(): boolean {
    return !this.overlay.hideDocs;
  }
  toggleDocs(): void {
    this.overlay.hideDocs = !this.overlay.hideDocs;
    this.scheduleSave();
  }
  docNotePos(key: string): Point | null {
    return this.overlay.docNotes[key] ?? null;
  }
  setDocNotePos(key: string, p: Point): void {
    this.overlay.docNotes[key] = { x: Math.round(p.x), y: Math.round(p.y) };
    this.scheduleSave();
  }

  isCollapsed(key: string): boolean {
    return this.overlay.collapsed[key] ?? false;
  }

  toggleCollapse(key: string): void {
    if (this.overlay.collapsed[key]) delete this.overlay.collapsed[key];
    else this.overlay.collapsed[key] = true;
    this.scheduleSave();
  }

  // --- canvas items (notes / images / groups) --------------------------------------------
  notes(): NoteItem[] {
    return this.overlay.notes;
  }
  images(): ImageItem[] {
    return this.overlay.images;
  }
  groups(): GroupItem[] {
    return this.overlay.groups;
  }

  addNote(x: number, y: number): string {
    const item: NoteItem = { id: uid(), x, y, w: 180, h: 120, text: "", color: NOTE_COLOR };
    this.overlay.notes.push(item);
    this.sel = { kind: "note", id: item.id };
    this.scheduleSave();
    return item.id;
  }

  addGroup(x: number, y: number): string {
    const item: GroupItem = { id: uid(), x, y, w: 320, h: 240, label: "group" };
    this.overlay.groups.push(item);
    this.sel = { kind: "group", id: item.id };
    this.scheduleSave();
    return item.id;
  }

  addImage(src: string, x: number, y: number, w: number, h: number): string {
    const item: ImageItem = { id: uid(), x, y, w, h, src };
    this.overlay.images.push(item);
    this.sel = { kind: "image", id: item.id };
    this.scheduleSave();
    return item.id;
  }

  moveItem(kind: ItemKind, id: string, x: number, y: number): void {
    const it = this.find(kind, id);
    if (it) {
      it.x = Math.round(x);
      it.y = Math.round(y);
      this.scheduleSave();
    }
  }

  resizeItem(kind: ItemKind, id: string, w: number, h: number): void {
    const it = this.find(kind, id);
    if (it) {
      it.w = Math.max(60, Math.round(w));
      it.h = Math.max(40, Math.round(h));
      this.scheduleSave();
    }
  }

  setNoteText(id: string, text: string): void {
    const it = this.overlay.notes.find((n) => n.id === id);
    if (it) {
      it.text = text;
      this.scheduleSave();
    }
  }

  setGroupLabel(id: string, label: string): void {
    const it = this.overlay.groups.find((g) => g.id === id);
    if (it) {
      it.label = label;
      this.scheduleSave();
    }
  }

  removeItem(kind: ItemKind, id: string): void {
    const arr = this.array(kind);
    const i = arr.findIndex((it) => it.id === id);
    if (i >= 0) {
      arr.splice(i, 1);
      if (this.sel?.kind === kind && this.sel.id === id) this.sel = null;
      this.scheduleSave();
    }
  }

  item(kind: ItemKind, id: string): Rect | undefined {
    return this.find(kind, id);
  }

  selected(): Selection | null {
    return this.sel;
  }
  select(sel: Selection | null): void {
    this.sel = sel;
  }

  private array(kind: ItemKind): Rect[] {
    return kind === "note" ? this.overlay.notes : kind === "image" ? this.overlay.images : this.overlay.groups;
  }
  private find(kind: ItemKind, id: string): Rect | undefined {
    return this.array(kind).find((it) => it.id === id);
  }

  // --- whole-document save / load --------------------------------------------------------
  toDocument(): CodeboardDoc {
    return { version: 1, scope: this.scope, seed: this.seed, overlay: this.overlay };
  }

  setOverlay(overlay: Overlay): void {
    this.overlay = normalize(overlay);
    this.base = initialPositions(this.seed);
    this.save();
  }

  reset(): void {
    this.overlay = emptyOverlay();
    this.sel = null;
    this.save();
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.save(), 200);
  }

  private save(): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.overlay));
    } catch {
      // storage full or unavailable — the on-screen layout still works this session.
    }
  }
}

function loadOverlay(key: string): Overlay {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return emptyOverlay();
    return normalize(JSON.parse(raw) as Partial<Overlay>);
  } catch {
    return emptyOverlay();
  }
}

// Fill in any missing arrays/maps so older or imported overlays are safe to render.
function normalize(o: Partial<Overlay>): Overlay {
  return {
    boxes: o.boxes ?? {},
    edges: o.edges ?? {},
    collapsed: o.collapsed ?? {},
    view: o.view,
    notes: o.notes ?? [],
    images: o.images ?? [],
    groups: o.groups ?? [],
    docNotes: o.docNotes ?? {},
    hideDocs: o.hideDocs,
  };
}

function uid(): string {
  return crypto.randomUUID();
}
