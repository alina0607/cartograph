import "@fontsource-variable/inter";
import type { CodeboardDoc, Seed, SeedNode } from "./model";
import { Store } from "./store";
import { LANG_STYLE, renderScene } from "./render";
import { wireInteractions } from "./interactions";
import { openMethodModal } from "./ui/modal";

const LAST_PATH_KEY = "cartograph.lastpath";

const app = document.getElementById("app")!;
const pathInput = document.getElementById("path") as HTMLInputElement;
const hint = document.getElementById("hint")!;
const legendEl = document.getElementById("legend")!;

let store: Store | undefined;
let byKey = new Map<string, SeedNode>();

const rerender = () => {
  if (store) app.innerHTML = renderScene(store);
};

function mount(seed: Seed, scope: string): void {
  store = new Store(seed, scope);
  const fresh = !store.hasSavedView(); // a brand-new scan gets auto-fitted
  byKey = new Map(seed.nodes.map((n) => [n.key, n]));
  updateLegend(seed);
  updateLinesLabel();
  setStatus(nodeCounts(seed));
  rerender();
  if (fresh) requestAnimationFrame(fitToContent);
}

// Frame the whole drawing in the viewport (measured from what actually rendered, once the
// container has a size). Only called for a fresh scan or a reset — a board the user has
// already panned keeps its view.
function fitToContent(): void {
  if (!store) return;
  const rects = app.querySelectorAll<SVGRectElement>("#world .nd > rect");
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  rects.forEach((r) => {
    const x = r.x.baseVal.value;
    const y = r.y.baseVal.value;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + r.width.baseVal.value);
    maxY = Math.max(maxY, y + r.height.baseVal.value);
  });
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const vw = app.clientWidth;
  const vh = app.clientHeight;
  if (!isFinite(minX) || vw < 50 || vh < 50 || spanX < 1 || spanY < 1) return;
  const pad = 50;
  const zoom = Math.min(1, Math.max(0.12, Math.min((vw - 2 * pad) / spanX, (vh - 2 * pad) / spanY)));
  store.setView({
    panX: (vw - spanX * zoom) / 2 - minX * zoom,
    panY: (vh - spanY * zoom) / 2 - minY * zoom,
    zoom,
  });
  rerender();
}

function nodeCounts(seed: Seed): string {
  const fns = seed.nodes.filter((n) => n.kind === "function").length;
  const cls = seed.nodes.length - fns;
  const parts = [`${cls} class${cls === 1 ? "" : "es"}`];
  if (fns) parts.push(`${fns} function${fns === 1 ? "" : "s"}`);
  parts.push(`${seed.relations.length} relation${seed.relations.length === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function updateLinesLabel(): void {
  const btn = document.getElementById("lines")!;
  btn.textContent = store?.edgeMode() === "orthogonal" ? "lines: 90°" : "lines: curved";
}

const LEGEND: Record<string, { glyph: string; color: string; label: string }> = {
  inherits: { glyph: "▷", color: "#a86bff", label: "inherits" },
  implements: { glyph: "▷", color: "#a86bff", label: "implements (dashed)" },
  composition: { glyph: "◆", color: "#f4c26f", label: "composition — owns" },
  aggregation: { glyph: "◇", color: "#f4c26f", label: "aggregation — has-many" },
  association: { glyph: "→", color: "#5ec8a0", label: "association — uses" },
  dependency: { glyph: "⇢", color: "#8894c4", label: "dependency — transient" },
  import: { glyph: "⇢", color: "#8894c4", label: "import" },
  contract: { glyph: "⇠⇢", color: "#db2777", label: "cross-language" },
  calls: { glyph: "→", color: "#2e78c9", label: "calls (function)" },
};
const LEGEND_ORDER = [
  "inherits",
  "implements",
  "composition",
  "aggregation",
  "association",
  "dependency",
  "import",
  "contract",
  "calls",
];

function updateLegend(seed: Seed): void {
  const present = new Set(seed.relations.map((r) => r.kind));
  const rows = LEGEND_ORDER.filter((k) => present.has(k))
    .map((k) => {
      const e = LEGEND[k]!;
      return `<div class="lg-row"><span class="lg-sw" style="color:${e.color}">${e.glyph}</span>${e.label}</div>`;
    })
    .join("");
  // Which languages are on the board, so the stripe / badge colours are decoded.
  const langs = [...new Set(seed.nodes.map((n) => n.lang))]
    .filter((l) => LANG_STYLE[l])
    .sort();
  const langRows = langs
    .map((l) => {
      const e = LANG_STYLE[l]!;
      return `<div class="lg-row"><span class="lg-sw" style="color:${e.color}">■</span>${e.label}</div>`;
    })
    .join("");
  const sep = rows && langRows ? `<div class="lg-sep"></div>` : "";
  legendEl.innerHTML = rows + sep + langRows;
  legendEl.classList.toggle("on", (rows + langRows).length > 0);
}

async function boot(): Promise<void> {
  wireInteractions(app, () => store!, rerender, (nodeKey, methodName) => {
    const node = byKey.get(nodeKey);
    const method = node?.methods.find((m) => m.name === methodName);
    if (node && method) openMethodModal(node, method);
  });

  document.getElementById("reset")!.addEventListener("click", () => {
    if (store) {
      store.reset();
      rerender();
      requestAnimationFrame(fitToContent);
    }
  });
  document.getElementById("scan")!.addEventListener("click", () => void scan());
  document.getElementById("browse")!.addEventListener("click", () => void browse());
  pathInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void scan();
  });

  document.getElementById("add-note")!.addEventListener("click", () => {
    if (!store) return;
    const c = viewCenterWorld();
    store.addNote(c.x - 90, c.y - 60);
    rerender();
  });
  document.getElementById("add-group")!.addEventListener("click", () => {
    if (!store) return;
    const c = viewCenterWorld();
    store.addGroup(c.x - 160, c.y - 120);
    rerender();
  });
  document.getElementById("docs")!.addEventListener("click", () => {
    if (store) {
      store.toggleDocs();
      rerender();
    }
  });
  document.getElementById("lines")!.addEventListener("click", () => {
    if (store) {
      store.toggleEdgeMode();
      updateLinesLabel();
      rerender();
    }
  });
  document.getElementById("fn")!.addEventListener("click", () => {
    if (store) {
      store.toggleFunctions();
      rerender();
    }
  });
  document.getElementById("save")!.addEventListener("click", saveDoc);
  const fileInput = document.getElementById("file") as HTMLInputElement;
  document.getElementById("load")!.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (f) void loadDoc(f);
    fileInput.value = "";
  });

  window.addEventListener("paste", (e) => {
    if (!store) return;
    for (const it of e.clipboardData?.items ?? []) {
      if (it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) {
          e.preventDefault();
          void addImageFromFile(f);
        }
      }
    }
  });
  app.addEventListener("dragover", (e) => e.preventDefault());
  app.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (store && f && f.type.startsWith("image/")) {
      void addImageFromFile(f, screenToWorld(e.clientX, e.clientY));
    }
  });

  // ?scan=/path (from the `cartograph` CLI) wins over the last-used folder.
  const queryScan = new URLSearchParams(location.search).get("scan");
  const start = queryScan ?? localStorage.getItem(LAST_PATH_KEY);
  if (start) {
    pathInput.value = start;
    await scan();
  }
  if (!store) await loadDefault();
}

async function browse(): Promise<void> {
  setStatus("choose a folder in the dialog…");
  try {
    const res = await fetch("/api/pick");
    if (res.status === 204) {
      setStatus("cancelled");
      return;
    }
    const data = (await res.json()) as { path?: string; error?: string };
    if (!res.ok || !data.path) throw new Error(data.error ?? "pick failed");
    pathInput.value = data.path;
    await scan();
  } catch (e) {
    setStatus((e as Error).message || "pick failed");
  }
}

async function scan(): Promise<void> {
  const path = pathInput.value.trim();
  if (!path) return;
  setStatus(`scanning ${path} …`);
  try {
    const res = await fetch(`/api/scan?path=${encodeURIComponent(path)}`);
    const data = (await res.json()) as Seed & { error?: string };
    if (!res.ok) throw new Error(data.error ?? "scan failed");
    localStorage.setItem(LAST_PATH_KEY, path);
    pathInput.classList.remove("err");
    mount(data, path);
    setStatus(nodeCounts(data));
  } catch (e) {
    pathInput.classList.add("err");
    setStatus((e as Error).message || "scan failed");
  }
}

async function loadDefault(): Promise<void> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}seed.json`);
    if (!res.ok) throw new Error();
    mount((await res.json()) as Seed, "default");
  } catch {
    app.innerHTML =
      `<p style="padding:24px;color:#9d96c7">Type a Python project folder above ` +
      `and hit <b>scan folder</b>.</p>`;
  }
}

function setStatus(msg: string): void {
  hint.textContent = msg;
}

function viewCenterWorld(): { x: number; y: number } {
  const v = store!.view();
  return { x: (app.clientWidth / 2 - v.panX) / v.zoom, y: (app.clientHeight / 2 - v.panY) / v.zoom };
}

function screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
  const v = store!.view();
  const rect = app.getBoundingClientRect();
  return { x: (clientX - rect.left - v.panX) / v.zoom, y: (clientY - rect.top - v.panY) / v.zoom };
}

function saveDoc(): void {
  if (!store) return;
  const blob = new Blob([JSON.stringify(store.toDocument(), null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cartograph-${safeName(store.scope)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function loadDoc(file: File): Promise<void> {
  try {
    const doc = JSON.parse(await file.text()) as CodeboardDoc;
    if (!doc.seed || !doc.overlay) throw new Error("not a cartograph file");
    store = new Store(doc.seed, doc.scope || "imported");
    store.setOverlay(doc.overlay);
    byKey = new Map(doc.seed.nodes.map((n) => [n.key, n]));
    pathInput.value = doc.scope || "";
    rerender();
    setStatus(`loaded ${doc.seed.nodes.length} classes from file`);
  } catch (e) {
    setStatus((e as Error).message || "load failed");
  }
}

async function addImageFromFile(file: File, at?: { x: number; y: number }): Promise<void> {
  if (!store) return;
  const img = await loadImage(await fileToDataURL(file));
  const max = 360;
  let w = img.naturalWidth || 240;
  let h = img.naturalHeight || 180;
  if (w > max) {
    h = Math.round((h * max) / w);
    w = max;
  }
  // Re-encode at display size so a big screenshot doesn't blow the storage quota.
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const src = ctx ? (ctx.drawImage(img, 0, 0, w, h), canvas.toDataURL("image/jpeg", 0.85)) : img.src;
  const p = at ?? viewCenterWorld();
  store.addImage(src, Math.round(p.x - w / 2), Math.round(p.y - h / 2), w, h);
  rerender();
}

function fileToDataURL(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(new Error("read failed"));
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("image decode failed"));
    i.src = src;
  });
}

function safeName(s: string): string {
  return (s.split("/").pop() || "board").replace(/[^\w.-]/g, "_");
}

void boot();
