import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyOverlay, type Overlay, type Seed } from "./model";
import { Store } from "./store";

const seed: Seed = { version: 1, nodes: [], relations: [] };

// The browser's storage, in memory: the store reads it when a board opens and writes it 200ms
// after each change.
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

function fileLayout(): Overlay {
  return { ...emptyOverlay(), boxes: { "m.py#A": { x: 10, y: 20 } } };
}

describe("store persistence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("localStorage", memoryStorage());
  });

  it("knows whether this browser held a layout for the board", () => {
    expect(new Store(seed, "board").hasStoredLayout()).toBe(false);
    const first = new Store(seed, "board");
    first.setBoxPos("m.py#A", { x: 300, y: 400 });
    vi.advanceTimersByTime(250);
    const again = new Store(seed, "board");
    expect(again.hasStoredLayout()).toBe(true);
    expect(again.boxPos("m.py#A")).toEqual({ x: 300, y: 400 });
  });

  it("does not change the file's layout when the user moves a class", () => {
    const file = fileLayout();
    const store = new Store(seed, "board");
    store.setOverlay(file);
    store.setBoxPos("m.py#A", { x: 300, y: 400 });
    expect(file.boxes["m.py#A"]).toEqual({ x: 10, y: 20 });
  });

  it("resets to the file's layout when given one, else to the automatic layout", () => {
    const store = new Store(seed, "board");
    store.setBoxPos("m.py#A", { x: 300, y: 400 });
    store.reset(fileLayout());
    expect(store.boxPos("m.py#A")).toEqual({ x: 10, y: 20 });
    store.reset();
    expect(store.boxPos("m.py#A")).toEqual({ x: 0, y: 0 });
  });
});
